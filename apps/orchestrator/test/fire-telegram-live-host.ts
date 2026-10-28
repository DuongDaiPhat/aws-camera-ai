/** Explicitly approved one-photo Telegram gate on a disposable database; real runtime services. */
import 'reflect-metadata';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseEnv } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { ConfigModule } from '@nestjs/config';
import { ConsoleLogger, ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import type { Request, Response, NextFunction } from 'express';
import { connectAsync } from 'mqtt';
import type { Pool } from 'pg';
import { DatabaseModule, PG_POOL } from '../src/database/database.module';
import { FireModule } from '../src/fire/fire.module';
import { FireMediaService } from '../src/fire/fire-media.service';
import { FireTelemetry } from '../src/fire/fire-telemetry.service';
import { EventsService } from '../src/events/events.service';
import { TOKEN_SERVICE, type AuthUser, type TokenService } from '../src/auth/auth.types';
import { TELEGRAM_CHANNEL } from '../src/notifications/notification-channel.interface';
import { NotificationsModule } from '../src/notifications/notifications.module';
import { TelegramAdapter } from '../src/notifications/telegram/telegram.adapter';
import { LimitedTelegramChannel } from './fire-telegram-channel';

const CONTROL = '/test-control';
const REPORT = '/test-report';
const ASSETS = '/test-assets';
const CAMERA_ID = '33333333-3333-4333-8333-333333333333';
const POLL_MS = 500;
const FRAME_INTERVAL_MS = 200;
const HUMAN_WAIT_SECONDS = 600;

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(value: Record<string, unknown>, name: string): string {
  const field = value[name];
  if (typeof field !== 'string' || !field) throw new Error('Incomplete private live-gate settings');
  return field;
}

interface PrivateSettings {
  token: string;
  secret: string;
  userId: string;
  fullName: string;
  actorId: string;
  chatId: string;
  linkedAt: string;
  jwtSecret: string;
  internalToken: string;
}

function privateSettings(): PrivateSettings {
  const value: unknown = JSON.parse(readFileSync('/run/us18/private.json', 'utf8'));
  if (!object(value) || value.source !== 'existing-verified-application-association')
    throw new Error('Verified source-association marker required');
  const fields = {
    token: stringField(value, 'token'),
    secret: stringField(value, 'secret'),
    userId: stringField(value, 'userId'),
    fullName: stringField(value, 'fullName'),
    actorId: stringField(value, 'actorId'),
    chatId: stringField(value, 'chatId'),
    linkedAt: stringField(value, 'linkedAt'),
    jwtSecret: stringField(value, 'jwtSecret'),
    internalToken: stringField(value, 'internalToken'),
  };
  if (
    fields.actorId !== fields.chatId ||
    !/^\d+$/.test(fields.chatId) ||
    !Number.isFinite(Date.parse(fields.linkedAt))
  )
    throw new Error('Invalid existing private-chat association');
  return fields;
}

function settings(privateConfig: PrivateSettings): Record<string, string> {
  return {
    ...parseEnv(readFileSync(join(__dirname, '../../../.env.example'), 'utf8')),
    DATABASE_URL: 'postgresql://postgres:us18-test-only@postgres:5432/postgres',
    MQTT_URL: 'mqtt://mqtt:1883',
    AI_SERVICE_URL: 'http://ai:8000',
    FRIGATE_URL: 'http://unused-recording-source:5000',
    MINIO_ENDPOINT: 'http://minio:9000',
    MINIO_PUBLIC_ENDPOINT: 'http://minio:9000',
    MINIO_ROOT_USER: 'us18-test',
    MINIO_ROOT_PASSWORD: 'us18-test-only-password',
    STORAGE_BUCKET: 'us18-media',
    JWT_SECRET: privateConfig.jwtSecret,
    AI_INTERNAL_TOKEN: 'us18-isolated-ai-token-32-characters',
    INTERNAL_SERVICE_TOKEN: privateConfig.internalToken,
    M3_ENABLED: 'true',
    TELEGRAM_ENABLED: 'true',
    TELEGRAM_BOT_TOKEN: privateConfig.token,
    TELEGRAM_WEBHOOK_SECRET: privateConfig.secret,
    TELEGRAM_RETRY_DELAYS_SECONDS: '600',
    TELEGRAM_BATCH_SIZE: '1',
    TELEGRAM_POLL_MS: '1000',
    TELEGRAM_MEDIA_WAIT_MS: '1000',
  };
}

function approved(): boolean {
  const path = join(CONTROL, 'send-one.json');
  if (!existsSync(path)) return false;
  const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
  return object(value) && value.bot === 'camerai_test_bot' && value.maxPhotos === 1;
}

async function bucket(config: Record<string, string>): Promise<void> {
  const storage = new S3Client({
    endpoint: config.MINIO_ENDPOINT,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.MINIO_ROOT_USER,
      secretAccessKey: config.MINIO_ROOT_PASSWORD,
    },
  });
  try {
    await storage.send(new CreateBucketCommand({ Bucket: config.STORAGE_BUCKET }));
  } finally {
    storage.destroy();
  }
}

