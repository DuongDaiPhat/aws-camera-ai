// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { KnownFacesView } from './KnownFacesView';
import { AddKnownFaceForm } from './AddKnownFaceForm';
import { KnownFaceEditor } from './KnownFaceEditor';
import { FaceImagePreview } from './FaceImagePicker';
import * as api from '@/lib/known-faces-client';
import { getHousehold } from '@/lib/household-client';
import { apiFetch } from '@/lib/api-client';
vi.mock('@/lib/known-faces-client', () => ({
  listKnownFaces: vi.fn(),
  deleteKnownFace: vi.fn(),
  registerKnownFace: vi.fn(),
  selectionDetails: vi.fn(),
}));
vi.mock('@/lib/household-client', () => ({ getHousehold: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ apiFetch: vi.fn() }));
let host: HTMLDivElement, root: Root;
const face = {
  id: 'face',
  personName: 'Grandma',
  relationship: 'Family',
  provider: 'LOCAL',
  sourceImageCount: 2,
  recognitionStatus: 'READY',
  linkedUserId: 'viewer',
  createdAt: '2026-01-01',
};
const members = [
  { id: 'viewer', fullName: 'Grandma', email: 'grandma@test', role: 'VIEWER' },
  { id: 'owner', fullName: 'Owner', email: 'owner@test', role: 'CAREGIVER' },
];
beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    value: true,
    configurable: true,
  });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.resetAllMocks();
  vi.mocked(api.listKnownFaces).mockResolvedValue({
    data: [
      face,
      {
        ...face,
        id: 'pending',
        personName: 'Other',
        relationship: null,
        recognitionStatus: 'SYNC_PENDING',
      },
    ],
  } as never);
  vi.mocked(getHousehold).mockResolvedValue({ members } as never);
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    },
  });
  Object.defineProperty(URL, 'createObjectURL', {
    value: vi.fn(() => 'blob:image'),
    configurable: true,
  });
  Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
