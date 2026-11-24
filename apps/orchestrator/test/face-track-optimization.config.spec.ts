import { ConfigService } from '@nestjs/config';
import { readFaceTrackOptimizationConfig } from '../src/face-recognition/face-track-optimization.config';

describe('Best-Shot production configuration', () => {
  it('waits for observation, requires paired frames and fails closed by default', () => {
    expect(readFaceTrackOptimizationConfig(new ConfigService({}))).toMatchObject({
      qualityGateTimeoutMs: 3500,
      bestShotWindowMs: 4000,
      bestShotMaxSamples: 32,
      minSampleIntervalMs: 150,
      bestShotEarlyDispatchEnabled: false,
      requireTimestampedFrame: true,
      qualityGateFailOpen: false,
      sessionCacheSimilarityThreshold: 0.52,
      sessionCacheMaxPrototypes: 5,
      sessionCachePrototypeDedupThreshold: 0.92,
      maxConcurrentAssessPerCamera: 1,
    });
  });

  it('reads FACE_QUALITY_GATE_TIMEOUT_MS override and falls back on invalid values', () => {
    expect(
      readFaceTrackOptimizationConfig(new ConfigService({ FACE_QUALITY_GATE_TIMEOUT_MS: '5000' }))
        .qualityGateTimeoutMs,
    ).toBe(5000);
    expect(
      readFaceTrackOptimizationConfig(new ConfigService({ FACE_QUALITY_GATE_TIMEOUT_MS: '0' }))
        .qualityGateTimeoutMs,
    ).toBe(3500);
    expect(
      readFaceTrackOptimizationConfig(new ConfigService({ FACE_QUALITY_GATE_TIMEOUT_MS: '-10' }))
        .qualityGateTimeoutMs,
    ).toBe(3500);
    expect(
      readFaceTrackOptimizationConfig(new ConfigService({ FACE_QUALITY_GATE_TIMEOUT_MS: 'abc' }))
        .qualityGateTimeoutMs,
    ).toBe(3500);
  });

  it('reads FACE_MAX_CONCURRENT_ASSESS_PER_CAMERA override and falls back on invalid values', () => {
    expect(
      readFaceTrackOptimizationConfig(
        new ConfigService({ FACE_MAX_CONCURRENT_ASSESS_PER_CAMERA: '4' }),
      ).maxConcurrentAssessPerCamera,
    ).toBe(4);
    expect(
      readFaceTrackOptimizationConfig(
        new ConfigService({ FACE_MAX_CONCURRENT_ASSESS_PER_CAMERA: '0' }),
      ).maxConcurrentAssessPerCamera,
    ).toBe(1);
    expect(
      readFaceTrackOptimizationConfig(
        new ConfigService({ FACE_MAX_CONCURRENT_ASSESS_PER_CAMERA: '-1' }),
      ).maxConcurrentAssessPerCamera,
    ).toBe(1);
    expect(
      readFaceTrackOptimizationConfig(
        new ConfigService({ FACE_MAX_CONCURRENT_ASSESS_PER_CAMERA: 'abc' }),
      ).maxConcurrentAssessPerCamera,
    ).toBe(1);
  });
});
