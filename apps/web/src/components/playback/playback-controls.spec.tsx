// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PlaybackFilters } from './PlaybackFilters';
import { PlaybackPlayerTools } from './PlaybackPlayerTools';
import { RecordingList } from './RecordingList';
vi.mock('@/components/ui/SelectMenu', () => ({
  SelectMenu: ({
    label,
    value,
    options,
    disabled,
    onChange,
  }: {
    label: string;
    value: string;
    options: { value: string; label: string }[];
    disabled: boolean;
    onChange: (value: string) => void;
  }) => (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    value: true,
    configurable: true,
  });
  host = document.createElement('div');
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});
function render(element: React.ReactElement) {
  act(() => root.render(element));
}
function click(label: string) {
  const node = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  act(() => node.click());
}
it('selects camera and layout and accepts only integral custom tile counts from 1 to 64', () => {
  const camera = vi.fn(),
    layout = vi.fn(),
    custom = vi.fn();
  const props = {
    cameras: [
      { id: 'cam', name: 'Living' },
      { id: 'other', name: 'Door' },
    ],
    cameraId: 'cam',
    onCamera: camera,
    layout: 'custom',
    custom: 3,
    onLayout: layout,
    onCustom: custom,
  };
  render(
    <PlaybackFilters {...(props as unknown as React.ComponentProps<typeof PlaybackFilters>)} />,
  );
  const selects = host.querySelectorAll('select');
  act(() => {
    selects[0].value = 'other';
    selects[0].dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(camera).toHaveBeenCalledWith('other');
  act(() => {
    selects[1].value = '4';
    selects[1].dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(layout).toHaveBeenCalledWith('4');
  const input = host.querySelector('input')!;
  for (const value of ['0', '-1', '65', '2.5', '64']) {
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  expect(custom).toHaveBeenCalledTimes(1);
  expect(custom).toHaveBeenCalledWith(64);
  render(
    <PlaybackFilters
      {...(props as unknown as React.ComponentProps<typeof PlaybackFilters>)}
      cameras={[]}
      layout="1"
    />,
  );
  expect(host.querySelector('select')!.disabled).toBe(true);
  expect(host.querySelector('input')).toBeNull();
});
it('navigates adjacent clips and requests speed/fullscreen changes', () => {
  const previous = vi.fn(),
    next = vi.fn(),
    speed = vi.fn(),
    fullscreen = vi.fn();
  const props = {
    speed: '1',
    onSpeed: speed,
    onFullscreen: fullscreen,
    hasPrevious: true,
    hasNext: true,
    onPrevious: previous,
    onNext: next,
  };
  render(<PlaybackPlayerTools {...props} />);
  click('Đoạn trước');
  click('Đoạn tiếp theo');
  click('Phóng to bản ghi');
  expect(previous).toHaveBeenCalledOnce();
  expect(next).toHaveBeenCalledOnce();
  expect(fullscreen).toHaveBeenCalledOnce();
  const select = host.querySelector('select')!;
  act(() => {
    select.value = '2';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(speed).toHaveBeenCalledWith('2');
  render(<PlaybackPlayerTools {...props} hasPrevious={false} hasNext={false} />);
  expect(host.querySelector<HTMLButtonElement>('[aria-label="Đoạn trước"]')!.disabled).toBe(true);
  expect(host.querySelector<HTMLButtonElement>('[aria-label="Đoạn tiếp theo"]')!.disabled).toBe(
    true,
  );
});
it('distinguishes loading, future, today-no-frames and expired recording archives', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T05:00:00Z'));
  const props = { cameraName: '', loading: true, onChoose: vi.fn(), onRetry: vi.fn() };
  render(<RecordingList {...props} />);
  expect(host.textContent).toContain('Đang tải bản ghi');
  expect(host.textContent).toContain('Chọn camera');
  click('Làm mới bản ghi');
  expect(props.onRetry).toHaveBeenCalledOnce();
  const day = {
    cameraId: 'cam',
    date: '2026-01-01',
    timeZone: 'Asia/Ho_Chi_Minh',
    segments: [],
    sourceStatus: 'no_frames',
    isFutureDate: false,
  };
  render(<RecordingList {...props} loading={false} day={day as never} />);
  expect(host.textContent).toContain('Nguồn camera chưa gửi hình');
  render(
    <RecordingList
      {...props}
      loading={false}
      day={{ ...day, sourceStatus: 'receiving' } as never}
    />,
  );
  expect(host.textContent).toContain('Bản ghi mới sẽ tự xuất hiện');
  render(
    <RecordingList
      {...props}
      loading={false}
      day={{ ...day, date: '2026-01-02', isFutureDate: true } as never}
    />,
  );
  expect(host.textContent).toContain('Ngày này chưa diễn ra');
  expect(host.textContent).toContain('Chọn một ngày trong quá khứ');
  render(
    <RecordingList
      {...props}
      loading={false}
      day={{ ...day, date: '2025-01-01' } as never}
      error="Offline"
    />,
  );
  expect(host.textContent).toContain('Không có video còn được lưu');
  expect(host.textContent).toContain('Offline Dữ liệu đã tải vẫn được giữ lại');
});
it('paginates recording sessions, follows selected timestamps and chooses a session', () => {
  const segments = Array.from({ length: 35 }, (_, i) => ({
    id: String(i),
    startAt: new Date(Date.UTC(2026, 0, 1, i % 24, Math.floor(i / 24) * 30)).toISOString(),
    endAt: new Date(Date.UTC(2026, 0, 1, i % 24, Math.floor(i / 24) * 30 + 1)).toISOString(),
  })).sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
  const choose = vi.fn();
  const props = {
    cameraName: 'Living',
    loading: false,
    onChoose: choose,
    onRetry: vi.fn(),
    day: {
      cameraId: 'cam',
      date: '2026-01-01',
      timeZone: 'UTC',
      segments,
      sourceStatus: 'receiving',
    } as never,
  };
  render(<RecordingList {...props} />);
  expect(host.textContent).toContain('Đã lưu đến');
  expect(host.querySelectorAll('[aria-pressed]')).toHaveLength(30);
  click('Bản ghi sau');
  expect(host.querySelectorAll('[aria-pressed]')).toHaveLength(5);
  expect(host.querySelector<HTMLButtonElement>('[aria-label="Bản ghi sau"]')!.disabled).toBe(true);
  click('Bản ghi trước');
  expect(host.querySelectorAll('[aria-pressed]')).toHaveLength(30);
  render(<RecordingList {...props} selectedAt={segments[33].startAt} />);
  expect(host.querySelectorAll('[aria-pressed]')).toHaveLength(5);
  const selected = host.querySelector<HTMLButtonElement>('[aria-pressed="true"]')!;
  expect(selected).not.toBeNull();
  act(() => selected.click());
  expect(choose).toHaveBeenCalledWith(segments[33].startAt);
});
