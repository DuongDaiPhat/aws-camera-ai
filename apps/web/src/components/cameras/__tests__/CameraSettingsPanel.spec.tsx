// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Camera } from '@/types';
import { updateCamera } from '@/lib/cameras-client';
import { CameraSettingsPanel } from '../CameraSettingsPanel';

vi.mock('@/lib/cameras-client', () => ({ updateCamera: vi.fn(), retryFrigateSync: vi.fn() }));

const camera = {
  id: 'camera-1',
  name: 'Phòng khách',
  isEnabled: true,
  detectionEnabled: true,
  runtimeStatus: 'ONLINE',
  configVersion: 2,
  syncStatus: 'SYNCED',
  frigateSync: { status: 'SYNCED', configVersion: 2, appliedVersion: 2 },
  frigateSettings: {
    detectWidth: 1280,
    detectHeight: 720,
    detectFps: 5,
    minInitializedFrames: 5,
    maxDisappearedFrames: 25,
    personMinScore: 0.5,
    personThreshold: 0.7,
    personMinArea: 1500,
    snapshotsEnabled: true,
    snapshotBoundingBox: true,
    recordingEnabled: true,
    detectionRetentionDays: 7,
  },
} as Camera;

describe('CameraSettingsPanel', () => {
  it('hien thi ba nhom cau hinh, gioi han va nut mac dinh cho ADMIN', () => {
    const html = renderToStaticMarkup(
      <CameraSettingsPanel camera={camera} isAdmin={true} onSynced={vi.fn()} />,
    );

    expect(html).toContain('Cơ bản');
    expect(html).toContain('Phát hiện person');
    expect(html).toContain('Snapshot');
    expect(html).toContain('Khôi phục mặc định');
    expect(html).toContain('Lưu và đồng bộ Frigate');
    expect(html).toContain('min="1"');
    expect(html).toContain('max="30"');
  });

  it('chi cho role khac xem va khong hien nut luu', () => {
    const html = renderToStaticMarkup(
      <CameraSettingsPanel camera={camera} isAdmin={false} onSynced={vi.fn()} />,
    );

    expect(html).toContain('disabled=""');
    expect(html).not.toContain('Lưu và đồng bộ Frigate');
    expect(html).not.toContain('Khôi phục mặc định');
  });
});

describe('CameraSettingsPanel editing and persistence', () => {
  let container: HTMLDivElement;
  let root: Root;
  const onSynced = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(current = camera) {
    act(() => root.render(<CameraSettingsPanel camera={current} isAdmin onSynced={onSynced} />));
  }

  function input(label: string) {
    return Array.from(container.querySelectorAll('label'))
      .find((element) => element.textContent?.startsWith(label))!
      .querySelector('input')!;
  }

  function change(label: string, value: string) {
    const field = input(label);
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value);
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(field.value).toBe(value);
  }

  async function save() {
    await act(async () => {
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent === 'Lưu và đồng bộ Frigate')!
        .click();
    });
  }

  function updatedCamera(score = 0.4): Camera {
    return {
      ...camera,
      frigateSettings: { ...camera.frigateSettings, personMinScore: score },
      frigateSync: { ...camera.frigateSync, configVersion: 3, appliedVersion: 3 },
    };
  }

  it('keeps numeric edits and toggles across background camera refreshes', () => {
    render();
    change('Minimum score', '0.4');
    change('Threshold', '0.6');
    change('Minimum initialized frames', '2');
    act(() => input('Recording').click());
    render({
      ...camera,
      runtimeStatus: 'STARTING',
      frigateSettings: { ...camera.frigateSettings },
    });
    expect(input('Minimum score').value).toBe('0.4');
    expect(input('Threshold').value).toBe('0.6');
    expect(input('Minimum initialized frames').value).toBe('2');
    expect(input('Recording').checked).toBe(false);
  });

  it('keeps dirty edits when the server configuration changes', () => {
    render();
    change('Minimum score', '0.4');
    render(updatedCamera(0.55));
    expect(input('Minimum score').value).toBe('0.4');
  });

  it('keeps edits through polls while the save request is pending', async () => {
    let resolveSave!: (value: Camera) => void;
    vi.mocked(updateCamera).mockReturnValue(
      new Promise((resolve) => {
        resolveSave = resolve;
      }),
    );
    render();
    change('Minimum score', '0.4');
    await save();
    render(updatedCamera());
    expect(input('Minimum score').value).toBe('0.4');
    expect(input('Minimum score').disabled).toBe(true);
    await act(async () => resolveSave(updatedCamera()));
    expect(input('Minimum score').disabled).toBe(false);
    expect(container.textContent).toContain('Đã lưu và đồng bộ cấu hình Frigate.');
  });

  it('keeps restored defaults as an unsaved draft across polls', () => {
    const current = updatedCamera(0.55);
    render(current);
    act(() =>
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent === 'Khôi phục mặc định')!
        .click(),
    );
    render({ ...current });
    expect(input('Minimum score').value).toBe('0.5');
    expect(updateCamera).not.toHaveBeenCalled();
  });

  it('loads server configuration when clean and resets the draft when changing cameras', () => {
    render();
    render(updatedCamera(0.55));
    expect(input('Minimum score').value).toBe('0.55');
    change('Minimum score', '0.4');
    render({ ...camera, id: 'camera-2' });
    expect(input('Minimum score').value).toBe('0.5');
  });

  it('uses the saved response and ignores a late poll with the old version', async () => {
    vi.mocked(updateCamera).mockResolvedValue(updatedCamera());
    render();
    change('Minimum score', '0.4');
    await save();
    expect(updateCamera).toHaveBeenCalledWith(
      camera.id,
      expect.objectContaining({ personMinScore: 0.4 }),
    );
    expect(onSynced).toHaveBeenCalledOnce();
    render({ ...camera });
    expect(input('Minimum score').value).toBe('0.4');
    expect(container.textContent).toContain('Đã lưu và đồng bộ cấu hình Frigate.');
  });

  it('keeps the draft after a failed save and a subsequent poll', async () => {
    vi.mocked(updateCamera).mockRejectedValue(new Error('Không thể lưu'));
    render();
    change('Minimum score', '0.4');
    await save();
    render({ ...camera });
    expect(input('Minimum score').value).toBe('0.4');
    expect(container.textContent).toContain('Không thể lưu');
    expect(onSynced).not.toHaveBeenCalled();
  });

  it('does not report successful Frigate sync when only persistence succeeded', async () => {
    const updated = updatedCamera();
    vi.mocked(updateCamera).mockResolvedValue({
      ...updated,
      frigateSync: { ...updated.frigateSync, status: 'FAILED' },
    });
    render();
    await save();
    expect(container.textContent).toContain('Đã lưu cấu hình');
    expect(container.textContent).not.toContain('Đã lưu và đồng bộ cấu hình Frigate.');
  });
});
