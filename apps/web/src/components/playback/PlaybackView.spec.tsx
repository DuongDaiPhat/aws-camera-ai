// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import type { RecordingDay, PlaybackCamera } from '@/types';
import { PlaybackView } from './PlaybackView';
import type { ReplayCommand } from './ReplayTile';
const fixtures = vi.hoisted(() => ({
  day: '2026-11-18',
  requests: [] as string[],
  retry: vi.fn(async () => true),
}));
const cameras: PlaybackCamera[] = [1, 2, 3, 4].map((n) => ({
  id: `cam${n}`,
  name: `Camera ${n}`,
  timeZone: 'Asia/Ho_Chi_Minh',
  isEnabled: true,
  recordingEnabled: true,
  retentionDays: 30,
}));
function recordingDay(id: string, date: string): RecordingDay {
  return {
    cameraId: id,
    date,
    timeZone: 'Asia/Ho_Chi_Minh',
    dayStartAt: `${date}T00:00:00+07:00`,
    dayEndAt: `${date}T24:00:00+07:00`,
    recordingEnabled: true,
    retentionDays: 30,
    isFutureDate: false,
    sourceStatus: 'receiving',
    segments: [
      {
        id: 'a' + date,
        startAt: `${date}T08:00:00+07:00`,
        endAt: `${date}T12:00:00+07:00`,
        durationSeconds: 14400,
        hasMotion: false,
      },
    ],
  };
}
vi.mock('@/hooks/usePlaybackArchive', () => ({
  usePlaybackCameras: () => ({ cameras, camerasLoading: false, cameraError: '' }),
}));
vi.mock('@/hooks/useRecordingDays', () => ({
  useRecordingDays: (ids: string[], date: string) => {
    fixtures.requests.push(date);
    return {
      days: Object.fromEntries(ids.map((id) => [id, recordingDay(id, date)])),
      errors: {},
      retry: fixtures.retry,
      isRefreshing: false,
    };
  },
}));
vi.mock('@/components/ui/SelectMenu', () => ({
  SelectMenu: (props: {
    label: string;
    value: string;
    options: { value: string; label: string }[];
    onChange: (value: string) => void;
  }) => (
    <select
      aria-label={props.label}
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
    >
      {props.options.map((item) => (
        <option key={item.value} value={item.value}>
          {item.label}
        </option>
      ))}
    </select>
  ),
}));
vi.mock('./ReplayTile', () => ({
  ReplayTile: (props: {
    camera: PlaybackCamera;
    command: ReplayCommand | null;
    primary: boolean;
    playing: boolean;
    onPosition: (id: string, at: number) => void;
  }) => (
    <button
      data-camera={props.camera.id}
      data-at={props.command?.at}
      data-nonce={props.command?.nonce}
      data-primary={props.primary}
      data-playing={props.playing}
      onClick={() => props.onPosition(props.camera.id, (props.command?.at ?? 0) + 5000)}
    >
      {props.camera.name}
    </button>
  ),
}));
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
beforeEach(() => {
  localStorage.clear();
  fixtures.requests.length = 0;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
const show = (date = '2026-11-18') =>
  act(async () =>
    root.render(<PlaybackView selectedDate={new Date(date + 'T12:00:00')} userId="owner" />),
  );
const channels = () => [...host.querySelectorAll<HTMLButtonElement>('[data-camera]')];
async function layout(value: string) {
  const input = host.querySelector<HTMLSelectElement>('[aria-label="Số camera xem lại"]')!;
  await act(async () => {
    input.value = value;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
it('uses one observation time for all selected channels and supports keyboard seeking', async () => {
  await show();
  expect(channels()).toHaveLength(2);
  expect(new Set(channels().map((node) => node.dataset.at)).size).toBe(1);
  const at = Number(channels()[0].dataset.at);
  const row = host.querySelector('[aria-label="Thời điểm Camera 2"]')!;
  await act(async () =>
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })),
  );
  expect(channels().every((node) => Number(node.dataset.at) === at + 10000)).toBe(true);
  expect(channels().find((node) => node.dataset.primary === 'true')?.dataset.camera).toBe('cam2');
});
it('limits layouts to authorized cameras and restores the chosen layout after remounting', async () => {
  await show();
  await layout('4');
  expect(channels()).toHaveLength(4);
  expect(host.textContent).not.toContain('thay vì');
  expect(
    [...host.querySelectorAll('[aria-label="Số camera xem lại"] option')].map(
      (option) => option.textContent,
    ),
  ).toEqual(['1 camera', '2 camera', '4 camera', 'Tùy chỉnh']);
  await act(async () => root.unmount());
  root = createRoot(host);
  await show();
  expect(host.querySelector<HTMLSelectElement>('[aria-label="Số camera xem lại"]')?.value).toBe(
    '4',
  );
  expect(channels()).toHaveLength(4);
});
it('preserves playhead and zoom when metadata refreshes, then resets media when the date changes', async () => {
  await show();
  await act(async () => channels()[0].click());
  const zoom = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (node) => node.textContent === '1 giờ',
  )!;
  await act(async () => zoom.click());
  const nonce = channels()[0].dataset.nonce;
  await show();
  expect(channels()[0].dataset.nonce).toBe(nonce);
  expect(
    [...host.querySelectorAll('button')]
      .find((node) => node.textContent === '1 giờ')
      ?.getAttribute('aria-pressed'),
  ).toBe('true');
  await show('2026-11-19');
  expect(Number(channels()[0].dataset.at)).toBe(Date.parse('2026-11-19T08:00:00+07:00'));
  expect(channels()[0].dataset.playing).toBe('false');
  expect(fixtures.requests.at(-1)).toBe('2026-11-19');
});
it('allows explicit empty channel selection and remembers it after reloading', async () => {
  await show();
  for (const id of ['Camera 1', 'Camera 2']) {
    const checkbox = host.querySelector<HTMLInputElement>(`[aria-label="Hiển thị ${id}"]`)!;
    await act(async () => checkbox.click());
  }
  expect(channels()).toHaveLength(0);
  expect(host.textContent).toContain('Chọn camera để xem lại');
  await act(async () => root.unmount());
  root = createRoot(host);
  await show();
  expect(channels()).toHaveLength(0);
});

it('refreshes recordings with visible feedback while preserving the playhead and zoom', async () => {
  await show();
  await act(async () => channels()[0].click());
  const nonce = channels()[0].dataset.nonce;
  const zoom = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (node) => node.textContent === '1 giờ',
  )!;
  await act(async () => zoom.click());
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[aria-label="Cập nhật dữ liệu bản ghi"]')!.click(),
  );
  expect(fixtures.retry).toHaveBeenCalled();
  expect(host.textContent).toContain('Đã cập nhật bản ghi lúc');
  expect(channels()[0].dataset.nonce).toBe(nonce);
  expect(zoom.getAttribute('aria-pressed')).toBe('true');
  expect(host.textContent).not.toContain('đã ghi');
  expect(host.textContent).not.toContain('Lưu 30 ngày');
});

