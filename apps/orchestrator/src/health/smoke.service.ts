import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GetQueueAttributesCommand, SQSClient } from '@aws-sdk/client-sqs';
import { readAuthSettings } from '../auth/auth.config';
import { readCloudConfig } from '../cloud-queue/cloud-config';
import { DatabaseService } from '../database/database.service';
import { IStorageService, STORAGE_SERVICE } from '../storage/storage.interface';

export interface SmokeCheckResult {
  status: 'ok' | 'error';
  detail?: string;
  reason?: string;
}

export interface SmokeStatus {
  status: 'ok' | 'degraded';
  service: string;
  version: string;
  timestamp: string;
  checks: {
    database: SmokeCheckResult;
    auth: SmokeCheckResult;
    storage: SmokeCheckResult;
    cloudQueue: SmokeCheckResult;
  };
}

const SMOKE_OBJECT_KEY = '_smoke/orchestrator-smoke.txt';
const SMOKE_PAYLOAD = Buffer.from('camerai-smoke-check');
const JWKS_TIMEOUT_MS = 5000;

@Injectable()
export class SmokeService {
  private readonly logger = new Logger(SmokeService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly database: DatabaseService,
    @Inject(STORAGE_SERVICE) private readonly storage: IStorageService,
  ) {}

  /** Run API dependency checks for database, auth, storage, and cloud queue transport. */
  async check(): Promise<SmokeStatus> {
    const [database, auth, storage, cloudQueue] = await Promise.all([
      this.checkDatabase(),
      this.checkAuth(),
      this.checkStorage(),
      this.checkCloudQueue(),
    ]);

    const allOk = [database, auth, storage, cloudQueue].every((item) => item.status === 'ok');

    return {
      status: allOk ? 'ok' : 'degraded',
      service: 'orchestrator',
      version: process.env.APP_VERSION ?? '0.0.1',
      timestamp: new Date().toISOString(),
      checks: { database, auth, storage, cloudQueue },
    };
  }

  private async checkDatabase(): Promise<SmokeCheckResult> {
    try {
      await this.database.query('SELECT 1 AS ok');
      const transport = await this.database.query<{ mode: string }>(
        'SELECT mode FROM cloud_transport_mode WHERE singleton',
      );
      const users = await this.database.query<{ total: number }>(
        'SELECT count(*)::int AS total FROM users',
      );
      const mode = transport.rows[0]?.mode ?? 'unknown';
      const userCount = users.rows[0]?.total ?? 0;
      return { status: 'ok', detail: `mode=${mode},users=${userCount}` };
    } catch (error) {
      return this.failed('database', error);
    }
  }

  private async checkAuth(): Promise<SmokeCheckResult> {
    try {
      const settings = readAuthSettings(this.configService);
      if (settings.provider === 'jwt') {
        const secret = this.configService.get<string>('JWT_SECRET')?.trim();
        if (!secret) {
          return { status: 'error', reason: 'JWT_SECRET is missing' };
        }
        return { status: 'ok', detail: 'provider=jwt' };
      }

      const jwksUrl = `${settings.cognito.authority}/.well-known/jwks.json`;
      const response = await fetch(jwksUrl, { signal: AbortSignal.timeout(JWKS_TIMEOUT_MS) });
      if (!response.ok) {
        return { status: 'error', reason: `Cognito JWKS HTTP ${response.status}` };
      }
      const body = (await response.json()) as { keys?: unknown };
      if (!Array.isArray(body.keys) || body.keys.length === 0) {
        return { status: 'error', reason: 'Cognito JWKS returned no keys' };
      }
      return { status: 'ok', detail: `provider=cognito,jwksKeys=${body.keys.length}` };
    } catch (error) {
      return this.failed('auth', error);
    }
  }

  private async checkStorage(): Promise<SmokeCheckResult> {
    const provider = this.configService.get<string>('STORAGE_PROVIDER', 'minio').toLowerCase();
    try {
      const uploaded = await this.storage.upload(SMOKE_OBJECT_KEY, SMOKE_PAYLOAD, 'text/plain');
      const downloaded = await this.storage.download(SMOKE_OBJECT_KEY);
      if (!downloaded.equals(SMOKE_PAYLOAD)) {
        return { status: 'error', reason: 'Storage roundtrip payload mismatch' };
      }
      const presigned = await this.storage.getPresignedUrl(SMOKE_OBJECT_KEY, 60);
      new URL(presigned.url);
      if (this.storage.delete) {
        await this.storage.delete(SMOKE_OBJECT_KEY);
      }
      return { status: 'ok', detail: `provider=${provider},bucket=${uploaded.bucket}` };
    } catch (error) {
      return this.failed('storage', error);
    } finally {
      if (this.storage.delete) {
        await this.storage.delete(SMOKE_OBJECT_KEY).catch(() => undefined);
      }
    }
  }

  private async checkCloudQueue(): Promise<SmokeCheckResult> {
    try {
      const cloud = readCloudConfig(this.configService);
      const dbResult = await this.database.query<{ mode: string }>(
        'SELECT mode FROM cloud_transport_mode WHERE singleton',
      );
      const dbMode = dbResult.rows[0]?.mode;
      if (dbMode !== cloud.mode) {
        return {
          status: 'error',
          reason: `Transport mismatch env=${cloud.mode} db=${dbMode ?? 'missing'}`,
        };
      }
      if (cloud.mode === 'bullmq') {
        return { status: 'ok', detail: 'mode=bullmq' };
      }

      const sqs = new SQSClient({ region: cloud.region, maxAttempts: 2 });
      try {
        await sqs.send(
          new GetQueueAttributesCommand({
            QueueUrl: cloud.resultsQueue,
            AttributeNames: ['QueueArn'],
          }),
        );
      } finally {
        sqs.destroy();
      }
      return { status: 'ok', detail: `mode=sqs,consumer=${cloud.consumerEnabled}` };
    } catch (error) {
      return this.failed('cloudQueue', error);
    }
  }

  private failed(component: string, error: unknown): SmokeCheckResult {
    const raw = error instanceof Error ? error.name || 'Error' : 'UnknownError';
    const message =
      error instanceof Error && /^[A-Za-z0-9_.:=\-\s/]{1,80}$/.test(error.message)
        ? error.message
        : raw;
    this.logger.warn(`Smoke check failed for ${component}: ${raw}`);
    return { status: 'error', reason: message };
  }
}
