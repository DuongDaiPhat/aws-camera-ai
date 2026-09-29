import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Camera } from '@/types';
import { CameraSettingsPanel } from '../CameraSettingsPanel';

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