it('uses one persistent play/pause control without issuing a seek on each toggle', async () => {
  await show();
  const first = channels()[0];
  const nonce = first.dataset.nonce;
  const play = host.querySelector<HTMLButtonElement>('[aria-label="Phát bản ghi"]')!;
  expect(host.querySelector('[aria-label="Dừng phát"]')).toBeNull();
  expect(host.querySelector('[aria-label="Đến thời điểm"]')).toBeNull();
  expect(host.querySelector('[title="Tìm con trỏ trên timeline"]')).toBeNull();
  await act(async () => play.click());
  expect(host.querySelector('[aria-label="Tạm dừng"]')).toBe(play);
  expect(first.dataset.playing).toBe('true');
  expect(first.dataset.nonce).toBe(nonce);
  await act(async () => play.click());
  expect(first.dataset.playing).toBe('false');
  expect(first.dataset.nonce).toBe(nonce);
  expect(channels()[0]).toBe(first);
});

it('applies a time window at its first recorded frame and keeps validation inside the monitor', async () => {
  await show();
  const first = channels()[0];
  async function setTime(label: string, value: string) {
    const input = host.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  const apply = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent === 'Áp dụng',
  )!;
  await setTime('Từ', '07:00:00');
  await setTime('Đến', '09:00:00');
  await act(async () => apply.click());
  expect(channels()[0]).toBe(first);
  expect(Number(first.dataset.at)).toBe(Date.parse('2026-11-18T08:00:00+07:00'));
  await setTime('Đến', '06:00:00');
  await act(async () => apply.click());
  const monitor = host.querySelector('[aria-label="Màn hình xem lại camera"]')!;
  expect(monitor.querySelector('[role="status"]')?.textContent).toContain('Giờ kết thúc phải sau');
  expect(channels()[0]).toBe(first);
});
