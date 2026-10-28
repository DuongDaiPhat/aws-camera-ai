import { describe, expect, it } from 'vitest';
import { generateSimulatedLiveEvent } from '@/lib/mock-events';
import type { UIEventItem } from '@/types';
import { calculateCounts, filterEvents } from './useEvents';

function fire(status: UIEventItem['status'], cameraName = 'Bep'): UIEventItem {
  const template = generateSimulatedLiveEvent();
  return {
    ...template,
    detectedAt: '2026-10-27T09:06:43Z',
    eventType: 'FIRE_SMOKE_DETECTED',
    priority: 'P0',
    status,
    zone: null,
    camera: { ...template.camera, id: 'camera', name: cameraName },
  };
}

describe('fire event status and room filters', () => {
  it('removes a resolved or closed P0 event from the pending tab', () => {
    const events = [fire('ESCALATED'), fire('RESOLVED'), fire('CLOSED')];
    expect(calculateCounts(events)).toEqual({ all: 3, urgent: 1, safe: 2, info: 0 });
    expect(filterEvents(events, 'URGENT', 'ALL').map((event) => event.status)).toEqual([
      'ESCALATED',
    ]);
    expect(filterEvents(events, 'SAFE', 'ALL').map((event) => event.status)).toEqual([
      'RESOLVED',
      'CLOSED',
    ]);
  });
  it('matches the existing ASCII kitchen and living-room names', () => {
    const events = [fire('NOTIFIED', 'Bep'), fire('NOTIFIED', 'Phong khach')];
    expect(filterEvents(events, 'ALL', 'bep').map((event) => event.camera?.name)).toEqual(['Bep']);
    expect(filterEvents(events, 'ALL', 'phong-khach').map((event) => event.camera?.name)).toEqual([
      'Phong khach',
    ]);
  });
});
