// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { VideoSourceUploader } from '../VideoSourceUploader';
import { deleteCameraVideo, uploadCameraVideo } from '@/lib/cameras-client';
vi.mock('@/lib/cameras-client', () => ({ deleteCameraVideo: vi.fn(), uploadCameraVideo: vi.fn() }));
let host: HTMLDivElement, root: Root, video: HTMLVideoElement | undefined;
beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    value: true,
    configurable: true,
  });
  host = document.createElement('div');
  root = createRoot(host);
  vi.resetAllMocks();
  Object.defineProperty(URL, 'createObjectURL', {
    value: vi.fn(() => 'blob:video'),
    configurable: true,
  });
  Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
  const create = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag, options) => {
    const element = create(tag, options);
    if (tag === 'video') video = element as HTMLVideoElement;
    return element;
  });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
async function render(initialFileName?: string) {
  await act(async () =>
    root.render(
      <VideoSourceUploader
        cameraId="cam"
        initialFileName={initialFileName}
        isAdmin
        onSourceUpdated={vi.fn()}
      />,
    ),
  );
}
function choose(file?: File) {
  const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
  act(() => {
    Object.defineProperty(input, 'files', { value: file ? [file] : [], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
async function click(text: string) {
  const button = [...host.querySelectorAll('button')].find((b) => b.textContent === text);
  if (!button) throw Error(text);
  await act(async () => button.click());
}
it('reads metadata, reports upload progress and uses the server filename', async () => {
  await render();
  choose();
  expect(uploadCameraVideo).not.toHaveBeenCalled();
  choose(new File(['bad'], 'sample.avi'));
  expect(host.textContent).toContain('Chỉ hỗ trợ');
  choose(new File(['video'], 'sample.mp4', { type: 'video/mp4' }));
  Object.defineProperty(video!, 'duration', { value: 125, configurable: true });
  act(() => video!.dispatchEvent(new Event('loadedmetadata')));
  expect(host.textContent).toContain('02:05');
  await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  let done!: (value: Awaited<ReturnType<typeof uploadCameraVideo>>) => void;
  vi.mocked(uploadCameraVideo).mockImplementation((_id, _file, _loop, progress) => {
    progress?.(45);
    return new Promise((resolve) => {
      done = resolve;
    });
  });
  await click('Lưu và kích hoạt nguồn Video');
  expect(host.textContent).toContain('Đang tải lên 45%');
  expect(uploadCameraVideo).toHaveBeenCalledWith(
    'cam',
    expect.any(File),
    false,
    expect.any(Function),
  );
  await act(async () => done({ videoOriginalName: 'stored.mp4' } as never));
  expect(host.textContent).toContain('stored.mp4');
  expect(host.textContent).toContain('Đã tải video lên');
  expect(host.querySelector('progress')!.value).toBe(100);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:video');
});
it.each([new Error('Denied'), 'bad'])(
  'retains a selected file after upload failure and shows a delete failure',
  async (error) => {
    await render('existing.mp4');
    choose(new File(['video'], 'sample.mkv'));
    Object.defineProperty(video!, 'duration', { value: Infinity, configurable: true });
    act(() => video!.dispatchEvent(new Event('loadedmetadata')));
    expect(host.textContent).not.toContain('Infinity');
    vi.mocked(uploadCameraVideo).mockRejectedValue(error);
    await click('Lưu và kích hoạt nguồn Video');
    expect(host.textContent).toContain(error instanceof Error ? 'Denied' : 'Không thể tải video');
    expect(host.textContent).toContain('sample.mkv');
    vi.mocked(deleteCameraVideo).mockRejectedValue(error);
    await click('Xóa video hiện tại');
    expect(host.textContent).toContain(error instanceof Error ? 'Denied' : 'Không thể xóa video');
  },
);
it('falls back to the local filename and clears state after successful deletion', async () => {
  await render();
  choose(new File(['video'], 'sample.mp4'));
  act(() => video!.dispatchEvent(new Event('error')));
  vi.mocked(uploadCameraVideo).mockResolvedValue({ videoOriginalName: null } as never);
  await click('Lưu và kích hoạt nguồn Video');
  expect(host.textContent).toContain('sample.mp4');
  let done!: () => void;
  vi.mocked(deleteCameraVideo).mockReturnValue(
    new Promise((resolve) => {
      done = () => resolve(undefined as never);
    }),
  );
  await click('Xóa video hiện tại');
  expect(host.textContent).toContain('Đang xóa...');
  await act(async () => done());
  expect(host.textContent).toContain('Đã xóa video nguồn phát');
  expect(host.textContent).not.toContain('sample.mp4');
  expect(host.querySelector('progress')!.value).toBe(0);
});
