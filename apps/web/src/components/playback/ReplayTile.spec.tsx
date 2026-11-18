// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PlaybackCamera, RecordingDay, RecordingSegment } from '@/types';
import { ReplayTile } from './ReplayTile';
vi.mock('./PlaybackPlayer', () => ({
  PlaybackPlayer: (props: {
    segment: RecordingSegment | null;
    seek: { seconds: number; nonce: number };
    playing: boolean;
    onEnded: () => void;
    emptyMessage?: string;
  }) => (
    <button
      data-testid="player"
      data-seek={props.seek.seconds}
      data-nonce={props.seek.nonce}
      data-playing={props.playing}
      onClick={props.onEnded}
    >
      {props.segment?.id ?? props.emptyMessage}
    </button>
  ),
}));
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
const camera: PlaybackCamera = {
  id: 'cam',
  name: 'Bếp',
  timeZone: 'UTC',
  isEnabled: true,
  recordingEnabled: true,
  retentionDays: 30,
};
const clip = (id: string, start: number, end: number): RecordingSegment => ({
  id,
  startAt: new Date(start * 1000).toISOString(),
  endAt: new Date(end * 1000).toISOString(),
  durationSeconds: end - start,
  hasMotion: false,
});
const a = clip('a', 0, 10),
  b = clip('b', 10.078, 20),
  c = clip('c', 30, 40);
const day = (segments: RecordingSegment[]): RecordingDay => ({
  cameraId: 'cam',
  date: '1970-01-01',
  timeZone: 'UTC',
  dayStartAt: new Date(0).toISOString(),
  dayEndAt: new Date(86400000).toISOString(),
  recordingEnabled: true,
  retentionDays: 30,
  isFutureDate: false,
  sourceStatus: 'receiving',
  segments,
});
let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
const blocked = vi.fn(),
  position = vi.fn(),
  focus = vi.fn();
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.clearAllMocks();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
const show = (segments: RecordingSegment[], at = 0, nonce = 1, primary = true, cursor = at) =>
  act(async () =>
    root.render(
      <ReplayTile
        camera={camera}
        day={day(segments)}
        primary={primary}
        command={{ at, nonce }}
        cursor={cursor}
        playing
        rate={1}
        onPosition={position}
        onBlocked={blocked}
        onFocus={focus}
      />,
    ),
  );
function player() {
  return host.querySelector<HTMLButtonElement>('[data-testid="player"]')!;
}
it('seeks an absolute observation time into the correct saved segment', async () => {
  await show([a, b], 15000);
  expect(player().textContent).toBe('b');
  expect(Number(player().dataset.seek)).toBeCloseTo(4.922);
});
it('clears the old frame and stops the primary when a real gap is selected', async () => {
  await show([a, c]);
  await show([a, c], 25000, 2);
  expect(player().textContent).toContain('Không có bản ghi');
  expect(blocked).toHaveBeenCalledWith(expect.stringContaining('Không có bản ghi'));
});
it('resumes continuous footage when a new saved chunk arrives without a new seek', async () => {
  await show([a]);
  await act(async () => player().click());
  expect(host.textContent).toContain('Đang chờ camera lưu thêm');
  await show([a, b]);
  expect(player().textContent).toBe('b');
  expect(player().dataset.playing).toBe('true');
  expect(blocked).not.toHaveBeenCalled();
});
it('does not jump across a real outage at the end of a segment', async () => {
  await show([a, c]);
  await act(async () => player().click());
  expect(player().textContent).toBe('a');
  expect(blocked).toHaveBeenCalledWith(expect.stringContaining('Mất dữ liệu'));
});
it('does not reset the seek position when a refresh appends later coverage', async () => {
  await show([a], 5000);
  const nonce = player().dataset.nonce;
  await show([a, c], 5000);
  expect(player().dataset.nonce).toBe(nonce);
  expect(player().dataset.seek).toBe('5');
});
it('secondary channels clear missing footage and resume at the shared observation time', async () => {
  await show([a, c], 0, 1, false, 5000);
  expect(player().textContent).toBe('a');
  await show([a, c], 0, 1, false, 25000);
  expect(player().textContent).toContain('Không có bản ghi');
  await show([a, c], 0, 1, false, 35000);
  expect(player().textContent).toBe('c');
  expect(player().dataset.seek).toBe('5');
  expect(blocked).not.toHaveBeenCalled();
});
