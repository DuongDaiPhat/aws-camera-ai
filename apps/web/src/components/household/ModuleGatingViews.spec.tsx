// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentUser, Zone } from '@/types';
import { KnownFacesView } from '@/components/known-faces/KnownFacesView';
import { ZonesView } from '@/components/zones/ZonesView';
import { WellnessView } from '@/components/wellness/WellnessView';

const mocks = vi.hoisted(() => ({
  getHouseholdAiModules: vi.fn(),
  listKnownFaces: vi.fn(),
  getHousehold: vi.fn(),
  listWellnessSchedules: vi.fn(),
  listWellnessChecks: vi.fn(),
  fetchCameras: vi.fn(),
  zones: [] as Zone[],
}));

vi.mock('@/lib/household-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/household-client')>();
  return {
    ...actual,
    getHouseholdAiModules: mocks.getHouseholdAiModules,
    getHousehold: mocks.getHousehold,
  };
});
vi.mock('@/lib/known-faces-client', () => ({
  listKnownFaces: mocks.listKnownFaces,
  deleteKnownFace: vi.fn(),
}));
vi.mock('@/lib/wellness-client', () => ({
  listWellnessSchedules: mocks.listWellnessSchedules,
  listWellnessChecks: mocks.listWellnessChecks,
  createWellnessSchedule: vi.fn(),
  updateWellnessSchedule: vi.fn(),
  deleteWellnessSchedule: vi.fn(),
  confirmWellnessCheck: vi.fn(),
}));
vi.mock('@/lib/cameras-client', () => ({
  fetchCameras: mocks.fetchCameras,
  retryFrigateSync: vi.fn(),
}));
vi.mock('@/lib/events-client', () => ({
  subscribeEventsStream: vi.fn(() => () => {}),
}));
vi.mock('@/hooks', () => ({
  useCameras: () => ({
    cameras: [
      {
        id: 'cam-1',
        name: 'Cửa chính',
        runtimeStatus: 'ONLINE',
        frigateSync: { status: 'SYNCED' },
      },
    ],
    selectedCamera: {
      id: 'cam-1',
      name: 'Cửa chính',
      runtimeStatus: 'ONLINE',
      frigateSync: { status: 'SYNCED' },
    },
    isLoading: false,
    error: null,
    selectCamera: vi.fn(),
    loadCameras: vi.fn(),
  }),
  useZones: () => ({
    zones: mocks.zones,
    isLoading: false,
    error: null,
    reload: vi.fn(),
    add: vi.fn(),
    save: vi.fn(),
    remove: vi.fn(),
  }),
  useCameraSnapshot: () => ({
    preview: { url: 'blob:preview', width: 640, height: 480 },
    isLoading: false,
    error: null,
    reload: vi.fn(),
  }),
}));

