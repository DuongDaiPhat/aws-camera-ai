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

  it('preserves fire confidence and rejects smoke and out-of-frame boxes', () => {
    const valid = {
      label: 'fire',
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
            incidentConfidencePolicyVersion: 'fire-only-temporal-min-v1',
            consecutiveFrames: 3,
            windowSeconds: 5,
            detections: [
              valid,
              { ...valid, label: 'smoke', confidence: 0.99 },
              { ...valid, boundingBox: { x: 0.9, y: 0, width: 0.3, height: 0.4 } },
              { ...valid, label: 'person' },
              { ...valid, confidence: Number.NaN },
            ],
          },
        },
      ],
    };
    expect(fireEvidence(detail)).toEqual({ count: 3, window: 5, detections: [valid] });
    const metadata = detail.aiResults?.[0]?.metadata;
    if (!metadata) throw new Error('Missing test fire metadata');
    metadata.detections = [{ ...valid, label: 'smoke' }];
    expect(fireEvidence(detail)).toBeNull();
    metadata.detections = [valid];
    metadata.incidentConfidencePolicyVersion = 'fire-temporal-min-v1';
    expect(fireEvidence(detail)).toBeNull();
  });
});
