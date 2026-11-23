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
    });
  });
});