async function render(element: React.ReactElement) {
  await act(async () => root.render(element));
}
function button(text: string) {
  const b = [...host.querySelectorAll('button')].find((n) => n.textContent?.trim() === text);
  if (!b) throw Error(`Missing ${text}: ${host.textContent}`);
  return b;
}
async function click(text: string) {
  await act(async () => button(text).click());
}
function input(node: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function submit() {
  await act(async () =>
    host
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
}
function files(next: File[]) {
  const node = host.querySelector<HTMLInputElement>('input[type=file]')!;
  act(() => {
    Object.defineProperty(node, 'files', { value: next, configurable: true });
    node.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

it('shows read-only faces and refreshes without mutation controls', async () => {
  await render(<KnownFacesView isAdmin={false} />);
  expect(host.textContent).toContain('Grandma');
  expect(host.textContent).toContain('Chưa ghi quan hệ');
  expect(host.textContent).toContain('Đang chờ đồng bộ');
  expect(host.textContent).not.toContain('Sửa / Liên kết');
  expect(getHousehold).not.toHaveBeenCalled();
  await click('Tải lại');
  expect(api.listKnownFaces).toHaveBeenCalledTimes(2);
});
it.each(['READY', 'SYNC_PENDING'])(
  'deletes a known face and explains sync status %s',
  async (status) => {
    vi.mocked(api.deleteKnownFace).mockResolvedValue({ recognitionStatus: status } as never);
    await render(<KnownFacesView isAdmin />);
    await click('Xóa');
    expect(host.querySelector('dialog')!.open).toBe(true);
    await click('Hủy');
    expect(host.querySelector('dialog')!.open).toBe(false);
    await click('Xóa');
    await click('Xóa vĩnh viễn');
    expect(api.deleteKnownFace).toHaveBeenCalledWith('face');
    expect(host.textContent).toContain(
      status === 'READY' ? 'Đã xóa vĩnh viễn dữ liệu' : 'Collection nhận diện đang chờ',
    );
  },
);
it.each([new Error('Denied'), 'bad'])(
  'keeps failed deletion open and permits cancel',
  async (error) => {
    vi.mocked(api.deleteKnownFace).mockRejectedValue(error);
    await render(<KnownFacesView isAdmin />);
    await click('Xóa');
    await click('Xóa vĩnh viễn');
    expect(host.textContent).toContain(error instanceof Error ? 'Denied' : 'Không xóa được');
    expect(host.querySelector('dialog')!.open).toBe(true);
    act(() =>
      host.querySelector('dialog')!.dispatchEvent(new Event('cancel', { cancelable: true })),
    );
    expect(host.querySelector('dialog')!.open).toBe(false);
  },
);
it('opens registration and editing forms and saves a linked viewer', async () => {
  await render(<KnownFacesView isAdmin />);
  await click('Thêm người quen');
  expect(host.querySelector('form')!.getAttribute('aria-label')).toBe('Đăng ký người quen');
  await click('Hủy');
  await click('Sửa / Liên kết Viewer');
  expect(host.querySelector('select')!.value).toBe('viewer');
  input(host.querySelector('input')!, 'New name');
  await submit();
  expect(apiFetch).toHaveBeenCalledWith('/known-faces/face', {
    method: 'PATCH',
    body: JSON.stringify({
      personName: 'New name',
      relationship: 'Family',
      linkedUserId: 'viewer',
    }),
  });
  expect(host.textContent).toContain('Đã cập nhật và gửi đồng bộ');
});
it.each([new Error('offline'), 'bad'])('reports list load errors', async (error) => {
  vi.mocked(api.listKnownFaces).mockRejectedValue(error);
  await render(<KnownFacesView isAdmin={false} />);
  expect(host.textContent).toContain(
    error instanceof Error ? 'offline' : 'Không tải được danh sách',
  );
});
it('shows an empty face library', async () => {
  vi.mocked(api.listKnownFaces).mockResolvedValue({ data: [] });
  await render(<KnownFacesView isAdmin={false} />);
  expect(host.textContent).toContain('Chưa có người quen nào');
});
it('validates image counts, appends and removes images and registers a person', async () => {
  const created = vi.fn(),
    cancel = vi.fn();
  await render(
    <AddKnownFaceForm onCreated={created} onCancel={cancel} members={members as never} />,
  );
  expect(button('Đăng ký').disabled).toBe(true);
  await submit();
  expect(host.textContent).toContain('Hãy chọn từ 1 đến 5 ảnh');
  input(host.querySelectorAll('input')[0], 'Grandma');
  input(host.querySelectorAll('input')[1], 'Family');
  const select = host.querySelector('select')!;
  act(() => {
    select.value = 'viewer';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  files([new File(['image'], 'photo.jpg')]);
  files([new File(['second'], 'second.png')]);
  expect(host.querySelectorAll('article')).toHaveLength(2);
  await click('Bỏ ảnh');
  expect(host.querySelectorAll('article')).toHaveLength(1);
  vi.mocked(api.registerKnownFace).mockResolvedValue(face as never);
  await submit();
  expect(api.registerKnownFace).toHaveBeenCalledWith(
    'Grandma',
    'Family',
    [expect.objectContaining({ name: 'second.png' })],
    [null],
    expect.any(AbortSignal),
    'viewer',
  );
  expect(created).toHaveBeenCalledWith(face);
  expect(host.querySelectorAll('article')).toHaveLength(0);
  files(Array.from({ length: 7 }, (_, i) => new File(['x'], `${i}.jpg`)));
  expect(host.querySelectorAll('article')).toHaveLength(5);
  await click('Hủy');
  expect(cancel).toHaveBeenCalledOnce();
  expect(URL.revokeObjectURL).toHaveBeenCalled();
});
it('selects the intended face after a multiple-face rejection before retrying', async () => {
  await render(<AddKnownFaceForm onCreated={vi.fn()} onCancel={vi.fn()} />);
  input(host.querySelector('input')!, 'Name');
  files([new File(['x'], 'photo.jpg')]);
  vi.mocked(api.registerKnownFace).mockRejectedValueOnce(new Error('Select a face'));
  vi.mocked(api.selectionDetails).mockReturnValue({
    images: [
      {
        imageIndex: 0,
        code: 'MULTIPLE_FACES',
        faces: [
          { faceIndex: 0, boundingBox: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 } },
          { faceIndex: 1, boundingBox: { x: 0.5, y: 0.2, width: 0.3, height: 0.4 } },
        ],
      },
    ],
  } as never);
  await submit();
  expect(host.textContent).toContain('Hãy chọn đúng khuôn mặt');
  const choices = host.querySelectorAll<HTMLButtonElement>('[aria-pressed]');
  await act(async () => choices[1].click());
  expect(choices[1].getAttribute('aria-pressed')).toBe('true');
  vi.mocked(api.registerKnownFace).mockResolvedValue(face as never);
  await submit();
  expect(api.registerKnownFace).toHaveBeenLastCalledWith(
    'Name',
    '',
    [expect.any(File)],
    [1],
    expect.any(AbortSignal),
    undefined,
  );
});
it.each([new Error('Denied'), 'bad'])(
  'reports editor save failure and permits cancel',
  async (error) => {
    const cancel = vi.fn();
    vi.mocked(apiFetch).mockRejectedValue(error);
    await render(
      <KnownFaceEditor
        face={{ ...face, relationship: null, linkedUserId: null } as never}
        members={members as never}
        onSaved={vi.fn()}
        onCancel={cancel}
      />,
    );
    expect(host.querySelector('select')!.options).toHaveLength(2);
    await submit();
    expect(host.textContent).toContain(
      error instanceof Error ? 'Denied' : 'Không lưu được người quen',
    );
    await click('Hủy');
    expect(cancel).toHaveBeenCalledOnce();
  },
);
it('shows a no-face error and disposes the local image URL', async () => {
  const remove = vi.fn();
  await render(
    <FaceImagePreview
      file={new File(['x'], 'empty.jpg')}
      selected={null}
      details={{ code: 'NO_FACE_DETECTED', faces: [] } as never}
      onSelect={vi.fn()}
      onRemove={remove}
      disabled={false}
    />,
  );
  expect(host.querySelector('img')!.src).toBe('blob:image');
  expect(host.textContent).toContain('Không tìm thấy khuôn mặt');
  await click('Bỏ ảnh');
  expect(remove).toHaveBeenCalledOnce();
  await render(<div />);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:image');
});
