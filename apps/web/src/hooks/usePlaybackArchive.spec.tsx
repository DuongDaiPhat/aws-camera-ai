// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import type { RecordingSegment } from '@/types';
import { usePlaybackClip } from './usePlaybackArchive';
import { getRecordingClip } from '@/lib/playback-client';
vi.mock('@/lib/playback-client', () => ({
  getRecordingClip: vi.fn(),
  listPlaybackCameras: vi.fn(),
  getRecordingDay: vi.fn(),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const segment = (id: string): RecordingSegment => ({
  id,
  startAt: '2026-11-16T15:00:00Z',
  endAt: '2026-11-16T15:00:10Z',
  durationSeconds: 10,
  hasMotion: false,
});
describe('Playback clip switching', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:current'), revokeObjectURL: vi.fn() });
  });
  it('ignores a late clip response after the user switches intervals', async () => {
    let resolveFirst: (blob: Blob) => void = () => {};
    let firstSignal: AbortSignal | undefined;
    vi.mocked(getRecordingClip)
      .mockImplementationOnce((_id, _segment, signal) => {
        firstSignal = signal;
        return new Promise((resolve) => {
          resolveFirst = resolve;
        });
      })
      .mockResolvedValueOnce(new Blob(['new'], { type: 'video/mp4' }));
    function Harness({ current }: { current: RecordingSegment }) {
      const clip = usePlaybackClip('camera', current);
      return <output>{clip.url}</output>;
    }
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => root.render(<Harness current={segment('a')} />));
    await act(async () => root.render(<Harness current={segment('b')} />));
    expect(firstSignal?.aborted).toBe(true);
    expect(host.textContent).toBe('blob:current');
    await act(async () => resolveFirst(new Blob(['stale'])));
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:current');
    host.remove();
  });
});
