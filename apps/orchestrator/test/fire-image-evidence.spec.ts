import {
  fireBoxFilter,
  fireImageDetections,
  hasFireOnlyNotificationEvidence,
} from '../src/notifications/fire-image-evidence';
import { Test } from '@nestjs/testing';
import { DatabaseService } from '../src/database/database.service';
import { NotificationsRepository } from '../src/notifications/notifications.repository';

const box = {
  label: 'fire',
  confidence: 0.73,
  boundingBox: { x: 0.2, y: 0.3, width: 0.4, height: 0.5 },
};
describe('fire photo evidence', () => {
  it('skips queued legacy fire notifications without changing other event delivery', async () => {
    const database = { query: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [NotificationsRepository, { provide: DatabaseService, useValue: database }],
    }).compile();
    try {
      const repository = module.get(NotificationsRepository);
      const event = { status: 'NOTIFIED', event_type: 'FIRE_SMOKE_DETECTED', ai_results: [] };
      database.query.mockResolvedValue({ rows: [event] });
      await expect(repository.eventAllowsDelivery('event', 0)).resolves.toBe(false);
      const result = {
        module: 'M3_FIRE',
        label: 'FIRE_SMOKE_DETECTED',
        status: 'SUCCESS',
        metadata: {
          incidentConfidencePolicyVersion: 'fire-only-temporal-min-v1',
          labels: ['fire'],
          detections: [box],
        },
      };
      database.query.mockResolvedValue({ rows: [{ ...event, ai_results: [result] }] });
      await expect(repository.eventAllowsDelivery('event', 0)).resolves.toBe(true);
      database.query.mockResolvedValue({ rows: [{ ...event, event_type: 'UNKNOWN_PERSON' }] });
      await expect(repository.eventAllowsDelivery('event', 0)).resolves.toBe(true);
      database.query.mockResolvedValue({
        rows: [{ ...event, status: 'RESOLVED', ai_results: [result] }],
      });
      await expect(repository.eventAllowsDelivery('event', 0)).resolves.toBe(false);
    } finally {
      await module.close();
    }
  });
  it('allows only current fire-only results for new notifications', () => {
    const metadata = {
      incidentConfidencePolicyVersion: 'fire-only-temporal-min-v1',
      labels: ['fire'],
      detections: [box],
    };
    const result = {
      module: 'M3_FIRE',
      label: 'FIRE_SMOKE_DETECTED',
      status: 'SUCCESS',
      metadata,
    };
    expect(hasFireOnlyNotificationEvidence([result])).toBe(true);
    expect(hasFireOnlyNotificationEvidence([{ ...result, status: 'ERROR' }])).toBe(false);
    expect(
      hasFireOnlyNotificationEvidence([
        {
          ...result,
          metadata: {
            ...metadata,
            incidentConfidencePolicyVersion: 'fire-temporal-min-v1',
          },
        },
      ]),
    ).toBe(false);
    expect(
      hasFireOnlyNotificationEvidence([
        {
          ...result,
          metadata: {
            ...metadata,
            detections: [{ ...box, label: 'smoke' }],
          },
        },
      ]),
    ).toBe(false);
    expect(hasFireOnlyNotificationEvidence([])).toBe(false);
  });
  it('draws only fire boxes and discards legacy smoke detections', () => {
    const items = fireImageDetections(
      { frameId: 'frame', detections: [box, { ...box, label: 'smoke' }] },
      32,
    );
    expect(fireBoxFilter(items, 5)).toContain(
      'x=iw*0.200000:y=ih*0.300000:w=iw*0.400000:h=ih*0.500000:color=0xFF4937',
    );
    expect(items).toHaveLength(1);
    expect(fireBoxFilter(items, 5)).not.toContain('color=0xFACC15');
    expect(
      fireImageDetections({ frameId: 'frame', detections: [{ ...box, label: 'smoke' }] }, 32),
    ).toEqual([]);
  });
  it('rejects malformed/out-of-frame evidence instead of drawing a fabricated region', () => {
    expect(
      fireImageDetections(
        {
          frameId: 'frame',
          detections: [
            { ...box, boundingBox: { ...box.boundingBox, x: 0.9 } },
            { ...box, label: 'person' },
          ],
        },
        32,
      ),
    ).toEqual([]);
    expect(fireImageDetections({ detections: [box] }, 32)).toEqual([]);
  });
});
