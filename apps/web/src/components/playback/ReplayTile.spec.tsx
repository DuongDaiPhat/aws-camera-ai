// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { it, expect, vi } from 'vitest';
import type { PlaybackCamera, RecordingDay } from '@/types';
import { ReplayTile } from './ReplayTile';
vi.mock('./PlaybackPlayer', () => ({
  PlaybackPlayer: (props: {
    segment: { id: string } | null;
    autoPlay: boolean;
    onEnded: () => void;
  }) => (
    <button data-playing={props.autoPlay} onClick={props.onEnded}>
      {props.segment?.id}
    </button>
  ),
}));
it('keeps recording and resumes at the live edge when the next saved chunk appears', async () => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    value: true,
    configurable: true,
  });
  const camera = { id: 'cam', timeZone: 'UTC' } as PlaybackCamera,
    onActive = vi.fn();
  const segment = (id: string, start: number, end: number) => ({
    id,
    startAt: new Date(start * 1000).toISOString(),
    endAt: new Date(end * 1000).toISOString(),
    durationSeconds: end - start,
    hasMotion: false,
  });
  const first = segment('a', 0, 10),
    next = segment('b', 10.078, 20);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const show = (segments: (typeof first)[]) =>
    act(async () =>
      root.render(
        <ReplayTile
          camera={camera}
          primary
          command={null}
          onActive={onActive}
          day={{ segments, sourceStatus: 'receiving' } as RecordingDay}
        />,
      ),
    );
  try {
    await show([first]);
    await act(async () => host.querySelector<HTMLButtonElement>('button')!.click());
    expect(host.textContent).toContain('Danh sách sẽ tiếp tục');
    await show([first, next]);
    expect(host.querySelector('button')?.textContent).toBe('b');
    expect(host.querySelector('button')?.dataset.playing).toBe('true');
    expect(onActive).toHaveBeenLastCalledWith('cam', next.startAt);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
