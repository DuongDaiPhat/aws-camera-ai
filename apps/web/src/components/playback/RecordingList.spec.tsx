// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi } from 'vitest';
import { RecordingList } from './RecordingList';
import type { RecordingDay } from '@/types';
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
describe('Daily recordings panel', () => {
  it('shows chronological continuous ranges with no time search or duplicate date controls', async () => {
    const choose = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const day: RecordingDay = {
      cameraId: 'camera',
      date: '2026-11-17',
      timeZone: 'UTC',
      dayStartAt: '2026-11-17T00:00:00Z',
      dayEndAt: '2026-11-18T00:00:00Z',
      recordingEnabled: true,
      retentionDays: 1,
      isFutureDate: false,
      segments: [
        {
          id: 'a',
          startAt: '2026-11-17T01:00:00Z',
          endAt: '2026-11-17T01:02:00Z',
          durationSeconds: 120,
          hasMotion: false,
        },
        {
          id: 'b',
          startAt: '2026-11-17T01:02:00Z',
          endAt: '2026-11-17T01:04:00Z',
          durationSeconds: 120,
          hasMotion: false,
        },
      ],
    };
    await act(async () =>
      root.render(
        <RecordingList
          cameraName="Phòng khách"
          day={day}
          loading={false}
          onChoose={choose}
          onRetry={() => {}}
        />,
      ),
    );
    const range = Array.from(host.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('01:00:00'),
    );
    expect(range?.textContent).toContain('01:04:00');
    expect(host.querySelector('input')).toBeNull();
    expect(host.textContent).not.toContain('Tìm thời điểm');
    await act(async () => range?.click());
    expect(Date.parse(choose.mock.calls[0]?.[0])).toBe(Date.parse('2026-11-17T01:00:00Z'));
    await act(async () => root.unmount());
    host.remove();
  });
});
