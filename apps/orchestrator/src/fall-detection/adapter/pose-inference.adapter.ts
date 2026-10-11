import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AiComponents } from '@cam/contracts';
import type { NormalizedBBox } from '../dto/pose-frame.dto';

export type FallResponse = AiComponents['schemas']['FallResponse'];

export interface EvaluateFallRequest {
  imageBytes: Buffer;
  trackId: string;
  cameraSlug: string;
  frameTimestamp: string;
  frameId: string;
  sourceSessionId: string;
  personBoundingBox: NormalizedBBox;
  inRestArea: boolean;
}

export interface IPoseInferenceAdapter {
  evaluateFall(request: EvaluateFallRequest): Promise<FallResponse | null>;
}

@Injectable()
export class PoseInferenceAdapter implements IPoseInferenceAdapter {
  private readonly logger = new Logger(PoseInferenceAdapter.name);
  private readonly aiServiceUrl: string;
  private readonly internalToken: string;
  private readonly timeoutMs: number;

  constructor(private readonly configService: ConfigService) {
    this.aiServiceUrl = this.configService.get<string>(
      'AI_SERVICE_URL',
      'http://ai-service:8000',
    ).replace(/\/+$/, '');
    this.internalToken = this.configService.get<string>('AI_INTERNAL_TOKEN', '');
    this.timeoutMs = Number(this.configService.get<string | number>('POSE_REQUEST_TIMEOUT_MS', 2000));
  }

  async evaluateFall(request: EvaluateFallRequest): Promise<FallResponse | null> {
    const url = `${this.aiServiceUrl}/pose/fall`;
    const formData = new FormData();

    const imageBlob = new Blob([request.imageBytes], { type: 'image/jpeg' });
    formData.append('image', imageBlob, 'frame.jpg');
    formData.append('trackId', request.trackId);
    formData.append('cameraSlug', request.cameraSlug);
    formData.append('frameTimestamp', request.frameTimestamp);
    formData.append('frameId', request.frameId);
    formData.append('sourceSessionId', request.sourceSessionId);
    formData.append('personBoundingBox', JSON.stringify(request.personBoundingBox));
    formData.append('inRestArea', request.inRestArea ? 'true' : 'false');

    const headers: Record<string, string> = {};
    if (this.internalToken) {
      headers['X-Internal-Token'] = this.internalToken;
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: formData,
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        this.logger.warn(
          `AI Service /pose/fall trả về HTTP ${response.status}: ${errorText.slice(0, 200)}`,
        );
        return null;
      }

      const data = (await response.json()) as FallResponse;
      return data;
    } catch (error) {
      const isAbort = error instanceof Error && error.name === 'TimeoutError';
      if (isAbort) {
        this.logger.warn(`AI Service /pose/fall bị timeout sau ${this.timeoutMs}ms`);
      } else {
        this.logger.error(
          `Lỗi gọi AI Service /pose/fall: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return null;
    }
  }
}
