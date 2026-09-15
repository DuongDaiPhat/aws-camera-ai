import { Injectable } from '@nestjs/common';

export interface HealthStatus {
  status: 'ok' | 'degraded';
  service: string;
  version: string;
  uptimeSeconds: number;
  timestamp: string;
}

@Injectable()
export class HealthService {
  private readonly startedAt = Date.now();

  check(): HealthStatus {
    return {
      status: 'ok',
      service: 'orchestrator',
      version: process.env.APP_VERSION ?? '0.0.1',
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      timestamp: new Date().toISOString(),
    };
  }
}
