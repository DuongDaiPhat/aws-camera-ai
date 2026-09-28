import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { AiComponents } from '@cam/contracts';

import { FrigateMediaAdapter } from '../media/frigate-media.adapter';
import { EventsService } from '../events/events.service';

export interface MatchFaceJob {
  eventId: string;
  trackId: string;
  cameraSlug: string;
  ownerScopeId: string;
  collectionVersion: number;
}

@Processor('face-recognition')
export class FaceRecognitionWorker extends WorkerHost {
  private readonly logger = new Logger(FaceRecognitionWorker.name);

  constructor(
    private readonly frigateAdapter: FrigateMediaAdapter,
    private readonly config: ConfigService,
    private readonly eventsService: EventsService,
  ) {
    super();
  }

  async process(job: Job<MatchFaceJob, void, string>): Promise<void> {
    const { eventId, trackId, ownerScopeId, collectionVersion } = job.data;

    this.logger.log(
      `Đang xử lý job nhận diện khuôn mặt cho trackId=${trackId}, eventId=${eventId}`,
    );

    // 1. Lấy ảnh crop
    const imageBuffer = await this.frigateAdapter.getCroppedSnapshot(trackId);
    if (!imageBuffer) {
      this.logger.warn(`Không lấy được ảnh crop cho track ${trackId}`);
      // Lỗi do không có ảnh -> UNDETERMINED. Không gửi cho AI.
      return this.handleAiResult(eventId, {
        requestId: crypto.randomUUID(),
        collectionVersion,
        personStatus: 'UNDETERMINED',
        modelVersion: 'unknown',
        processedAt: new Date().toISOString(),
        similarity: null,
        labelConfidence: null,
        confidencePolicyVersion: 'v1',
        qualityReason: 'NO_IMAGE',
        error: { code: 'IMAGE_DECODE_FAILED', message: 'Không lấy được ảnh từ Frigate' },
      });
    }

    // 2. Gọi AI Service
    const aiUrl = this.config.get<string>('AI_SERVICE_URL', 'http://localhost:8000');
    const token = this.config.get<string>('AI_INTERNAL_TOKEN', '');

    const formData = new FormData();
    formData.append('image', new Blob([new Uint8Array(imageBuffer)]), 'crop.jpg');
    formData.append('eventId', eventId);
    formData.append('requestId', crypto.randomUUID());
    formData.append('ownerScopeId', ownerScopeId);
    formData.append('collectionVersion', String(collectionVersion));

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000); // Timeout 5s theo yêu cầu

      const response = await fetch(`${aiUrl}/face/match`, {
        method: 'POST',
        headers: {
          'X-Internal-Token': token,
        },
        body: formData,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const result = (await response.json()) as AiComponents['schemas']['MatchResponse'];
      return await this.handleAiResult(eventId, result);
    } catch (err) {
      this.logger.error(`Lỗi gọi AI service cho event ${eventId}`, err);
      return this.handleAiResult(eventId, {
        requestId: crypto.randomUUID(),
        collectionVersion,
        personStatus: null,
        modelVersion: 'unknown',
        processedAt: new Date().toISOString(),
        similarity: null,
        labelConfidence: null,
        confidencePolicyVersion: 'v1',
        qualityReason: null,
        error: { code: 'TIMEOUT', message: 'Lỗi kết nối AI hoặc quá giờ' },
      });
    }
  }

  private async handleAiResult(
    eventId: string,
    result: AiComponents['schemas']['MatchResponse'],
  ): Promise<void> {
    this.logger.log(`Ket qua AI cho su kien ${eventId}:`, result);
    await this.eventsService.processFaceMatchResult(eventId, result);
  }
}