async function seed(pool: Pool, recipient: PrivateSettings): Promise<AuthUser> {
  const owner: AuthUser = {
    id: recipient.userId,
    email: 'us18-live@example.test',
    passwordHash: 'isolated-no-password-login',
    fullName: recipient.fullName,
    role: 'ADMIN',
    isActive: true,
    failedLoginCount: 0,
    lockedUntil: null,
    lastLoginAt: null,
    createdAt: new Date(),
  };
  // Import the existing verified association into this empty test DB; never mark a production user linked.
  await pool.query(
    `INSERT INTO users(id,email,password_hash,full_name,role,
    telegram_user_id,telegram_chat_id,telegram_linked_at)
    VALUES($1,$2,$3,$4,'ADMIN',$5,$6,$7)`,
    [
      owner.id,
      owner.email,
      owner.passwordHash,
      owner.fullName,
      recipient.actorId,
      recipient.chatId,
      recipient.linkedAt,
    ],
  );
  await pool.query(
    `INSERT INTO devices(id,owner_user_id,name)
    VALUES('22222222-2222-4222-8222-222222222222',$1,'US18 Telegram test')`,
    [owner.id],
  );
  await pool.query(
    `INSERT INTO cameras(id,device_id,name,slug,rtsp_url)
    VALUES($1,'22222222-2222-4222-8222-222222222222','US18 TEST bucket11','cam_fire',
    'rtsp://us18.test/recorded-bucket11')`,
    [CAMERA_ID],
  );
  await pool.query(
    `UPDATE escalation_rules SET t_wait_seconds=$1
    WHERE event_type='FIRE_SMOKE_DETECTED'`,
    [HUMAN_WAIT_SECONDS],
  );
  return owner;
}

function callbackTarget(
  body: unknown,
): { actor: string; chat: string; message: string; data: string } | null {
  if (!object(body) || !object(body.callback_query)) return null;
  const callback = body.callback_query;
  if (!object(callback.message) || !object(callback.from)) return null;
  const message = callback.message;
  if (!object(message.chat) || typeof callback.data !== 'string') return null;
  return {
    actor: String(callback.from.id),
    chat: String(message.chat.id),
    message: String(message.message_id),
    data: callback.data,
  };
}

function scopedWebhook(
  app: NestExpressApplication,
  channel: LimitedTelegramChannel,
  recipient: PrivateSettings,
): void {
  app.useBodyParser('json');
  app.use('/api/v1/webhooks/telegram', (req: Request, res: Response, next: NextFunction) => {
    if (req.header('X-Telegram-Bot-Api-Secret-Token') !== recipient.secret) {
      next();
      return;
    }
    const target = callbackTarget(req.body);
    if (
      !target ||
      !channel.sent ||
      target.actor !== recipient.actorId ||
      target.chat !== recipient.chatId ||
      target.message !== channel.sent.messageId ||
      !channel.callbackData.has(target.data)
    ) {
      res.status(403).json({ ok: false });
      return;
    }
    next();
  });
}

interface GateContext {
  app: INestApplication;
  pool: Pool;
  owner: AuthUser;
  channel: LimitedTelegramChannel;
}

async function start(recipient: PrivateSettings): Promise<GateContext> {
  const config = settings(recipient);
  await bucket(config);
  const module = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        ignoreEnvVars: true,
        load: [(): Record<string, string> => config],
      }),
      DatabaseModule,
      FireModule,
      NotificationsModule,
    ],
  })
    .overrideProvider(TELEGRAM_CHANNEL)
    .useFactory({
      inject: [TelegramAdapter],
      factory: (adapter: TelegramAdapter) =>
        new LimitedTelegramChannel(adapter, recipient.chatId, approved),
    })
    .setLogger(new ConsoleLogger('US18Telegram', { logLevels: ['warn', 'error'] }))
    .compile();
  const app = module.createNestApplication<NestExpressApplication>({ logger: ['warn', 'error'] });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
  );
  const pool = app.get<Pool>(PG_POOL);
  const owner = await seed(pool, recipient);
  const channel = app.get<LimitedTelegramChannel>(TELEGRAM_CHANNEL);
  scopedWebhook(app, channel, recipient);
  app.enableShutdownHooks();
  await app.listen(3001, '0.0.0.0');
  // This gate covers Telegram/photo confirmation; full RTSP/clip/browser evidence is already separate.
  app.get(FireMediaService).onModuleDestroy();
  return { app, pool, owner, channel };
}

async function waitFor(
  check: () => boolean | Promise<boolean>,
  milliseconds: number,
  reason: string,
): Promise<void> {
  const started = performance.now();
  while (!(await check())) {
    if (performance.now() - started > milliseconds) throw new Error(reason);
    await delay(POLL_MS);
  }
}

