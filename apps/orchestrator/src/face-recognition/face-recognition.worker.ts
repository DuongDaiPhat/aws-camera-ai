import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { AiComponents } from '@cam/contracts';

import { FrigateMediaAdapter } from '../media/frigate-media.adapter';
import { AiResultsService } from '../ai-results/ai-results.service';
import type { SubmitAiResultDto } from '../ai-results/dto/submit-ai-result.dto';

const AI_SERVICE_TIMEOUT_MS = 5_000;

export interface MatchFaceJob {
  eventId: string;
  trackId: string;
  cameraSlug: string;
  ownerScopeId: string;
  collectionVersion: number;
}

type MatchResponse = AiComponents['schemas']['MatchResponse'];

function normalizeMatchResponse(result: MatchResponse): MatchResponse {
  // Tương thích producer cũ; không biến lỗi model/collection thành kết quả thành công.
  const qualityReason = result.error?.code;
  if (qualityReason !== 'NO_FACE_DETECTED' && qualityReason !== 'MULTIPLE_FACES') {
    return result;
  }
  return {
    ...result,
    personStatus: 'UNDETERMINED',
    similarity: null,
    labelConfidence: null,
    matchedKnownFaceId: null,
    matchedPersonName: null,
    qualityReason,
    error: null,
  };
}

function definedMetadata(entries: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(entries).filter(([_key, value]) => value !== undefined));
}

function toSubmitAiResultDto(
  eventId: string,
  trackId: string,
  result: MatchResponse,
): SubmitAiResultDto {
  const hasTechnicalError = result.error !== null;

  return {
    schemaVersion: 1,
    resultId: result.requestId,
    requestId: result.requestId,
    eventId,
    observationId: `track:${trackId}:face`,
    revision: 1,
    module: 'M1_FACE',
    modelVersion: result.modelVersion,
    processedAt: result.processedAt,
    personStatus: hasTechnicalError ? undefined : (result.personStatus ?? undefined),
    matchedKnownFaceId: hasTechnicalError ? null : (result.matchedKnownFaceId ?? null),
    collectionVersion: result.collectionVersion,
    results: hasTechnicalError
      ? []
      : [
          {
            module: 'M1_FACE',
            label: result.personStatus ?? 'UNDETERMINED',
            confidence: result.labelConfidence,
            boundingBox: result.boundingBox ?? null,
            metadata: definedMetadata({
              similarity: result.similarity,
              thresholdUsed: result.thresholdUsed,
              confidencePolicyVersion: result.confidencePolicyVersion,
              qualityReason: result.qualityReason,
              collectionVersion: result.collectionVersion,
              provider: result.provider,
              fellBackToLocal: result.fellBackToLocal,
            }),
          },
        ],
    error: result.error,
  };
}

@Processor('face-recognition')
export class FaceRecognitionWorker extends WorkerHost {
  private readonly logger = new Logger(FaceRecognitionWorker.name);

  constructor(
    private readonly frigateAdapter: FrigateMediaAdapter,
    private readonly config: ConfigService,
    private readonly aiResultsService: AiResultsService,
  ) {
    super();
  }

  async process(job: Job<MatchFaceJob, void, string>): Promise<void> {
    const { eventId, trackId, ownerScopeId, collectionVersion } = job.data;

    this.logger.log(
      `Đang xử lý job nhận diện khuôn mặt cho trackId=${trackId}, eventId=${eventId}`,
    );

    const imageBuffer = await this.frigateAdapter.getCroppedSnapshot(trackId);
    if (!imageBuffer) {
      this.logger.warn(`Không lấy được ảnh crop cho track ${trackId}`);
      return this.handleAiResult(
        eventId,
        this.technicalError(
          collectionVersion,
          'IMAGE_DECODE_FAILED',
          'Không lấy được ảnh từ Frigate',
        ),
        trackId,
      );
    }

    try {
      const result = await this.callAiService(
        eventId,
        ownerScopeId,
        collectionVersion,
        imageBuffer,
      );
      return await this.handleAiResult(eventId, result, trackId);
    } catch (err) {
      this.logger.error(`Lỗi gọi AI service cho event ${eventId}`, err);
      return this.handleAiResult(
        eventId,
        this.technicalError(collectionVersion, 'TIMEOUT', 'Lỗi kết nối AI hoặc quá giờ'),
        trackId,
      );
    }
  }

  private async callAiService(
    eventId: string,
    ownerScopeId: string,
    collectionVersion: number,
    imageBuffer: Buffer,
  ): Promise<MatchResponse> {
    const formData = new FormData();
    formData.append('image', new Blob([new Uint8Array(imageBuffer)]), 'crop.jpg');
    formData.append('eventId', eventId);
    formData.append('requestId', crypto.randomUUID());
    formData.append('ownerScopeId', ownerScopeId);
    formData.append('collectionVersion', String(collectionVersion));

    const aiUrl = this.config.get<string>('AI_SERVICE_URL', 'http://localhost:8000');
    const token = this.config.get<string>('AI_INTERNAL_TOKEN', '');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), AI_SERVICE_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(`${aiUrl}/face/match`, {
        method: 'POST',
        headers: { 'X-Internal-Token': token },
        body: formData,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return (await response.json()) as MatchResponse;
  }

  private technicalError(
    collectionVersion: number,
    code: NonNullable<MatchResponse['error']>['code'],
    message: string,
  ): MatchResponse {
    return {
      requestId: crypto.randomUUID(),
      collectionVersion,
      personStatus: null,
      modelVersion: 'unknown',
      processedAt: new Date().toISOString(),
      similarity: null,
      labelConfidence: null,
      confidencePolicyVersion: 'v1',
      qualityReason: null,
      error: { code, message },
    };
  }

  private async handleAiResult(
    eventId: string,
    response: MatchResponse,
    trackId: string,
  ): Promise<void> {
    const result = normalizeMatchResponse(response);
    this.logger.log(
      {
        eventId,
        trackId,
        requestId: result.requestId,
        personStatus: result.personStatus,
        hasError: result.error !== null,
      },
      'Đã nhận kết quả M1 từ AI service',
    );
    await this.aiResultsService.submit(eventId, toSubmitAiResultDto(eventId, trackId, result));
  }
}
