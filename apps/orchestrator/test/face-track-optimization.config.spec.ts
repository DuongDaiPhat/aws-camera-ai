import { ConfigService } from '@nestjs/config';
import { readFaceTrackOptimizationConfig } from '../src/face-recognition/face-track-optimization.config';

describe('Best-Shot production configuration', () => {
  it('waits for observation, requires paired frames and fails closed by default', () => {
    expect(readFaceTrackOptimizationConfig(new ConfigService({}))).toMatchObject({
      bestShotWindowMs: 4000,
      bestShotMaxSamples: 32,
      minSampleIntervalMs: 150,
      bestShotEarlyDispatchEnabled: false,
      requireTimestampedFrame: true,
      qualityGateFailOpen: false,
      sessionCacheSimilarityThreshold: 0.52,
      sessionCacheMaxPrototypes: 5,
      sessionCachePrototypeDedupThreshold: 0.92,
      maxConcurrentAssessPerCamera: 2,
    });
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
    ).toBe(2);
    expect(
      readFaceTrackOptimizationConfig(
        new ConfigService({ FACE_MAX_CONCURRENT_ASSESS_PER_CAMERA: '-1' }),
      ).maxConcurrentAssessPerCamera,
    ).toBe(2);
    expect(
      readFaceTrackOptimizationConfig(
        new ConfigService({ FACE_MAX_CONCURRENT_ASSESS_PER_CAMERA: 'abc' }),
      ).maxConcurrentAssessPerCamera,
    ).toBe(2);
  });
});
