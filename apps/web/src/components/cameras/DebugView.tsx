'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { Camera } from '@/types';
import type { CameraZone } from '@/lib/cameras-client';
import { fetchCameraZones } from '@/lib/cameras-client';
import { DebugControlsBar } from './DebugControlsBar';
import { ZonePolygonLayer } from './ZonePolygonLayer';
import { PersonBoxLayer, type DetectedPerson } from './PersonBoxLayer';
import { isPointInPolygon } from './geometry-utils';
import styles from './debug-view.module.css';

interface DebugViewProps {
  camera: Camera;
}

const DEFAULT_PERSON: DetectedPerson = {
  x: 0.18,
  y: 0.25,
  width: 0.14,
  height: 0.42,
  confidence: 0.88,
  label: 'person',
};

const SAMPLE_ZONES: CameraZone[] = [
  {
    id: 'sample-zone-1',
    cameraId: '',
    name: 'Khu vực bếp',
    slug: 'zone_bep',
    zoneType: 'RESTRICTED',
    polygon: [[0.08, 0.15], [0.42, 0.15], [0.42, 0.82], [0.08, 0.82]],
    isEnabled: true,
  },
  {
    id: 'sample-zone-2',
    cameraId: '',
    name: 'Ghế sofa',
    slug: 'zone_sofa',
    zoneType: 'REST_AREA',
    polygon: [[0.58, 0.25], [0.92, 0.25], [0.92, 0.85], [0.58, 0.85]],
    isEnabled: true,
  },
];

function useStoredToggle(key: string, defaultValue: boolean): [boolean, () => void] {
  const [val, setVal] = useState<boolean>(() => {
    if (typeof window === 'undefined') return defaultValue;
    const stored = localStorage.getItem(key);
    return stored !== null ? stored === 'true' : defaultValue;
  });

  const toggle = useCallback(() => {
    setVal((prev) => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        localStorage.setItem(key, String(next));
      }
      return next;
    });
  }, [key]);

  return [val, toggle];
}

export function DebugView({ camera }: DebugViewProps) {
  const [debugEnabled, toggleDebug] = useStoredToggle(`cam_debug_enabled_${camera.id}`, true);
  const [showPerson, togglePerson] = useStoredToggle(`cam_debug_person_${camera.id}`, true);
  const [showZone, toggleZone] = useStoredToggle(`cam_debug_zone_${camera.id}`, true);

  const [zones, setZones] = useState<CameraZone[]>([]);
  const [isSimulating, setIsSimulating] = useState(false);
  const [simPerson, setSimPerson] = useState<DetectedPerson>(DEFAULT_PERSON);

  // Tải danh sách zones thực tế từ DB/API, nếu rỗng thì dùng sample zones
  useEffect(() => {
    let isCancelled = false;
    fetchCameraZones(camera.id).then((data) => {
      if (!isCancelled) {
        setZones(data.length > 0 ? data : SAMPLE_ZONES);
      }
    });
    return () => {
      isCancelled = true;
    };
  }, [camera.id]);

  // Vòng lặp mô phỏng di chuyển đối tượng người
  useEffect(() => {
    if (!isSimulating) return;

    let step = 0;
    const interval = setInterval(() => {
      step += 0.05;
      const x = 0.25 + 0.45 * Math.abs(Math.sin(step));
      const y = 0.22 + 0.1 * Math.cos(step * 0.7);
      setSimPerson((prev) => ({
        ...prev,
        x,
        y,
        confidence: 0.85 + 0.1 * Math.sin(step),
      }));
    }, 100);

    return () => clearInterval(interval);
  }, [isSimulating]);

  // Tính toán vùng nào đang có điểm chân đế (Foot-point) nằm bên trong
  const activeZoneSlugs = useMemo(() => {
    const footPoint: [number, number] = [
      simPerson.x + simPerson.width / 2,
      simPerson.y + simPerson.height,
    ];
    const active = new Set<string>();
    for (const z of zones) {
      if (isPointInPolygon(footPoint, z.polygon)) {
        active.add(z.slug);
      }
    }
    return active;
  }, [simPerson, zones]);

  const resolution =
    camera.detectWidth && camera.detectHeight
      ? `${camera.detectWidth}x${camera.detectHeight}`
      : '1280x720';

  return (
    <div className={styles.debugContainer}>
      <DebugControlsBar
        debugEnabled={debugEnabled}
        showPerson={showPerson}
        showZone={showZone}
        isSimulating={isSimulating}
        onToggleDebug={toggleDebug}
        onTogglePerson={togglePerson}
        onToggleZone={toggleZone}
        onToggleSimulate={() => setIsSimulating((prev) => !prev)}
      />

      <div className={styles.videoWrapper}>
        <div className={styles.videoPlaceholder}>
          <div className={styles.placeholderGrid} />
          <span style={{ fontSize: '13px', zIndex: 1 }}>
            {camera.isEnabled ? 'Đang kết nối luồng MediaMTX/WebRTC...' : 'Camera đang tắt'}
          </span>
        </div>

        <div className={styles.hudBadges}>
          <span className={styles.hudBadge}>
            <span className={styles.hudLiveDot} /> LIVE
          </span>
          <span className={styles.hudBadge}>RES: {resolution}</span>
          <span className={styles.hudBadge}>FPS: {camera.fps}</span>
          <span className={styles.hudBadge}>SOURCE: {camera.sourceType}</span>
        </div>

        {debugEnabled && (
          <svg className={styles.svgOverlay} viewBox="0 0 1000 562.5">
            {showZone && (
              <ZonePolygonLayer zones={zones} activeZoneSlugs={activeZoneSlugs} />
            )}
            {showPerson && (
              <PersonBoxLayer person={simPerson} showFootpoint={showZone} />
            )}
          </svg>
        )}
      </div>

      <div className={styles.infoFootnote}>
        <span>
          Frigate Foot-point Logic: Tọa độ điểm chân đế = giữa cạnh dưới bounding box (x + w/2, y + h).
        </span>
        <span className={styles.footpointLegend}>
          <span className={styles.footpointDot} /> Điểm kích hoạt Zone
        </span>
      </div>
    </div>
  );
}
