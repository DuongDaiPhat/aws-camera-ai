import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiResultsService } from '../../ai-results/ai-results.service';
import type { SubmitAiResultDto } from '../../ai-results/dto/submit-ai-result.dto';
import { PoseInferenceAdapter } from '../adapter/pose-inference.adapter';
import type { PosePersonDto } from '../dto/pose-frame.dto';
import { RestAreaEvaluator } from '../evaluator/rest-area.evaluator';
import { FallIncidentRepository } from '../repository/fall-incident.repository';

const DEFAULT_FALL_IMMOBILITY_SECONDS = 15;

export interface ProcessFrameContext {
  cameraId: string;
  cameraSlug: string;
  sourceSessionId: string;
  frameId: string;
  frameTimestamp: Date;
  imageBytes: Buffer;
  persons: PosePersonDto[];
}

@Injectable()
export class FallIncidentCoordinator {
  private readonly logger = new Logger(FallIncidentCoordinator.name);
  private readonly fallImmobilitySeconds: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly restAreaEvaluator: RestAreaEvaluator,
    private readonly poseInferenceAdapter: PoseInferenceAdapter,
    private readonly fallIncidentRepository: FallIncidentRepository,
    private readonly aiResultsService: AiResultsService,
  ) {
    this.fallImmobilitySeconds = Number(
      this.configService.get<string | number>(
        'FALL_IMMOBILITY_SECONDS',
        DEFAULT_FALL_IMMOBILITY_SECONDS,
      ),
    );
  }

  /**
   * Điều phối phân tích chuỗi khung hình cho từng người được phát hiện (US-17).
   */
  async processFrame(context: ProcessFrameContext): Promise<void> {
    for (const person of context.persons) {
      await this.processPersonTrack(context, person);
    }
  }

  private async processPersonTrack(
    context: ProcessFrameContext,
    person: PosePersonDto,
  ): Promise<void> {
    const { cameraId, cameraSlug, sourceSessionId, frameId, frameTimestamp, imageBytes } = context;

    // AC17-3: Kiểm tra người có nằm trong vùng nghỉ (REST_AREA) không
    const inRestArea = await this.restAreaEvaluator.isPersonInRestArea(cameraId, person.boundingBox);

    const response = await this.poseInferenceAdapter.evaluateFall({
      imageBytes,
      trackId: person.trackId,
      cameraSlug,
      frameTimestamp: frameTimestamp.toISOString(),
      frameId,
      sourceSessionId,
      personBoundingBox: person.boundingBox,
      inRestArea,
    });

    if (!response) {
      return;
    }

    // AC17-2: Khi người đứng dậy trong 15s hoặc candidate bị hủy -> chỉ ghi log nội bộ, KHÔNG cảnh báo
    if (response.state === 'CANCELLED') {
      this.logger.debug(
        `[M2A_CANDIDATE_CANCELLED] Track ${person.trackId} trên camera ${cameraSlug} đã hủy candidate (reason: ${response.reason})`,
      );
      return;
    }

    if (response.state === 'CANDIDATE') {
      this.logger.log(
        `[M2A_CANDIDATE] Track ${person.trackId} camera ${cameraSlug}: bất động ${response.immobileSeconds ?? 0}s / ${this.fallImmobilitySeconds}s (góc thân: ${response.torsoAngleDeg ?? 'N/A'}°)`,
      );
    }

    // AC17-1: Khi tư thế ngã và bất động duy trì > 15s -> CONFIRMED
    if (response.state === 'CONFIRMED' && !inRestArea && response.error === null) {
      this.logger.warn(
        `[M2A_CONFIRMED] Track ${person.trackId} camera ${cameraSlug} ĐÃ XÁC NHẬN TÉ NGÃ BẤT ĐỘNG! Tạo sự kiện P1 khẩn cấp...`,
      );
      await this.handleConfirmedFall(context, person, response);
    }
  }

  private async handleConfirmedFall(
    context: ProcessFrameContext,
    person: PosePersonDto,
    response: NonNullable<Awaited<ReturnType<PoseInferenceAdapter['evaluateFall']>>>,
  ): Promise<void> {
    const { cameraId, cameraSlug, sourceSessionId, frameId } = context;

    const episodeId = response.episodeId ?? randomUUID();
    const defaultWindowMs = this.fallImmobilitySeconds * 1000;
    const confirmedAt = response.confirmedAt ? new Date(response.confirmedAt) : new Date();
    const candidateStartedAt = response.candidateStartedAt
      ? new Date(response.candidateStartedAt)
      : new Date(confirmedAt.getTime() - defaultWindowMs);
    const resultId = randomUUID();

    const ruleSnapshot: Record<string, unknown> = {
      immobileSeconds: response.immobileSeconds ?? this.fallImmobilitySeconds,
      thresholdSeconds: response.thresholdSeconds ?? this.fallImmobilitySeconds,
      torsoAngleDeg: response.torsoAngleDeg,
      centerHeight: response.centerHeight,
      centerDropRatio: response.centerDropRatio,
      motionScore: response.motionScore,
      policyVersion: response.confidencePolicyVersion ?? 'fall-rule-evidence-v1',
    };

    const pendingPayload: Record<string, unknown> = {
      cameraSlug,
      trackId: person.trackId,
      episodeId,
      confidence: response.confidence ?? 1.0,
      ruleSnapshot,
    };

    // 1. Lưu bản ghi sự kiện và incident vào database (Idempotent theo episode)
    const incidentResult = await this.fallIncidentRepository.createConfirmedIncident({
      cameraId,
      sourceSessionId,
      trackId: person.trackId,
      episodeId,
      candidateStartedAt,
      confirmedAt,
      modelVersion: response.modelVersion,
      ruleSnapshot,
      resultId,
      pendingPayload,
    });

    if (!incidentResult.isNew) {
      this.logger.debug(
        `Incident té ngã episode ${episodeId} đã được xử lý trước đó (deduped)`,
      );
      return;
    }

    // 2. Kích hoạt luồng AI Result submission -> phát SSE lên Web Dashboard & Telegram P1
    const submitDto: SubmitAiResultDto = {
      schemaVersion: 1,
      resultId: incidentResult.resultId,
      eventId: incidentResult.eventId,
      observationId: `fall:${sourceSessionId}:${person.trackId}:${episodeId}`,
      revision: 1,
      module: 'M2A_FALL',
      modelVersion: response.modelVersion,
      processedAt: response.processedAt,
      results: [
        {
          module: 'M2A_FALL',
          label: 'FALL_DETECTED',
          confidence: response.confidence ?? 1.0,
          boundingBox: {
            x: person.boundingBox.x,
            y: person.boundingBox.y,
            width: person.boundingBox.width,
            height: person.boundingBox.height,
          },
          metadata: {
            cameraId,
            trackId: person.trackId,
            sourceSessionId,
            episodeId,
            frameId,
            candidateStartedAt: candidateStartedAt.toISOString(),
            confirmedAt: confirmedAt.toISOString(),
            immobileSeconds: response.immobileSeconds ?? this.fallImmobilitySeconds,
            thresholdSeconds: response.thresholdSeconds ?? this.fallImmobilitySeconds,
            torsoAngleDeg: response.torsoAngleDeg ?? 0,
            aspectRatio: response.aspectRatio ?? 0,
            centerHeight: response.centerHeight ?? 0,
            centerDropRatio: response.centerDropRatio ?? 0,
            motionScore: response.motionScore ?? 0,
            inRestArea: false,
            confidencePolicyVersion: response.confidencePolicyVersion ?? 'fall-rule-evidence-v1',
          },
        },
      ],
      error: null,
    };

    try {
      await this.aiResultsService.submit(incidentResult.eventId, submitDto);
      await this.fallIncidentRepository.markApplied(incidentResult.fallIncidentId);

      this.logger.log(
        `[FALL_ALERT_TRIGGERED] ĐÃ PHÁT HIỆN VÀ KÍCH HOẠT CẢNH BÁO TÉ NGÃ P1 trên camera ${cameraSlug} (track: ${person.trackId}, event: ${incidentResult.eventId})`,
      );
    } catch (error) {
      this.logger.error(
        `Lỗi khi submit kết quả AI té ngã cho event ${incidentResult.eventId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
