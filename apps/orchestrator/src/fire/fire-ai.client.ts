import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { FireConfig } from './fire.config';
import { FireResponseDto, type FireFrame } from './fire.dto';
import { FireAiHealthDto } from './fire-health.dto';

const MAX_RESPONSE_BYTES = 128 * 1024;

@Injectable()
export class FireAiClient {
  constructor(
    private readonly config: ConfigService,
    private readonly fire: FireConfig,
  ) {}

  async health(): Promise<FireAiHealthDto> {
    const response = await fetch(
      `${this.config.get<string>('AI_SERVICE_URL', 'http://localhost:8000')}/fire/health`,
      {
        headers: { 'X-Internal-Token': this.config.getOrThrow<string>('AI_INTERNAL_TOKEN') },
        signal: AbortSignal.timeout(this.fire.healthTimeoutMs),
      },
    );
    if (!response.ok) throw new Error(`Fire health HTTP ${response.status}`);
    const raw: unknown = JSON.parse(await this.readBounded(response));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
      throw new Error('Invalid fire health');
    const result = plainToInstance(FireAiHealthDto, raw);
    if (validateSync(result, { whitelist: true, forbidNonWhitelisted: true }).length)
      throw new Error('Invalid fire health fields');
    return result;
  }

  async detect(frame: FireFrame): Promise<FireResponseDto> {
    const form = new FormData();
    form.append(
      'image',
      new Blob([new Uint8Array(frame.image)], { type: 'image/jpeg' }),
      'frame.jpg',
    );
    form.append('cameraSlug', frame.header.cameraSlug);
    form.append('sourceSessionId', frame.header.sourceSessionId);
    form.append('frameId', frame.header.frameId);
    form.append('frameTimestamp', frame.header.frameTimestamp);
    const response = await fetch(
      `${this.config.get<string>('AI_SERVICE_URL', 'http://localhost:8000')}/fire/detect`,
      {
        method: 'POST',
        headers: { 'X-Internal-Token': this.config.getOrThrow<string>('AI_INTERNAL_TOKEN') },
        body: form,
        signal: AbortSignal.timeout(this.fire.timeoutMs),
      },
    );
    if (!response.ok) throw new Error(`Fire inference HTTP ${response.status}`);
    const text = await this.readBounded(response);
    const raw: unknown = JSON.parse(text);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
      throw new Error('Invalid fire response');
    const result = plainToInstance(FireResponseDto, raw);
    if (validateSync(result, { whitelist: true, forbidNonWhitelisted: true }).length)
      throw new Error('Invalid fire evidence fields');
    return result;
  }

  private async readBounded(response: Response): Promise<string> {
    if (!response.body) throw new Error('Missing fire response body');
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = response.body.getReader();
    try {
      while (true) {
        const item = await reader.read();
        if (item.done) break;
        size += item.value.byteLength;
        if (size > MAX_RESPONSE_BYTES) throw new Error('Fire response exceeds limit');
        chunks.push(item.value);
      }
      return Buffer.concat(chunks).toString('utf8');
    } finally {
      await reader.cancel();
    }
  }
}
