import type { ConfigService } from '@nestjs/config';

export interface FaceTrackOptimizationConfig {
  enabled: boolean;
  qualityGateEnabled: boolean;
  qualityGateFailOpen: boolean;
  qualityGateTimeoutMs: number;
  bestShotWindowMs: number;
  bestShotMaxSamples: number;
  bestShotEarlyDispatchScore: number;
  minSampleIntervalMs: number;
  undeterminedMaxRetries: number;
  undeterminedRetryCooldownMs: number;
  unknownAllowSingleRecheck: boolean;
  unknownRecheckMinQualityGain: number;
  sessionCacheEnabled: boolean;
  sessionCacheTtlMs: number;
  sessionCacheSimilarityThreshold: number;
  spatialReidEnabled: boolean;
  spatialReidMaxGapMs: number;
  spatialReidMinProximityScore: number;
  spatialReidMinAppearanceSimilarity: number;
  trackStateTtlMs: number;
}

export const DEFAULT_FACE_TRACK_OPTIMIZATION_CONFIG: FaceTrackOptimizationConfig = {
  enabled: true,
  qualityGateEnabled: true,
  qualityGateFailOpen: true,
  qualityGateTimeoutMs: 2000,
  bestShotWindowMs: 1200,
  bestShotMaxSamples: 4,
  bestShotEarlyDispatchScore: 0.82,
  minSampleIntervalMs: 350,
  undeterminedMaxRetries: 2,
  undeterminedRetryCooldownMs: 4000,
  unknownAllowSingleRecheck: true,
  unknownRecheckMinQualityGain: 0.15,
  sessionCacheEnabled: true,
  sessionCacheTtlMs: 300000,
  sessionCacheSimilarityThreshold: 0.72,
  spatialReidEnabled: true,
  spatialReidMaxGapMs: 20000,
  spatialReidMinProximityScore: 0.35,
  spatialReidMinAppearanceSimilarity: 0.78,
  trackStateTtlMs: 120000,
};

function readBoolean(config: ConfigService | undefined, key: string, fallback: boolean): boolean {
  if (!config) return fallback;
  const raw = config.get<string | boolean>(key);
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw === 'boolean') return raw;
  const normalized = String(raw).trim().toLowerCase();
  if (normalized === '') return fallback;
  if (normalized === 'true' || normalized === '1') return true;
  if (normalized === 'false' || normalized === '0') return false;
  return fallback;
}

function readPositiveNumber(
  config: ConfigService | undefined,
  key: string,
  fallback: number,
): number {
  if (!config) return fallback;
  const raw = config.get<string | number>(key);
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw === 'string' && raw.trim() === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readNonNegativeNumber(
  config: ConfigService | undefined,
  key: string,
  fallback: number,
): number {
  if (!config) return fallback;
  const raw = config.get<string | number>(key);
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw === 'string' && raw.trim() === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function readPositiveInt(config: ConfigService | undefined, key: string, fallback: number): number {
  if (!config) return fallback;
  const raw = config.get<string | number>(key);
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw === 'string' && raw.trim() === '') return fallback;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : fallback;
}

function readNonNegativeInt(
  config: ConfigService | undefined,
  key: string,
  fallback: number,
): number {
  if (!config) return fallback;
  const raw = config.get<string | number>(key);
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw === 'string' && raw.trim() === '') return fallback;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function readUnitNumber(config: ConfigService | undefined, key: string, fallback: number): number {
  if (!config) return fallback;
  const raw = config.get<string | number>(key);
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw === 'string' && raw.trim() === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback;
}

/** Reads Layer 1-4 face recognition optimization settings with safe production defaults. */
export function readFaceTrackOptimizationConfig(
  config?: ConfigService,
): FaceTrackOptimizationConfig {
  const d = DEFAULT_FACE_TRACK_OPTIMIZATION_CONFIG;
  return {
    enabled: readBoolean(config, 'FACE_TRACK_OPTIMIZATION_ENABLED', d.enabled),
    qualityGateEnabled: readBoolean(config, 'FACE_QUALITY_GATE_ENABLED', d.qualityGateEnabled),
    qualityGateFailOpen: readBoolean(config, 'FACE_QUALITY_GATE_FAIL_OPEN', d.qualityGateFailOpen),
    qualityGateTimeoutMs: readPositiveNumber(
      config,
      'FACE_QUALITY_GATE_TIMEOUT_MS',
      d.qualityGateTimeoutMs,
    ),
    bestShotWindowMs: readNonNegativeNumber(config, 'FACE_BEST_SHOT_WINDOW_MS', d.bestShotWindowMs),
    bestShotMaxSamples: readPositiveInt(config, 'FACE_BEST_SHOT_MAX_SAMPLES', d.bestShotMaxSamples),
    bestShotEarlyDispatchScore: readUnitNumber(
      config,
      'FACE_BEST_SHOT_EARLY_DISPATCH_SCORE',
      d.bestShotEarlyDispatchScore,
    ),
    minSampleIntervalMs: readNonNegativeNumber(
      config,
      'FACE_MIN_SAMPLE_INTERVAL_MS',
      d.minSampleIntervalMs,
    ),
    undeterminedMaxRetries: readNonNegativeInt(
      config,
      'FACE_UNDETERMINED_MAX_RETRIES',
      d.undeterminedMaxRetries,
    ),
    undeterminedRetryCooldownMs: readNonNegativeNumber(
      config,
      'FACE_UNDETERMINED_RETRY_COOLDOWN_MS',
      d.undeterminedRetryCooldownMs,
    ),
    unknownAllowSingleRecheck: readBoolean(
      config,
      'FACE_UNKNOWN_ALLOW_SINGLE_RECHECK',
      d.unknownAllowSingleRecheck,
    ),
    unknownRecheckMinQualityGain: readUnitNumber(
      config,
      'FACE_UNKNOWN_RECHECK_MIN_QUALITY_GAIN',
      d.unknownRecheckMinQualityGain,
    ),
    sessionCacheEnabled: readBoolean(config, 'FACE_SESSION_CACHE_ENABLED', d.sessionCacheEnabled),
    sessionCacheTtlMs: readPositiveNumber(config, 'FACE_SESSION_CACHE_TTL_MS', d.sessionCacheTtlMs),
    sessionCacheSimilarityThreshold: readUnitNumber(
      config,
      'FACE_SESSION_CACHE_SIMILARITY_THRESHOLD',
      d.sessionCacheSimilarityThreshold,
    ),
    spatialReidEnabled: readBoolean(config, 'FACE_SPATIAL_REID_ENABLED', d.spatialReidEnabled),
    spatialReidMaxGapMs: readPositiveNumber(
      config,
      'FACE_SPATIAL_REID_MAX_GAP_MS',
      d.spatialReidMaxGapMs,
    ),
    spatialReidMinProximityScore: readUnitNumber(
      config,
      'FACE_SPATIAL_REID_MIN_PROXIMITY_SCORE',
      d.spatialReidMinProximityScore,
    ),
    spatialReidMinAppearanceSimilarity: readUnitNumber(
      config,
      'FACE_SPATIAL_REID_MIN_APPEARANCE_SIMILARITY',
      d.spatialReidMinAppearanceSimilarity,
    ),
    trackStateTtlMs: readPositiveNumber(config, 'FACE_TRACK_STATE_TTL_MS', d.trackStateTtlMs),
  };
}