async function replay(app: INestApplication): Promise<void> {
  await waitFor(() => app.get(FireTelemetry).mqttConnected, 30000, 'MQTT subscription not ready');
  const mqtt = await connectAsync('mqtt://mqtt:1883');
  const session = randomUUID();
  try {
    for (let index = 0; index < 10; index += 1) {
      const header = Buffer.from(
        JSON.stringify({
          schemaVersion: 1,
          cameraSlug: 'cam_fire',
          sourceSessionId: session,
          frameId: `bucket11-source-${1000 + index * 5}`,
          frameTimestamp: new Date().toISOString(),
          frameWidth: 1280,
          frameHeight: 720,
        }),
      );
      const size = Buffer.alloc(4);
      size.writeUInt32BE(header.length);
      const photo = readFileSync(join(ASSETS, `frame-${index}.jpg`));
      await mqtt.publishAsync('frigate/camerai/fire/frames', Buffer.concat([size, header, photo]));
      await delay(FRAME_INTERVAL_MS);
    }
  } finally {
    await mqtt.endAsync();
  }
}

async function verify(context: GateContext): Promise<void> {
  const { app, pool, owner, channel } = context;
  const token = app.get<TokenService>(TOKEN_SERVICE).issueTokenPair(owner).accessToken;
  const events = app.get(EventsService);
  let updates = 0;
  const subscription = events.streamEvents(token).subscribe(() => {
    updates += 1;
  });
  try {
    writeFileSync(
      join(REPORT, 'prepared.json'),
      JSON.stringify({
        ready: true,
        maxPhotos: 1,
        bot: 'camerai_test_bot',
        applicationDatabaseModified: false,
        waitSeconds: HUMAN_WAIT_SECONDS,
      }),
    );
    await waitFor(approved, HUMAN_WAIT_SECONDS * 1000, 'Live send approval was not supplied');
    await replay(app);
    await waitFor(
      () => channel.sent !== null,
      60000,
      'No successful photo delivery; do not resend automatically',
    );
    const row = (
      await pool.query<{ event_id: string }>(
        'SELECT event_id FROM fire_incidents WHERE camera_id=$1',
        [CAMERA_ID],
      )
    ).rows[0];
    if (!row) throw new Error('No canonical fire incident');
    writeFileSync(
      join(REPORT, 'sent.json'),
      JSON.stringify({
        eventId: row.event_id,
        kind: 'PHOTO',
        providerAccepted: true,
        awaitingTelegramClick: true,
      }),
    );
    await waitFor(
      async () =>
        (await events.getEvent(row.event_id)).status === 'RESOLVED' &&
        channel.captionEdited &&
        channel.callbackAnswered,
      HUMAN_WAIT_SECONDS * 1000,
      'No completed Telegram confirmation',
    );
    const confirmations = await pool.query<{ channel: string; response: string }>(
      'SELECT channel,response FROM confirmations WHERE event_id=$1',
      [row.event_id],
    );
    if (
      confirmations.rows.length !== 1 ||
      confirmations.rows[0].channel !== 'TELEGRAM' ||
      confirmations.rows[0].response !== 'IM_OK'
    )
      throw new Error('Confirmation was not the expected real Telegram action');
    const notifications = await pool.query<{ status: string; telegram_message_kind: string }>(
      "SELECT status,telegram_message_kind FROM notifications WHERE event_id=$1 AND channel='TELEGRAM'",
      [row.event_id],
    );
    const detail = await events.getEvent(row.event_id);
    writeFileSync(
      join(REPORT, 'result.json'),
      JSON.stringify(
        {
          eventId: row.event_id,
          finalStatus: detail.status,
          aiModelVersion: detail.aiModelVersion,
          photoAttempts: channel.photoAttempts,
          photoAccepted: true,
          callbackAnswered: channel.callbackAnswered,
          captionEdited: channel.captionEdited,
          confirmationChannel: confirmations.rows[0].channel,
          confirmationResponse: confirmations.rows[0].response,
          notifications: notifications.rows,
          sseUpdates: updates,
          nodeVersion: process.version,
          scope:
            'Recorded raw-frame replay through real MQTT/ONNX/backend/storage/Telegram/webhook; no new full RTSP/clip/browser claim',
          fixtureWaitSeconds: HUMAN_WAIT_SECONDS,
          applicationDatabaseModified: false,
        },
        null,
        2,
      ),
    );
  } finally {
    subscription.unsubscribe();
  }
}

async function main(): Promise<void> {
  if (process.env.FIRE_TELEGRAM_LIVE_GATE !== 'isolated')
    throw new Error('Isolated live-test marker required');
  const context = await start(privateSettings());
  try {
    await verify(context);
  } finally {
    await context.app.close();
  }
}

void main().catch((error: unknown) => {
  // Avoid leaking private association/configuration values through generic HTTP/DB error objects.
  let reason = error instanceof Error ? error.message : 'Unknown live-gate failure';
  const privateConfig = privateSettings();
  for (const value of Object.values(privateConfig)) reason = reason.split(value).join('[REDACTED]');
  writeFileSync(
    join(REPORT, 'failure.json'),
    JSON.stringify({
      failed: true,
      reason,
      note: 'Live Telegram gate did not complete; inspect sanitized container logs and do not resend automatically',
    }),
  );
  process.exitCode = 1;
});
