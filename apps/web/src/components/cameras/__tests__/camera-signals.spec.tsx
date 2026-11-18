// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { EventDetail, UIEventItem } from '@/types';
import { CameraAnnotations } from '../CameraAnnotations';
import { CameraSignalsProvider, cameraSignals, liveIncidentBoxes } from '../live/CameraSignals';
import { fetchEventDetail } from '@/lib/events-client';
vi.mock('@/lib/events-client', () => ({ fetchEventDetail: vi.fn() }));

function incident(id: string, eventType: UIEventItem['eventType'], now: number): UIEventItem {
  return {
    id,
    eventType,
    camera: { id: 'cam', name: 'Bếp' },
    detectedAt: new Date(now).toISOString(),
    priority: 'P0',
    status: 'NOTIFIED',
    isFalseAlarm: false,
    cameraCode: 'CAM 1',
    aiTag: '',
    relativeTimeText: '',
  };
}
const person = {
  id: 'person',
  x: 0.1,
  y: 0.2,
  width: 0.3,
  height: 0.4,
  confidence: 0.92,
  label: 'person',
};
it('renders real fire/fall alerts and confirmed geometry in the common camera layer, never on another camera', async () => {
  vi.useFakeTimers();
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    value: true,
    configurable: true,
  });
  const now = Date.now(),
    fire = incident('fire', 'FIRE_SMOKE_DETECTED', now),
    fall = incident('fall', 'FALL_DETECTED', now);
  const detail = (event: UIEventItem): EventDetail =>
    ({
      ...event,
      aiResults: [
        {
          module: event.id === 'fire' ? 'M3_FIRE' : 'M2A_FALL',
          label: event.eventType,
          status: 'SUCCESS',
          metadata: { confirmedAt: new Date(now).toISOString() },
          confidence: 0.98,
          boundingBox: { x: 0.1, y: 0.1, width: 0.4, height: 0.4 },
        },
      ],
    }) as unknown as EventDetail;
  vi.mocked(fetchEventDetail).mockImplementation(async (id) => detail(id === 'fire' ? fire : fall));
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <CameraSignalsProvider events={[fire, fall]}>
          <section id="matching">
            <CameraAnnotations cameraId="cam" people={[person]} height={562.5} />
          </section>
          <section id="other">
            <CameraAnnotations cameraId="other" people={[]} height={562.5} />
          </section>
        </CameraSignalsProvider>,
      ),
    );
    expect(host.querySelector('#matching')?.textContent).toContain('person 92%');
    expect(host.querySelector('#matching [data-signal="fire"]')?.textContent).toContain(
      'Phát hiện lửa',
    );
    expect(host.querySelector('#matching [data-signal="fall"]')?.textContent).toContain('té ngã');
    expect(host.querySelectorAll('#matching svg > g')).toHaveLength(3);
    expect(host.querySelectorAll('#other [data-signal]')).toHaveLength(0);
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    expect(host.querySelectorAll('#matching svg > g')).toHaveLength(1); // no stale incident position
    expect(host.querySelector('#matching [data-signal="fire"]')).toBeNull();
    await act(async () =>
      root.render(
        <CameraSignalsProvider
          events={[
            { ...fire, status: 'RESOLVED' },
            { ...fall, isFalseAlarm: true },
          ]}
        >
          <CameraAnnotations cameraId="cam" people={[]} height={562.5} />
        </CameraSignalsProvider>,
      ),
    );
    expect(host.querySelector('[data-signal]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.useRealTimers();
  }
});
it('does not infer fire/fall boxes from a person result, unsuccessful AI or stale geometry', () => {
  const now = Date.now(),
    event = incident('x', 'FALL_DETECTED', now);
  const result = {
    module: 'M1_FACE',
    label: 'PERSON_DETECTED',
    status: 'SUCCESS',
    confidence: 0.9,
    boundingBox: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
    metadata: { confirmedAt: new Date(now).toISOString() },
  };
  expect(
    liveIncidentBoxes({ ...event, aiResults: [result] } as unknown as EventDetail, now),
  ).toEqual([]);
  expect(
    cameraSignals(
      [{ ...event, camera: { id: 'other', name: 'Other' } }] as UIEventItem[],
      'cam',
      now,
    ),
  ).toEqual([]);
});

it('never promotes old pending P0/P1 incidents into current fire or fall detections', () => {
  const now = Date.now();
  expect(
    cameraSignals(
      [
        incident('old-fire', 'FIRE_SMOKE_DETECTED', now - 86400000),
        incident('old-fall', 'FALL_DETECTED', now - 86400000),
      ],
      'cam',
      now,
    ),
  ).toEqual([]);
});

it('does not show a current fire label when detail has no confirmed fire geometry', async () => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    value: true,
    configurable: true,
  });
  const event = incident('no-box', 'FIRE_SMOKE_DETECTED', Date.now());
  vi.mocked(fetchEventDetail).mockResolvedValue({
    ...event,
    aiResults: [],
  } as unknown as EventDetail);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <CameraSignalsProvider events={[event]}>
          <CameraAnnotations cameraId="cam" people={[person]} height={562.5} />
        </CameraSignalsProvider>,
      ),
    );
    expect(host.querySelector('[data-signal="fire"]')).toBeNull();
    expect(host.querySelector('[data-signal="person"]')).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