describe('Module disabled UI gating (M1, M2a, M4, M5)', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
      value: true,
      configurable: true,
    });
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    if (typeof HTMLDialogElement !== 'undefined') {
      HTMLDialogElement.prototype.showModal ??= function showModal() {
        this.open = true;
      };
      HTMLDialogElement.prototype.close ??= function close() {
        this.open = false;
      };
    }
    vi.clearAllMocks();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    mocks.zones = [
      {
        id: 'zone-1',
        cameraId: 'cam-1',
        name: 'Khu bếp',
        slug: 'khu_bep',
        zoneType: 'RESTRICTED',
        polygon: [
          [0.1, 0.1],
          [0.4, 0.1],
          [0.4, 0.4],
        ],
        minDwellSeconds: 2,
        activeFrom: null,
        activeTo: null,
        isEnabled: true,
      },
    ];
    mocks.getHousehold.mockResolvedValue({ members: [] });
    mocks.listKnownFaces.mockResolvedValue({
      data: [
        {
          id: 'face-1',
          personName: 'Bà Ngoại',
          relationship: 'Bà',
          linkedUserId: null,
          provider: 'LOCAL',
          modelVersion: 'v1',
          sourceImageCount: 1,
          isActive: true,
          createdAt: '2026-11-25T10:00:00.000Z',
          recognitionStatus: 'READY',
        },
      ],
    });
    mocks.listWellnessSchedules.mockResolvedValue({
      data: [
        {
          id: 'sched-1',
          residentUserId: 'res-1',
          ownerUserId: 'cg-1',
          name: 'Buổi sáng',
          checkAt: '09:00',
          daysOfWeek: [1, 2, 3],
          lookbackHours: 6,
          graceSeconds: 300,
          cameraIds: [],
          timezone: 'Asia/Ho_Chi_Minh',
          isEnabled: true,
          configurationStatus: 'READY',
        },
      ],
    });
    mocks.listWellnessChecks.mockResolvedValue({ data: [], total: 0 });
    mocks.fetchCameras.mockResolvedValue([]);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('locks KnownFacesView add/edit/delete when M1 is disabled and unlocks when M1 is re-enabled', async () => {
    mocks.getHouseholdAiModules.mockResolvedValueOnce({
      m1Face: false,
      m2aFall: true,
      m3Fire: true,
      m4Zone: true,
      m5Wellness: true,
      availability: { m1Face: true, m2aFall: true, m3Fire: true, m4Zone: true, m5Wellness: true },
      updatedAt: null,
    });
    const openSettings = vi.fn();

    await act(async () =>
      root.render(<KnownFacesView isAdmin canConfigureAi onOpenSettings={openSettings} />),
    );

    expect(host.querySelector('[role="alert"]')?.textContent).toContain('M1');
    const addButton = [...host.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Thêm mới'),
    )!;
    expect(addButton.disabled).toBe(true);
    expect(host.querySelector('button[aria-label^="Sửa"]')).toBeNull();
    expect(host.querySelector('button[aria-label^="Xóa"]')).toBeNull();

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('camerai:ai-modules-updated', {
          detail: {
            m1Face: true,
            m2aFall: true,
            m3Fire: true,
            m4Zone: true,
            m5Wellness: true,
          },
        }),
      );
    });

    expect(addButton.disabled).toBe(false);
    expect(host.querySelector('button[aria-label^="Sửa"]')).not.toBeNull();
  });

  it('disables RESTRICTED and REST_AREA zone types in ZonesView when M4 and M2a are disabled', async () => {
    mocks.getHouseholdAiModules.mockResolvedValueOnce({
      m1Face: true,
      m2aFall: false,
      m3Fire: true,
      m4Zone: false,
      m5Wellness: true,
      availability: { m1Face: true, m2aFall: true, m3Fire: true, m4Zone: true, m5Wellness: true },
      updatedAt: null,
    });

    await act(async () =>
      root.render(
        <ZonesView
          user={{ id: 'cg-1', role: 'CAREGIVER', fullName: 'Caregiver' } as CurrentUser}
        />,
      ),
    );

    expect(host.querySelector('[role="alert"]')?.textContent).toContain('M4');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('M2a');
    const addButton = [...host.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Thêm vùng'),
    )!;
    await act(async () => addButton.click());

    const select = host.querySelector('select')!;
    expect(select.value).toBe('NORMAL');
    expect(select.querySelector<HTMLOptionElement>('option[value="RESTRICTED"]')?.disabled).toBe(
      true,
    );
    expect(select.querySelector<HTMLOptionElement>('option[value="REST_AREA"]')?.disabled).toBe(
      true,
    );
  });

  it('locks WellnessView schedule form and controls when M5 is disabled', async () => {
    mocks.getHouseholdAiModules.mockResolvedValueOnce({
      m1Face: true,
      m2aFall: true,
      m3Fire: true,
      m4Zone: true,
      m5Wellness: false,
      availability: { m1Face: true, m2aFall: true, m3Fire: true, m4Zone: true, m5Wellness: true },
      updatedAt: null,
    });

    await act(async () =>
      root.render(
        <WellnessView
          user={{ id: 'cg-1', role: 'CAREGIVER', fullName: 'Caregiver' } as CurrentUser}
        />,
      ),
    );

    expect(host.querySelector('[role="alert"]')?.textContent).toContain('M5');
    expect(host.querySelector<HTMLFieldSetElement>('fieldset')?.disabled).toBe(true);
    const saveButton = [...host.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Lưu lịch'),
    )!;
    const editButton = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Sửa')!;
    const toggleButton = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Tắt')!;
    expect(saveButton.disabled).toBe(true);
    expect(editButton.disabled).toBe(true);
    expect(toggleButton.disabled).toBe(true);
  });
});
