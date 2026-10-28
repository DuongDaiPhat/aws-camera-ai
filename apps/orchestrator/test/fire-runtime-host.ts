/** Long-running real FireModule host for disposable process-restart verification. */
import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { ConfigModule } from '@nestjs/config';
import { ConsoleLogger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  CreateBucketCommand,
  HeadBucketCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { DatabaseModule, PG_POOL } from '../src/database/database.module';
import type { Pool } from 'pg';
import { FireModule } from '../src/fire/fire.module';

function isolatedSettings(): Record<string, string> {
  return {
    ...parseEnv(readFileSync(join(__dirname, '../../../.env.example'), 'utf8')),
    DATABASE_URL: 'postgresql://postgres:us18-test-only@postgres:5432/postgres',
    MQTT_URL: 'mqtt://mqtt:1883',
    AI_SERVICE_URL: 'http://ai:8000',
    FRIGATE_URL: 'http://frigate:5000',
    MINIO_ENDPOINT: 'http://minio:9000',
    MINIO_PUBLIC_ENDPOINT: 'http://minio:9000',
    MINIO_ROOT_USER: 'us18-test',
    MINIO_ROOT_PASSWORD: 'us18-test-only-password',
    STORAGE_BUCKET: 'us18-media',
    JWT_SECRET: 'us18-isolated-test-secret-32-characters',
    AI_INTERNAL_TOKEN: 'us18-isolated-ai-token-32-characters',
    INTERNAL_SERVICE_TOKEN: 'us18-isolated-callback-token-32-characters',
    M3_ENABLED: 'true',
    TELEGRAM_ENABLED: 'false',
  };
}

async function prepareBucket(settings: Record<string, string>): Promise<void> {
  const storage = new S3Client({
    endpoint: settings.MINIO_ENDPOINT,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: settings.MINIO_ROOT_USER,
      secretAccessKey: settings.MINIO_ROOT_PASSWORD,
    },
  });
  try {
    await storage.send(new HeadBucketCommand({ Bucket: settings.STORAGE_BUCKET }));
  } catch (error) {
    if (!(error instanceof S3ServiceException) || error.$metadata.httpStatusCode !== 404)
      throw error;
    await storage.send(new CreateBucketCommand({ Bucket: settings.STORAGE_BUCKET }));
  } finally {
    storage.destroy();
  }
}

async function seedCamera(pool: Pool): Promise<void> {
  // Stable fixture identities preserve the same camera and incidents across backend restarts.
  await pool.query(`INSERT INTO users(id,email,password_hash,full_name,role)
    VALUES('11111111-1111-4111-8111-111111111111','us18-runtime@example.test','isolated-no-login','Runtime gate','ADMIN') ON CONFLICT(id) DO NOTHING`);
  await pool.query(`INSERT INTO devices(id,owner_user_id,name)
    VALUES('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','Runtime gate') ON CONFLICT(id) DO NOTHING`);
  await pool.query(`INSERT INTO cameras(id,device_id,name,slug,rtsp_url)
    VALUES('33333333-3333-4333-8333-333333333333','22222222-2222-4222-8222-222222222222','Runtime gate','cam_fire','rtsp://mediamtx:8554/cam_fire') ON CONFLICT(id) DO NOTHING`);
}

async function bootstrap(): Promise<void> {
  if (process.env.FIRE_RUNTIME_GATE !== 'isolated')
    throw new Error('Isolated gate marker required');
  const settings = isolatedSettings();
  await prepareBucket(settings);
  const module = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        ignoreEnvVars: true,
        load: [(): Record<string, string> => settings],
      }),
      DatabaseModule,
      FireModule,
    ],
  })
    .setLogger(new ConsoleLogger('US18', { logLevels: ['warn', 'error'] }))
    .compile();
  const app = module.createNestApplication({ logger: ['warn', 'error'] });
  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();
  await seedCamera(app.get<Pool>(PG_POOL));
  await app.listen(3001, '0.0.0.0');
}

void bootstrap().catch((error: unknown) => {
  new ConsoleLogger('US18').error(
    error instanceof Error ? error.message : 'Runtime host startup failed',
  );
  process.exitCode = 1;
});
