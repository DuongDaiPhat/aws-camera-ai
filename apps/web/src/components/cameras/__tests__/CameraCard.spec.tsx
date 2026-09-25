import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CameraCard } from '../CameraCard';
import type { Camera } from '@/types';

const mockCam: Camera = {
  id: 'c1',
  deviceId: 'd1',
  name: 'Camera Sanh Chinh',
  slug: 'cam_sanh_chinh',
  rtspUrl: 'rtsp://192.168.1.100',
  detectWidth: 1280,
  detectHeight: 720,
  fps: 5,
  timezone: 'Asia/Ho_Chi_Minh',
  isEnabled: true,
  detectionEnabled: true,
  retentionDays: 7,
  sourceType: 'RTSP',
  runtimeStatus: 'ONLINE',
  source: {
    type: 'RTSP',
    displayName: 'rtsp://192.168.1.100',
    isPublishing: true,
    lastError: null,
    requiresBrowserPublisher: false,
  },
  frigateSync: {
    status: 'SYNCED',
    configVersion: 1,
    appliedVersion: 1,
    errorCode: null,
    errorMessage: null,
  },
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
  debugCapabilities: {
    personBoundary: true,
    zoneBoundary: true,
  },
  configVersion: 1,
  syncStatus: 'SYNCED',
  zoneCount: 3,
  createdAt: '2026-03-01T00:00:00.000Z',
};

describe('CameraCard component', () => {
  it('hien thi day du ten, slug, nguon, fps, so zone', () => {
    const html = renderToStaticMarkup(
      <CameraCard
        camera={mockCam}
        isSelected={false}
        isAdmin={true}
        onSelect={vi.fn()}
        onToggleState={vi.fn()}
      />,
    );

    expect(html).toContain('Camera Sanh Chinh');
    expect(html).toContain('cam_sanh_chinh');
    expect(html).toContain('5 FPS');
    expect(html).toContain('3 vùng');
    expect(html).toContain('Đang bật');
    expect(html).toContain('Detection: Bật');
    expect(html).toContain('Frigate: Đã đồng bộ');
  });

  it('hien thi loi gan nhat da duoc backend lam sach', () => {
    const html = renderToStaticMarkup(
      <CameraCard
        camera={{
          ...mockCam,
          runtimeStatus: 'FAILED',
          source: { ...mockCam.source, lastError: 'Không thể kết nối rtsp://***:***@camera/live' },
        }}
        isSelected={false}
        isAdmin={true}
        onSelect={vi.fn()}
        onToggleState={vi.fn()}
      />,
    );

    expect(html).toContain('Không thể kết nối');
    expect(html).not.toContain('secret');
  });

  it('an switch toggle neu nguoi dung khong phai ADMIN', () => {
    const html = renderToStaticMarkup(
      <CameraCard
        camera={mockCam}
        isSelected={false}
        isAdmin={false}
        onSelect={vi.fn()}
        onToggleState={vi.fn()}
      />,
    );

    expect(html).toContain('Camera Sanh Chinh');
    expect(html).not.toContain('checkbox');
    expect(html).not.toContain('Điều khiển:');
  });
});
