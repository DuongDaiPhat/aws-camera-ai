import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CameraGridView } from '../CameraGridView';
import type { Camera } from '@/types';

const mockCameras: Camera[] = [
  {
    id: 'c1',
    deviceId: 'd1',
    name: 'Phòng khách',
    slug: 'cam_living_room',
    rtspUrl: 'rtsp://192.168.1.100',
    detectWidth: 1280,
    detectHeight: 720,
    fps: 5,
    timezone: 'Asia/Ho_Chi_Minh',
    isEnabled: true,
    detectionEnabled: true,
    retentionDays: 7,
    sourceType: 'BROWSER_WEBCAM',
    runtimeStatus: 'ONLINE',
    source: {
      type: 'BROWSER_WEBCAM',
      displayName: null,
      isPublishing: true,
      lastError: null,
      requiresBrowserPublisher: true,
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
    zoneCount: 2,
    createdAt: '2026-03-01T00:00:00.000Z',
  },
  {
    id: 'c2',
    deviceId: 'd1',
    name: 'Bếp',
    slug: 'cam_kitchen',
    rtspUrl: 'rtsp://192.168.1.101',
    detectWidth: 1280,
    detectHeight: 720,
    fps: 5,
    timezone: 'Asia/Ho_Chi_Minh',
    isEnabled: false,
    detectionEnabled: true,
    retentionDays: 7,
    sourceType: 'RTSP',
    runtimeStatus: 'DISABLED',
    source: {
      type: 'RTSP',
      displayName: 'rtsp://192.168.1.101',
      isPublishing: false,
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
    zoneCount: 1,
    createdAt: '2026-03-01T00:00:00.000Z',
  },
];

describe('CameraGridView component', () => {
  it('hiển thị đầy đủ thanh công cụ giám sát, số lượng camera và các ô camera', () => {
    const html = renderToStaticMarkup(
      <CameraGridView
        cameras={mockCameras}
        onSelectCamera={vi.fn()}
        onSwitchToList={vi.fn()}
        onToggleState={vi.fn()}
      />,
    );

    expect(html).toContain('Tường giám sát toàn bộ Camera');
    expect(html).toContain('1/2 Camera đang online');
    expect(html).toContain('Lưới 2x2');
    expect(html).toContain('Lưới 3x2');
    expect(html).toContain('Phòng khách');
    expect(html).toContain('Bếp');
    expect(html).toContain('Dạng danh sách');
  });

  it('hiển thị thông báo khi hệ thống chưa có camera nào', () => {
    const html = renderToStaticMarkup(
      <CameraGridView
        cameras={[]}
        onSelectCamera={vi.fn()}
        onSwitchToList={vi.fn()}
        onToggleState={vi.fn()}
      />,
    );

    expect(html).toContain('Chưa có camera nào trong hệ thống');
    expect(html).toContain('Quay lại danh sách');
  });

  it('hiển thị đúng thông số kỹ thuật và trạng thái mất tín hiệu khi camera tắt', () => {
    const html = renderToStaticMarkup(
      <CameraGridView
        cameras={mockCameras}
        onSelectCamera={vi.fn()}
        onSwitchToList={vi.fn()}
        onToggleState={vi.fn()}
      />,
    );

    expect(html).toContain('CAMERA ĐANG TẮT');
    expect(html).toContain('5 FPS');
    expect(html).toContain('1280x720');
  });
});
