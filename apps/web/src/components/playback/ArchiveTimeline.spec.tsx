// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { PlaybackCamera, RecordingDay } from '@/types';
import { ArchiveTimeline } from './ArchiveTimeline';
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
it('previews a dragged time but commits only once on release, with keyboard alternatives', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const camera: PlaybackCamera = {
    id: 'cam',
    name: 'Bếp',
    timeZone: 'UTC',
    isEnabled: true,
    recordingEnabled: true,
    retentionDays: 30,
  };
  const day: RecordingDay = {
    cameraId: 'cam',
    date: '1970-01-01',
    timeZone: 'UTC',
    dayStartAt: new Date(0).toISOString(),
    dayEndAt: new Date(100000).toISOString(),
    recordingEnabled: true,
    retentionDays: 30,
    isFutureDate: false,
    segments: [],
  };
  const seek = vi.fn();
  try {
    await act(async () =>
      root.render(
        <ArchiveTimeline
          cameras={[camera]}
          days={{ cam: day }}
          activeId="cam"
          bounds={{ start: 0, end: 100000 }}
          range={{ start: 0, end: 100000 }}
          cursor={10000}
          timeZone="UTC"
          onRange={vi.fn()}
          onSeek={seek}
        />,
      ),
    );
    const track = host.querySelector<HTMLDivElement>('[role="slider"]')!;
    track.setPointerCapture = vi.fn();
    track.releasePointerCapture = vi.fn();
    vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 200,
      bottom: 40,
      width: 200,
      height: 40,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    const pointer = async (type: string, x: number) =>
      act(async () => {
        const event = new Event(type, { bubbles: true });
        Object.assign(event, { clientX: x, button: 0, pointerId: 1 });
        track.dispatchEvent(event);
      });
    await pointer('pointerdown', 50);
    await pointer('pointermove', 150);
    expect(seek).not.toHaveBeenCalled();
    await pointer('pointerup', 150);
    expect(seek).toHaveBeenCalledTimes(1);
    expect(seek).toHaveBeenLastCalledWith(75000, 'cam');
    await act(async () =>
      track.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })),
    );
    expect(seek).toHaveBeenLastCalledWith(20000, 'cam');
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
