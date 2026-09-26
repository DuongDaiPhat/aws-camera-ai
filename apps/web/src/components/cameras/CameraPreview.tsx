'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { Camera } from '@/types';
import type { CameraDebugStream, CameraZone } from '@/lib/cameras-client';
import { fetchCameraDebugStream, fetchCameraZones } from '@/lib/cameras-client';
import { CameraDebugToolbar } from './CameraDebugToolbar';
import { ZonePolygonLayer } from './debug/ZonePolygonLayer';
import { PersonBoxLayer, type DetectedPerson } from './debug/PersonBoxLayer';
import { CameraLiveStream } from './CameraLiveStream';
import styles from './styles/camera-preview.module.css';

interface CameraPreviewProps {
  camera: Camera;
}

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

export function CameraPreview({ camera }: CameraPreviewProps) {
  const [debugEnabled, toggleDebug] = useStoredToggle(`cam_debug_enabled_${camera.id}`, true);
  const [showPerson, togglePerson] = useStoredToggle(`cam_debug_person_${camera.id}`, true);
  const [showZone, toggleZone] = useStoredToggle(`cam_debug_zone_${camera.id}`, true);

  const [zones, setZones] = useState<CameraZone[]>([]);
  const [debugData, setDebugData] = useState<CameraDebugStream | null>(null);
  const [loadError, setLoadError] = useState(false);

  // Tải danh sách zones thực tế từ DB/API, nếu rỗng thì dùng sample zones
  useEffect(() => {
    let isCancelled = false;
    const loadDebugData = () =>
      fetchCameraDebugStream(camera.id)
        .then((stream) => {
          if (!isCancelled) {
            setDebugData(stream);
            setLoadError(false);
          }
        })
        .catch(() => {
          if (!isCancelled) setLoadError(true);
        });

    void fetchCameraZones(camera.id).then((cameraZones) => {
      if (!isCancelled) setZones(cameraZones.filter((zone) => zone.isEnabled));
    });
    void loadDebugData();
    const refreshTimer = camera.isEnabled ? setInterval(() => void loadDebugData(), 1000) : null;
    return () => {
      isCancelled = true;
      if (refreshTimer) clearInterval(refreshTimer);
    };
  }, [camera.id, camera.isEnabled]);

  const activeZoneSlugs = useMemo(() => {
    return new Set(debugData?.activeZones ?? []);
  }, [debugData]);

  const detectedPeople = useMemo<DetectedPerson[]>(
    () =>
      (debugData?.detections ?? [])
        .filter((item) => item.label === 'person' && item.box.length === 4)
        .map((item) => {
          const [yMin, xMin, yMax, xMax] = item.box;
          return {
            x: xMin,
            y: yMin,
            width: xMax - xMin,
            height: yMax - yMin,
            confidence: item.confidence,
            label: item.label,
          };
        }),
    [debugData],
  );

  const resolution =
    camera.detectWidth && camera.detectHeight
      ? `${camera.detectWidth}x${camera.detectHeight}`
      : '1280x720';

  return (
    <div className={styles.debugContainer}>
      <CameraDebugToolbar
        debugEnabled={debugEnabled}
        showPerson={showPerson}
        showZone={showZone}
        onToggleDebug={toggleDebug}
        onTogglePerson={togglePerson}
        onToggleZone={toggleZone}
      />

      <div className={styles.videoWrapper}>
        {debugData?.streamUrl && camera.isEnabled ? (
          <CameraLiveStream
            className={styles.videoElement}
            streamUrl={debugData.streamUrl}
            title={camera.name}
          />
        ) : (
          <div className={styles.videoPlaceholder}>
            <div className={styles.placeholderGrid} />
            <span style={{ fontSize: '13px', zIndex: 1 }}>
              {loadError
                ? 'Không tải được dữ liệu camera'
                : camera.isEnabled
                  ? 'Chưa có snapshot camera'
                  : 'Camera đang tắt'}
            </span>
          </div>
        )}

        <div className={styles.hudBadges}>
          <span className={styles.hudBadge}>
            {camera.runtimeStatus === 'ONLINE' && <span className={styles.hudLiveDot} />}
            {camera.runtimeStatus}
          </span>
          <span className={styles.hudBadge}>RES: {resolution}</span>
          <span className={styles.hudBadge}>FPS: {camera.fps}</span>
          <span className={styles.hudBadge}>SOURCE: {camera.sourceType}</span>
        </div>

        {debugEnabled && (
          <svg className={styles.svgOverlay} viewBox="0 0 1000 562.5">
            {showZone && <ZonePolygonLayer zones={zones} activeZoneSlugs={activeZoneSlugs} />}
            {showPerson &&
              detectedPeople.map((person, index) => (
                <PersonBoxLayer
                  key={`${person.label}-${index}`}
                  person={person}
                  showFootpoint={showZone}
                />
              ))}
          </svg>
        )}
      </div>

      <div className={styles.infoFootnote}>
        <span>
          {detectedPeople.length > 0
            ? `${detectedPeople.length} person detection(s) from Frigate`
            : 'No current person detections'}
        </span>
        <span className={styles.footpointLegend}>
          <span className={styles.footpointDot} /> Camera zones
        </span>
      </div>
    </div>
  );
}
