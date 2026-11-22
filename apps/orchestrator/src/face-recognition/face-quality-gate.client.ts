import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  type FaceTrackOptimizationConfig,
  readFaceTrackOptimizationConfig,
} from './face-track-optimization.config';

export interface FaceQualityMetrics {
  faceWidthPx: number;
  faceHeightPx: number;
  detectionScore: number;
  sharpness: number;
  poseYawRatio: number;
  posePitchRatio: number;
}

export interface FaceAssessBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type FaceGateStatus = 'READY' | 'DISABLED' | 'UNAVAILABLE';

export interface FaceAssessResponse {
  passed: boolean;
  qualityScore: number;
  faceCount: number;
  rejectionReason: string | null;
  metrics: FaceQualityMetrics | null;
  boundingBox: FaceAssessBoundingBox | null;
  embeddingBase64: string | null;
  embeddingDim: number | null;
  modelVersion: string;
  gateStatus: FaceGateStatus;
}

export interface FaceQualityGateResult extends FaceAssessResponse {
  failOpenApplied: boolean;
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function parseBoundingBox(raw: unknown): FaceAssessBoundingBox | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Record<string, unknown>;
  const keys = ['x', 'y', 'width', 'height'] as const;
  if (
    !keys.every(
      (k) =>
        typeof candidate[k] === 'number' &&
        Number.isFinite(candidate[k]) &&
        (candidate[k] as number) >= 0 &&
        (candidate[k] as number) <= 1,
    )
  ) {
    return null;
  }
  const box: FaceAssessBoundingBox = {
    x: candidate.x as number,
    y: candidate.y as number,
    width: candidate.width as number,
    height: candidate.height as number,
  };
  if (box.x + box.width > 1 || box.y + box.height > 1) return null;
  return box;
}

function parseMetrics(raw: unknown): FaceQualityMetrics | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Record<string, unknown>;
  const keys = [
    'faceWidthPx',
    'faceHeightPx',
    'detectionScore',
    'sharpness',
    'poseYawRatio',
    'posePitchRatio',
  ] as const;
  if (!keys.every((k) => typeof candidate[k] === 'number' && Number.isFinite(candidate[k]))) {
    return null;
  }
  return {
    faceWidthPx: candidate.faceWidthPx as number,
    faceHeightPx: candidate.faceHeightPx as number,
    detectionScore: candidate.detectionScore as number,
    sharpness: candidate.sharpness as number,
    poseYawRatio: candidate.poseYawRatio as number,
    posePitchRatio: candidate.posePitchRatio as number,
  };
}

function isValidAssessPayload(value: unknown): value is FaceAssessResponse {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.passed === 'boolean' &&
    typeof candidate.qualityScore === 'number' &&
    Number.isFinite(candidate.qualityScore) &&
    typeof candidate.faceCount === 'number' &&
    Number.isFinite(candidate.faceCount) &&
    typeof candidate.modelVersion === 'string' &&
    (candidate.gateStatus === 'READY' ||
      candidate.gateStatus === 'DISABLED' ||
      candidate.gateStatus === 'UNAVAILABLE')
  );
}

/** Layer 2 HTTP client calling AI service /face/assess before cloud recognition dispatch. */
@Injectable()
export class FaceQualityGateClient {
  private readonly logger = new Logger(FaceQualityGateClient.name);
  private readonly optConfig: FaceTrackOptimizationConfig;

  constructor(@Optional() private readonly configService?: ConfigService) {
    this.optConfig = readFaceTrackOptimizationConfig(this.configService);
  }

  async assess(imageBuffer: Buffer): Promise<FaceQualityGateResult> {
    if (!this.optConfig.qualityGateEnabled) {
      return {
        passed: true,
        qualityScore: 1,
        faceCount: 1,
        rejectionReason: null,
        metrics: null,
        boundingBox: null,
        embeddingBase64: null,
        embeddingDim: null,
        modelVersion: 'disabled',
        gateStatus: 'DISABLED',
        failOpenApplied: false,
      };
    }

    const rawUrl =
      this.configService?.get<string>('AI_SERVICE_URL')?.trim() || 'http://localhost:8000';
    const aiUrl = rawUrl.replace(/\/+$/, '');
    const token = this.configService?.get<string>('AI_INTERNAL_TOKEN', '') ?? '';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.optConfig.qualityGateTimeoutMs);

    try {
      const formData = new FormData();
      formData.append(
        'image',
        new Blob([new Uint8Array(imageBuffer)], { type: 'image/jpeg' }),
        'crop.jpg',
      );
      formData.append('includeEmbedding', 'true');

      const response = await fetch(`${aiUrl}/face/assess`, {
        method: 'POST',
        headers: { 'X-Internal-Token': token },
        body: formData,
        signal: controller.signal,
      });

      if (!response.ok) {
        return this.fallbackOutcome(`HTTP_${response.status}`, 'UNAVAILABLE');
      }

      const json: unknown = await response.json();
      if (!isValidAssessPayload(json)) {
        return this.fallbackOutcome('INVALID_GATE_RESPONSE', 'UNAVAILABLE');
      }

      if (json.gateStatus === 'DISABLED') {
        return {
          passed: true,
          qualityScore: 1,
          faceCount: json.faceCount,
          rejectionReason: null,
          metrics: parseMetrics(json.metrics),
          boundingBox: parseBoundingBox(json.boundingBox),
          embeddingBase64: typeof json.embeddingBase64 === 'string' ? json.embeddingBase64 : null,
          embeddingDim: typeof json.embeddingDim === 'number' ? json.embeddingDim : null,
          modelVersion: json.modelVersion,
          gateStatus: 'DISABLED',
          failOpenApplied: false,
        };
      }

      if (json.gateStatus === 'UNAVAILABLE') {
        return this.fallbackOutcome(
          typeof json.rejectionReason === 'string' ? json.rejectionReason : 'MODEL_UNAVAILABLE',
          'UNAVAILABLE',
          json.modelVersion,
        );
      }

      return {
        passed: json.passed,
        qualityScore: clampUnit(json.qualityScore),
        faceCount: json.faceCount,
        rejectionReason: typeof json.rejectionReason === 'string' ? json.rejectionReason : null,
        metrics: parseMetrics(json.metrics),
        boundingBox: parseBoundingBox(json.boundingBox),
        embeddingBase64: typeof json.embeddingBase64 === 'string' ? json.embeddingBase64 : null,
        embeddingDim: typeof json.embeddingDim === 'number' ? json.embeddingDim : null,
        modelVersion: json.modelVersion,
        gateStatus: json.gateStatus,
        failOpenApplied: false,
      };
    } catch (error) {
      const isAbort = error instanceof Error && error.name === 'AbortError';
      const reason = isAbort ? 'QUALITY_GATE_TIMEOUT' : 'QUALITY_GATE_ERROR';
      this.logger.warn(
        { reason, failOpen: this.optConfig.qualityGateFailOpen },
        'Face quality gate request failed',
      );
      return this.fallbackOutcome(reason, 'UNAVAILABLE');
    } finally {
      clearTimeout(timeout);
    }
  }

  private fallbackOutcome(
    rejectionReason: string,
    gateStatus: FaceGateStatus,
    modelVersion = 'unavailable',
  ): FaceQualityGateResult {
    const failOpen = this.optConfig.qualityGateFailOpen;
    return {
      passed: failOpen,
      qualityScore: 0,
      faceCount: 0,
      rejectionReason,
      metrics: null,
      boundingBox: null,
      embeddingBase64: null,
      embeddingDim: null,
      modelVersion,
      gateStatus,
      failOpenApplied: failOpen,
    };
  }
}
