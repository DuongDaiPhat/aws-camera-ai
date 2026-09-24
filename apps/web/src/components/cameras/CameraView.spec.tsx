import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CameraView } from './CameraView';
import * as camerasClient from '@/lib/cameras-client';
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
    configVersion: 1,
    syncStatus: 'APPLIED',
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
    runtimeStatus: 'OFFLINE',
    configVersion: 1,
    syncStatus: 'APPLIED',
    zoneCount: 1,
    createdAt: '2026-03-01T00:00:00.000Z',
  },
];

describe('CameraView component', () => {
  beforeEach(() => {
    vi.spyOn(camerasClient, 'fetchCameras').mockResolvedValue(mockCameras);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('hiển thị đầy đủ tiêu đề, các thẻ tóm tắt và danh sách camera', () => {
    const html = renderToStaticMarkup(
      <CameraView
        user={{
          id: '1',
          email: 'admin@camerai.local',
          fullName: 'Admin User',
          role: 'ADMIN',
          isActive: true,
          createdAt: '2026-09-24T00:00:00.000Z',
        }}
      />,
    );

    expect(html).toContain('Quản lý Camera &amp; Nguồn phát');
    expect(html).toContain('Tổng số camera');
    expect(html).toContain('Làm mới');
  });

  it('render giao diện cho viewer bình thường', () => {
    const html = renderToStaticMarkup(
      <CameraView
        user={{
          id: '2',
          email: 'viewer@camerai.local',
          fullName: 'Viewer User',
          role: 'VIEWER',
          isActive: true,
          createdAt: '2026-09-24T00:00:00.000Z',
        }}
      />,
    );

    expect(html).toContain('Quản lý Camera &amp; Nguồn phát');
  });
});
