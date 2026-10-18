/** Disposable browser harness: real AuthModule/WellnessModule/PG, local provider.
 * Ancillary camera/face/event list endpoints are read-only fixtures for navigation.
 * Run only with US20_TEST_DATABASE_URL targeting loopback qa_us20.
 */
import 'reflect-metadata';
import { Controller, Get, Global, Module, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { hash } from 'argon2';
import { createServer } from 'node:http';
import { AuthModule } from '../src/auth/auth.module';
import { DatabaseModule } from '../src/database/database.module';
import { WellnessModule } from '../src/wellness/wellness.module';
import { WellnessRepository } from '../src/wellness/wellness.repository';
import { WellnessService } from '../src/wellness/wellness.service';
import { WellnessSchedulerService } from '../src/wellness/wellness-scheduler.service';
import { NotificationRetryWorker } from '../src/notifications/notification-retry-worker.service';
import { NotificationsRepository } from '../src/notifications/notifications.repository';
import { DatabaseService } from '../src/database/database.service';
import { TelegramAdapter } from '../src/notifications/telegram/telegram.adapter';
import type { IStorageService } from '../src/storage/storage.interface';
import type { TokenClaims } from '../src/auth/auth.types';

const url = process.env.US20_TEST_DATABASE_URL;
if (
  !url ||
  !['127.0.0.1', 'localhost'].includes(new URL(url).hostname) ||
  new URL(url).pathname !== '/qa_us20'
)
  throw new Error('Disposable qa_us20 database required.');
const config = new ConfigService({
  DATABASE_URL: url,
  INTERNAL_SERVICE_TOKEN: 'us20-local-internal-token-at-least-32-characters',
  JWT_SECRET: 'us20-browser-local-signing-secret-at-least-32',
  JWT_ACCESS_TTL: '3600',
  JWT_REFRESH_TTL: '86400',
  LOGIN_MAX_ATTEMPTS: '5',
  LOGIN_LOCK_MINUTES: '15',
  NODE_ENV: 'development',
  M5_ENABLED: 'false',
  TELEGRAM_ENABLED: 'true',
  TELEGRAM_BOT_TOKEN: 'local-dummy-token',
  TELEGRAM_API_BASE_URL: 'http://127.0.0.1:55435',
});
let faceId: string, residentId: string, cameraId: string;
@Global()
@Module({ providers: [{ provide: ConfigService, useValue: config }], exports: [ConfigService] })
class HarnessConfig {}
@Controller()
class FixtureNavigation {
  @Get('known-faces') faces() {
    return {
      data: [{ id: faceId, personName: 'Mẹ QA', linkedUserId: residentId, isActive: true }],
    };
  }
  @Get('cameras') cameras() {
    return {
      data: [{ id: cameraId, name: 'Cửa chính QA', slug: 'us20_browser', isEnabled: true }],
    };
  }
  @Get('events') events() {
    return { data: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 } };
  }
  @Get('events/stats') stats() {
    return {
      windowHours: 24,
      totalEvents: 0,
      personDetectedCount: 0,
      pendingCount: 0,
      resolvedCount: 0,
      falseAlarmCount: 0,
      latestEventAt: null,
      byType: [],
      byPriority: [],
      cameraOnlineCount: 0,
      cameraTotalCount: 1,
      latestPendingEvent: null,
    };
  }
}
@Module({
  imports: [HarnessConfig, DatabaseModule, AuthModule, WellnessModule],
  controllers: [FixtureNavigation],
})
class HarnessModule {}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: url });
  await pool.query('TRUNCATE users CASCADE');
  const password = await hash('Us20-QA-local-only!');
  const owner = (
    await pool.query(
      "INSERT INTO users(email,password_hash,full_name,role,telegram_chat_id,telegram_user_id,telegram_linked_at) VALUES('caregiver@us20.local',$1,'Người chăm sóc QA','CAREGIVER','owner-chat','owner-user',now()) RETURNING id",
      [password],
    )
  ).rows[0].id as string;
  residentId = (
    await pool.query(
      "INSERT INTO users(email,password_hash,full_name,role,telegram_chat_id,telegram_user_id,telegram_linked_at) VALUES('resident@us20.local',$1,'Người được giám sát QA','VIEWER','resident-chat','resident-user',now()) RETURNING id",
      [password],
    )
  ).rows[0].id as string;
  const device = (
    await pool.query(
      "INSERT INTO devices(owner_user_id,name) VALUES($1,'QA gateway') RETURNING id",
      [owner],
    )
  ).rows[0].id;
  cameraId = (
    await pool.query(
      "INSERT INTO cameras(device_id,name,slug,rtsp_url) VALUES($1,'Cửa chính QA','us20_browser','rtsp://test') RETURNING id",
      [device],
    )
  ).rows[0].id as string;
  faceId = (
    await pool.query(
      "INSERT INTO known_faces(owner_user_id,linked_user_id,person_name,embedding,embedding_dim) VALUES($1,$2,'Mẹ QA',decode('01','hex'),1) RETURNING id",
      [owner, residentId],
    )
  ).rows[0].id as string;
  const provider = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk.toString();
    const body = JSON.parse(raw) as { chat_id: string };
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: true, result: { chat: { id: body.chat_id }, message_id: 42 } }));
  });
  await new Promise<void>((resolve) => provider.listen(55435, '127.0.0.1', resolve));
  const app = await NestFactory.create(HarnessModule);
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
  );
  app.enableCors({ origin: 'http://localhost:55436', credentials: true });
  await app.listen(55434, '127.0.0.1');
  const service = app.get(WellnessService),
    repository = app.get(WellnessRepository);
  const schedule = await service.createSchedule({ sub: owner, role: 'CAREGIVER' } as TokenClaims, {
    residentUserId: residentId,
    checkAt: '09:00',
    name: 'Kiểm tra buổi sáng QA',
  });
  const due = new Date(Date.now() - 1000);
  await repository.insertCheckRunIfNotExists({
    scheduleId: schedule.id,
    ownerUserId: owner,
    residentUserId: residentId,
    localDate: due.toISOString().slice(0, 10),
    scheduledFor: due,
    scheduleVersion: 1,
    scheduleSnapshot: { cameraIds: [cameraId] },
    lookbackStartedAt: new Date(due.getTime() - 21600000),
    lookbackEndedAt: due,
    graceSeconds: 300,
    availableAt: due,
  });
  await app.get(WellnessSchedulerService).evaluatePendingRuns();
  await new NotificationRetryWorker(
    config,
    new NotificationsRepository(new DatabaseService(pool)),
    new TelegramAdapter(config),
    {} as IStorageService,
  ).runOnce();
  process.stdout.write('US20 browser fixture ready: API 55434; local provider 55435.\n');
  const stop = async () => {
    await app.close();
    await pool.end();
    provider.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void stop());
  process.on('SIGTERM', () => void stop());
}
void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
