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

it('awaits a manual refresh, shares an in-flight poll, and retains the last day on failure', async () => {
  vi.mocked(getRecordingDay).mockReset();
  let finish: (day: RecordingDay) => void = () => {};
  const pending = new Promise<RecordingDay>((resolve) => {
    finish = resolve;
  });
  vi.mocked(getRecordingDay).mockReturnValueOnce(pending);
  let current: ReturnType<typeof useRecordingDays>;
  function Harness() {
    current = useRecordingDays(['camera'], '2026-11-18');
    return (
      <output>
        {String(current.isRefreshing)}|{current.days.camera?.date ?? 'blank'}
      </output>
    );
  }
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<Harness />));
    expect(host.textContent).toBe('true|blank');
    let refresh!: Promise<boolean>;
    await act(async () => {
      refresh = current!.retry();
    });
    expect(getRecordingDay).toHaveBeenCalledTimes(1);
    const day = { cameraId: 'camera', date: '2026-11-18', segments: [] } as unknown as RecordingDay;
    await act(async () => {
      finish(day);
      await refresh;
    });
    expect(await refresh).toBe(true);
    expect(host.textContent).toBe('false|2026-11-18');
    vi.mocked(getRecordingDay).mockRejectedValueOnce(new Error('Offline'));
    let success = true;
    await act(async () => {
      success = await current!.retry();
    });
    expect(success).toBe(false);
    expect(host.textContent).toBe('false|2026-11-18');
    expect(current!.errors.camera).toBe('Offline');
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
