import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CameraList } from '../CameraList';
import type { Camera } from '@/types';

const mockCameras: Camera[] = [
  {
    id: 'c1',
    deviceId: 'd1',
    name: 'Camera Cổng Trước',
    slug: 'cam_cong_truoc',
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
    zoneCount: 1,
    createdAt: '2026-03-01T00:00:00.000Z',
  },
  {
    id: 'c2',
    deviceId: 'd1',
    name: 'Camera Sân Sau',
    slug: 'cam_san_sau',
    rtspUrl: 'rtsp://192.168.1.101',
    detectWidth: 1280,
    detectHeight: 720,
    fps: 5,
    timezone: 'Asia/Ho_Chi_Minh',
    isEnabled: false,
    detectionEnabled: true,
    retentionDays: 7,
    sourceType: 'VIDEO_FILE',
    runtimeStatus: 'DISABLED',
    source: {
      type: 'VIDEO_FILE',
      displayName: 'demo.mp4',
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
    zoneCount: 0,
    createdAt: '2026-03-01T00:00:00.000Z',
  },
];

describe('CameraList component', () => {
  it('hien thi danh sach camera va cac tab loc', () => {
    const html = renderToStaticMarkup(
      <CameraList
        cameras={mockCameras}
        selectedId="c1"
        isAdmin={true}
        onSelectCamera={vi.fn()}
        onToggleState={vi.fn()}
      />,
    );

    expect(html).toContain('Danh sách camera (2)');
    expect(html).toContain('Tất cả');
    expect(html).toContain('Bật');
    expect(html).toContain('Tắt');
    expect(html).toContain('Lỗi');
    expect(html).toContain('Camera Cổng Trước');
    expect(html).toContain('Camera Sân Sau');
  });

  it('hien thi empty state khi khong co camera nao', () => {
    const html = renderToStaticMarkup(
      <CameraList
        cameras={[]}
        selectedId={null}
        isAdmin={true}
        onSelectCamera={vi.fn()}
        onToggleState={vi.fn()}
      />,
    );

    expect(html).toContain('Không tìm thấy camera nào phù hợp.');
  });
});
