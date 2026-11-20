'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { Camera } from '@/types';
import type { CameraZone } from '@/lib/cameras-client';
import { fetchCameraZones } from '@/lib/cameras-client';
import { CameraDebugToolbar } from './CameraDebugToolbar';
import { ZonePolygonLayer } from './debug/ZonePolygonLayer';
import { CameraAnnotations } from './CameraAnnotations';
import { CameraStreamViewport } from './CameraStreamViewport';
import { useCameraDebugStream } from './live/use-camera-debug-stream';
import { hasLiveSource } from './live/live-stream-state';
import type { LiveStreamStatus } from './live/camera-reader';
import { useWebcamSession } from './source/webcam-session-manager';
import { useLivePersonDetections } from './live/use-live-person-detections';
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
  const [playback, setPlayback] = useState<{ id: string; status: LiveStreamStatus } | null>(null);
  const isPlaying = camera.isEnabled && playback?.id === camera.id && playback.status === 'live';
  const effectiveStatus = isPlaying
    ? 'ONLINE'
    : camera.runtimeStatus === 'ONLINE'
      ? playback?.status === 'unavailable'
        ? 'FAILED'
        : 'STARTING'
      : camera.runtimeStatus;
  const { isPublishing } = useWebcamSession(camera.id);
  const [debugEnabled, toggleDebug] = useStoredToggle(`cam_debug_enabled_${camera.id}`, true);
  const [showPerson, togglePerson] = useStoredToggle(`cam_debug_person_${camera.id}`, true);
  const [showZone, toggleZone] = useStoredToggle(`cam_debug_zone_${camera.id}`, true);

  const [zones, setZones] = useState<CameraZone[]>([]);
  const { data: debugData, error: loadError } = useCameraDebugStream(camera.id, camera.isEnabled);
  const [zoneError, setZoneError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setZones([]);
    setZoneError(false);
    fetchCameraZones(camera.id)
      .then((result) => {
        if (!cancelled) setZones(result.filter((zone) => zone.isEnabled));
      })
      .catch(() => {
        if (!cancelled) setZoneError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [camera.id]);

  const activeZoneSlugs = useMemo(() => {
    return new Set(debugData?.activeZones ?? []);
  }, [debugData]);

  const detectedPeople = useLivePersonDetections(
    debugData,
    camera.id,
    camera.isEnabled && debugEnabled && showPerson,
    camera.sourceType,
  );

  const personCount = detectedPeople.length;
  const overlayHeight = (1000 * (camera.detectHeight || 720)) / (camera.detectWidth || 1280);

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
        {debugData?.streamUrl && hasLiveSource(camera, isPublishing) ? (
          <CameraStreamViewport
            streamUrl={debugData.streamUrl}
            title={camera.name}
            width={camera.detectWidth}
            height={camera.detectHeight}
            fullscreen
            onStatusChange={(status) => setPlayback({ id: camera.id, status })}
          >
            {debugEnabled && camera.isEnabled && (
              <CameraAnnotations
                cameraId={camera.id}
                people={showPerson ? detectedPeople : []}
                height={overlayHeight}
                showFootpoint={showZone}
              >
                {showZone && (
                  <ZonePolygonLayer
                    zones={zones}
                    activeZoneSlugs={activeZoneSlugs}
                    height={overlayHeight}
                  />
                )}
              </CameraAnnotations>
            )}
          </CameraStreamViewport>
        ) : (
          <div className={styles.videoPlaceholder}>
            <div className={styles.placeholderGrid} />
            <span style={{ fontSize: '13px', zIndex: 1 }}>
              {loadError
                ? 'Không tải được dữ liệu camera'
                : camera.isEnabled
                  ? 'Đang chờ nguồn phát camera'
                  : 'Camera đang tắt'}
            </span>
          </div>
        )}

        <div className={styles.hudBadges}>
          <span className={styles.hudBadge}>
            {isPlaying && <span className={styles.hudLiveDot} />}
            {effectiveStatus}
          </span>
          <span className={styles.hudBadge}>RES: {resolution}</span>
          <span className={styles.hudBadge}>FPS: {camera.fps}</span>
          <span className={styles.hudBadge}>SOURCE: {camera.sourceType}</span>
        </div>
      </div>

      <div className={styles.infoFootnote}>
        <span>
          {personCount > 0
            ? `${personCount} person detection(s) from Frigate`
            : 'No current person detections'}
        </span>
        <span className={styles.footpointLegend}>
          <span className={styles.footpointDot} />{' '}
          {zoneError ? 'Không tải được vùng giám sát' : 'Camera zones'}
        </span>
      </div>
    </div>
  );
}
