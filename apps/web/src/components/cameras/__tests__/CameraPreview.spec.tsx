import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CameraPreview } from '../CameraPreview';
import { CameraDebugToolbar } from '../CameraDebugToolbar';
import { CameraSettingsPanel } from '../CameraSettingsPanel';
import { ZonePolygonLayer } from '../debug/ZonePolygonLayer';
import { PersonBoxLayer } from '../debug/PersonBoxLayer';
import type { Camera } from '@/types';
import type { CameraZone } from '@/lib/cameras-client';

const mockCamera: Camera = {
  id: 'c1111111-1111-1111-1111-111111111111',
  deviceId: 'd1111111-1111-1111-1111-111111111111',
  name: 'Camera Cổng Chính',
  slug: 'camera_cong_chinh',
  rtspUrl: 'rtsp://admin:***@192.168.1.100:554/stream1',
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
    displayName: 'rtsp://admin:***@192.168.1.100:554/stream1',
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
  zoneCount: 2,
  createdAt: '2026-03-01T00:00:00Z',
};

const mockZones: CameraZone[] = [
  {
    id: 'z1',
    cameraId: mockCamera.id,
    name: 'Khu vực bếp',
    slug: 'zone_bep',
    zoneType: 'RESTRICTED',
    polygon: [
      [0.1, 0.1],
      [0.4, 0.1],
      [0.4, 0.8],
      [0.1, 0.8],
    ],
    isEnabled: true,
  },
  {
    id: 'z2',
    cameraId: mockCamera.id,
    name: 'Sofa phòng khách',
    slug: 'zone_sofa',
    zoneType: 'REST_AREA',
    polygon: [
      [0.5, 0.2],
      [0.9, 0.2],
      [0.9, 0.8],
      [0.5, 0.8],
    ],
    isEnabled: true,
  },
];

describe('CameraPreview & 2 Toggle Overlay Components', () => {
  it('CameraPreview render day du layout, badges va control toolbar', () => {
    const html = renderToStaticMarkup(<CameraPreview camera={mockCamera} />);

    expect(html).toContain('Debug View: BẬT');
    expect(html).toContain('Person boundary: ON');
    expect(html).toContain('Zone boundary: ON');
    expect(html).toContain('No current person detections');
    expect(html).toContain('ONLINE');
    expect(html).toContain('RES: 1280x720');
    expect(html).toContain('FPS: 5');
    expect(html).toContain('Camera zones');
    expect(html).not.toContain('foot-point');
  });

  it('CameraDebugToolbar hien thi dung trang thai khi Debug View BAT', () => {
    const html = renderToStaticMarkup(
      <CameraDebugToolbar
        debugEnabled={true}
        showPerson={true}
        showZone={false}
        onToggleDebug={vi.fn()}
        onTogglePerson={vi.fn()}
        onToggleZone={vi.fn()}
      />,
    );

    expect(html).toContain('Debug View: BẬT');
    expect(html).toContain('Person boundary: ON');
    expect(html).toContain('Zone boundary: OFF');
  });

  it('CameraDebugToolbar an cac toggle con khi Debug View TAT', () => {
    const html = renderToStaticMarkup(
      <CameraDebugToolbar
        debugEnabled={false}
        showPerson={false}
        showZone={false}
        onToggleDebug={vi.fn()}
        onTogglePerson={vi.fn()}
        onToggleZone={vi.fn()}
      />,
    );

    expect(html).toContain('Debug View: TẮT');
    expect(html).not.toContain('Person boundary');
    expect(html).not.toContain('Zone boundary');
  });

  it('ZonePolygonLayer ve da giac va nhan ten cac vung giam sat', () => {
    const html = renderToStaticMarkup(
      <svg>
        <ZonePolygonLayer
          zones={mockZones}
          activeZoneSlugs={new Set(['zone_bep'])}
          width={1000}
          height={562.5}
        />
      </svg>,
    );

    expect(html).toContain('Khu vực bếp');
    expect(html).toContain('Sofa phòng khách');
    expect(html).toContain('points="100.0,56.3 400.0,56.3 400.0,450.0 100.0,450.0"');
  });

  it('PersonBoxLayer ve bounding box, nhan nguoi va diem chan de Frigate foot-point', () => {
    const person = {
      x: 0.2,
      y: 0.3,
      width: 0.1,
      height: 0.4,
      confidence: 0.92,
    };

    const htmlWithFootpoint = renderToStaticMarkup(
      <svg>
        <PersonBoxLayer person={person} showFootpoint={true} width={1000} height={500} />
      </svg>,
    );

    expect(htmlWithFootpoint).toContain('person 92%');
    expect(htmlWithFootpoint).toContain('foot-point');

    const htmlWithoutFootpoint = renderToStaticMarkup(
      <svg>
        <PersonBoxLayer person={person} showFootpoint={false} width={1000} height={500} />
      </svg>,
    );

    expect(htmlWithoutFootpoint).toContain('person 92%');
    expect(htmlWithoutFootpoint).not.toContain('foot-point');
  });

  it('CameraSettingsPanel hien thi thong tin cau hinh va nut dong bo cho ADMIN', () => {
    const html = renderToStaticMarkup(<CameraSettingsPanel camera={mockCamera} isAdmin={true} />);

    expect(html).toContain('Chiều rộng detect');
    expect(html).toContain('Chiều cao detect');
    expect(html).toContain('v1');
    expect(html).toContain('SYNCED');
    expect(html).toContain('Thử đồng bộ lại');
  });
});
