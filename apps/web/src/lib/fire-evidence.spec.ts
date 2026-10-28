import { describe, expect, it } from 'vitest';
import { fireEvidence } from './fire-evidence';
import type { EventDetail } from '@/types';

describe('fire evidence', () => {
  it('does not render absent or malformed metadata', () => {
    expect(fireEvidence(null)).toBeNull();
    const detail: EventDetail = {
      id: 'id',
      eventType: 'FIRE_SMOKE_DETECTED',
      status: 'DETECTED',
      priority: 'P0',
      detectedAt: new Date().toISOString(),
      aiResults: [],
    };
    expect(fireEvidence(detail)).toBeNull();
  });

  it('preserves fire/smoke confidence and filters boxes outside the source image', () => {
    const valid = {
      label: 'smoke',
      confidence: 0.83,
      boundingBox: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
    };
    const detail: EventDetail = {
      id: 'id',
      eventType: 'FIRE_SMOKE_DETECTED',
      status: 'DETECTED',
      priority: 'P0',
      detectedAt: new Date().toISOString(),
      aiResults: [
        {
          module: 'M3_FIRE',
          resultId: 'result',
          observationId: 'fire:session:episode',
          revision: 1,
          modelVersion: 'fire-smoke-yolo26n-v1',
          processedAt: new Date().toISOString(),
          label: 'FIRE_SMOKE_DETECTED',
          confidence: 0.81,
          status: 'SUCCESS',
          metadata: {
            consecutiveFrames: 3,
            windowSeconds: 5,
            detections: [
              valid,
              { ...valid, boundingBox: { x: 0.9, y: 0, width: 0.3, height: 0.4 } },
              { ...valid, label: 'person' },
              { ...valid, confidence: Number.NaN },
            ],
          },
        },
      ],
    };
    expect(fireEvidence(detail)).toEqual({ count: 3, window: 5, detections: [valid] });
  });
});
