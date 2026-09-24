import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DebugView } from './DebugView';
import { DebugControlsBar } from './DebugControlsBar';
import { ZonePolygonLayer } from './ZonePolygonLayer';
import { PersonBoxLayer } from './PersonBoxLayer';
import { FrigateSettingsPanel } from './FrigateSettingsPanel';
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
  configVersion: 1,
  syncStatus: 'APPLIED',
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
    polygon: [[0.1, 0.1], [0.4, 0.1], [0.4, 0.8], [0.1, 0.8]],
    isEnabled: true,
  },
  {
    id: 'z2',
    cameraId: mockCamera.id,
    name: 'Sofa phòng khách',
    slug: 'zone_sofa',
    zoneType: 'REST_AREA',
    polygon: [[0.5, 0.2], [0.9, 0.2], [0.9, 0.8], [0.5, 0.8]],
    isEnabled: true,
  },
];

describe('DebugView & 2 Toggle Overlay Components', () => {
  it('DebugView render day du layout, badges va control toolbar', () => {
    const html = renderToStaticMarkup(<DebugView camera={mockCamera} />);

    expect(html).toContain('Debug View: BẬT');
    expect(html).toContain('Person boundary: ON');
    expect(html).toContain('Zone boundary: ON');
    expect(html).toContain('Mô phỏng phát hiện');
    expect(html).toContain('LIVE');
    expect(html).toContain('RES: 1280x720');
    expect(html).toContain('FPS: 5');
    expect(html).toContain('foot-point');
  });

  it('DebugControlsBar hien thi dung trang thai khi Debug View BAT', () => {
    const html = renderToStaticMarkup(
      <DebugControlsBar
        debugEnabled={true}
        showPerson={true}
        showZone={false}
        isSimulating={false}
        onToggleDebug={vi.fn()}
        onTogglePerson={vi.fn()}
        onToggleZone={vi.fn()}
        onToggleSimulate={vi.fn()}
      />,
    );

    expect(html).toContain('Debug View: BẬT');
    expect(html).toContain('Person boundary: ON');
    expect(html).toContain('Zone boundary: OFF');
    expect(html).toContain('Mô phỏng phát hiện');
  });

  it('DebugControlsBar an cac toggle con khi Debug View TAT', () => {
    const html = renderToStaticMarkup(
      <DebugControlsBar
        debugEnabled={false}
        showPerson={false}
        showZone={false}
        isSimulating={false}
        onToggleDebug={vi.fn()}
        onTogglePerson={vi.fn()}
        onToggleZone={vi.fn()}
        onToggleSimulate={vi.fn()}
      />,
    );

    expect(html).toContain('Debug View: TẮT');
    expect(html).not.toContain('Person boundary');
    expect(html).not.toContain('Zone boundary');
    expect(html).not.toContain('Mô phỏng phát hiện');
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

  it('FrigateSettingsPanel hien thi thong tin cau hinh va nut dong bo cho ADMIN', () => {
    const html = renderToStaticMarkup(
      <FrigateSettingsPanel camera={mockCamera} isAdmin={true} />,
    );

    expect(html).toContain('Bảo toàn Polygon Zones');
    expect(html).toContain('1280x720');
    expect(html).toContain('v1');
    expect(html).toContain('APPLIED');
    expect(html).toContain('Đồng bộ lại xuống Frigate');
  });
});
