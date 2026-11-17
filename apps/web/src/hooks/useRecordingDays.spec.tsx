// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { it, expect, vi } from 'vitest';
import { useRecordingDays } from './useRecordingDays';
import { getRecordingDay } from '@/lib/playback-client';
import type { RecordingDay } from '@/types';
vi.mock('@/lib/playback-client', () => ({ getRecordingDay: vi.fn() }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
it('polls new recordings without clearing the day already being played', async () => {
  vi.useFakeTimers();
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  const day: RecordingDay = {
    cameraId: 'camera',
    date: '2026-11-17',
    timeZone: 'UTC',
    dayStartAt: '2026-11-17T00:00:00Z',
    dayEndAt: '2026-11-18T00:00:00Z',
    recordingEnabled: true,
    retentionDays: 1,
    isFutureDate: false,
    segments: [],
  };
  vi.mocked(getRecordingDay)
    .mockResolvedValueOnce(day)
    .mockRejectedValueOnce(new Error('Temporary archive failure'));
  function Harness() {
    const state = useRecordingDays(['camera'], '2026-11-17');
    return (
      <output>
        {state.days.camera?.date ?? 'blank'}|{state.errors.camera}
      </output>
    );
  }
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<Harness />));
    expect(host.textContent).toBe('2026-11-17|');
    await act(async () => vi.advanceTimersByTimeAsync(10000));
    expect(getRecordingDay).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain('2026-11-17|Temporary archive failure');
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.useRealTimers();
  }
});
