'use client';

import React, { useEffect, useState } from 'react';
import type { Camera } from '@/types';
import type { CameraDebugStream } from '@/lib/cameras-client';
import { fetchCameraDebugStream } from '@/lib/cameras-client';
import { CameraLiveStream } from './CameraLiveStream';
import { PersonBoxLayer } from './debug/PersonBoxLayer';
import { useLivePersonDetections } from './live/use-live-person-detections';
import { CameraStatusBadge } from './CameraStatusBadge';
import { useWebcamSession } from './source/webcam-session-manager';
import styles from './styles/camera-grid.module.css';

function GridTileOsd({
  camera,
  isLive,
  resolution,
  sourceLabel,
  currentTimeString,
}: {
  camera: Camera;
  isLive: boolean;
  resolution: string;
  sourceLabel: string;
  currentTimeString: string;
}) {
  return (
    <div className={styles.osdOverlay}>
      <div className={styles.osdTopRow}>
        <span className={styles.osdCameraTitle}>
          {camera.name.toUpperCase()} [{camera.slug}]
        </span>
        <span className={styles.osdClock}>{currentTimeString}</span>
      </div>

      <div className={styles.osdBottomRow}>
        <span className={styles.osdStreamStats}>
          MAIN - {camera.fps}.00 FPS | {resolution} | {sourceLabel}
        </span>
        <span className={styles.osdLocationTag}>{isLive ? 'LIVE' : camera.runtimeStatus}</span>
      </div>
    </div>
  );
}

interface CameraGridTileProps {
  camera: Camera;
  showOsd?: boolean;
  showDetections?: boolean;
  isFocused?: boolean;
  currentTimeString: string;
  onSelect: () => void;
  onSwitchToList: (cameraId: string) => void;
  onToggleState: (cameraId: string, isEnabled: boolean) => void;
  onToggleFocus?: () => void;
}

export function CameraGridTile({
  camera,
  showOsd = true,
  showDetections = true,
  isFocused = false,
  currentTimeString,
  onSelect,
  onSwitchToList,
  onToggleState,
  onToggleFocus,
}: CameraGridTileProps) {
  const [debugData, setDebugData] = useState<CameraDebugStream | null>(null);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    let isCancelled = false;
    let inFlight = false;
    const loadStream = () => {
      if (!camera.isEnabled) {
        setDebugData(null);
        return;
      }
      if (inFlight) return;
      inFlight = true;
      fetchCameraDebugStream(camera.id)
        .then((data) => {
          if (!isCancelled) {
            setDebugData(data);
            setHasError(false);
          }
        })
        .catch(() => {
          if (!isCancelled) setHasError(true);
        })
        .finally(() => {
          inFlight = false;
        });
    };

    void loadStream();
    const interval = camera.isEnabled ? setInterval(loadStream, showDetections ? 80 : 1000) : null;
    return () => {
      isCancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [camera.id, camera.isEnabled, showDetections]);

  const personDetections = useLivePersonDetections(
    debugData,
    camera.id,
    camera.isEnabled && showDetections,
    camera.sourceType,
  );
  const overlayHeight = (1000 * (camera.detectHeight || 720)) / (camera.detectWidth || 1280);

  const { isPublishing: isWebcamPublishing } = useWebcamSession(camera.id);
  const isWebcamActive = camera.sourceType === 'BROWSER_WEBCAM' && isWebcamPublishing;
  const isLive =
    camera.isEnabled &&
    (camera.runtimeStatus === 'ONLINE' || Boolean(debugData?.streamUrl) || isWebcamActive);
  const effectiveStatus = isLive ? 'ONLINE' : camera.runtimeStatus;
  const resolution =
    camera.detectWidth && camera.detectHeight
      ? `${camera.detectWidth}x${camera.detectHeight}`
      : '1280x720';

  const sourceLabel =
    camera.sourceType === 'BROWSER_WEBCAM'
      ? 'WEBCAM'
      : camera.sourceType === 'VIDEO_FILE'
        ? 'VIDEO'
        : 'RTSP';

  return (
    <div className={`${styles.tileCard} ${isFocused ? styles.tileCardFocused : ''}`}>
      {/* Tiêu đề thẻ camera nền sáng */}
      <div className={styles.tileHeader}>
        <div className={styles.tileHeaderLeft}>
          <h4 className={styles.tileName}>{camera.name}</h4>
          <span className={styles.tileSlug}>({camera.slug})</span>
        </div>
        <CameraStatusBadge isEnabled={camera.isEnabled} runtimeStatus={effectiveStatus} />
      </div>

      {/* Khung video màn hình 16:9 */}
      <div
        className={styles.tileScreen}
        onClick={onSelect}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') onSelect();
        }}
        title={`${camera.name} - Bấm để phóng to hoặc chọn`}
      >
        {isLive && debugData?.streamUrl && !hasError ? (
          <CameraLiveStream
            streamUrl={debugData.streamUrl}
            title={camera.name}
            className={styles.videoFrame}
          />
        ) : (
          <div className={styles.noSignalWrapper}>
            <div className={styles.crosshair} />
            <span className={styles.noSignalText}>
              {!camera.isEnabled
                ? 'CAMERA ĐANG TẮT'
                : hasError || camera.runtimeStatus === 'FAILED'
                  ? 'MẤT TÍN HIỆU (NO SIGNAL)'
                  : 'ĐANG KẾT NỐI LUỒNG...'}
            </span>
          </div>
        )}

        {isLive && showDetections && (
          <svg className={styles.detectionSvgOverlay} viewBox={`0 0 1000 ${overlayHeight}`}>
            {personDetections.map((person) => (
              <PersonBoxLayer
                key={person.id}
                person={person}
                height={overlayHeight}
                showFootpoint={false}
              />
            ))}
          </svg>
        )}

        {showOsd && (
          <GridTileOsd
            camera={{ ...camera, runtimeStatus: effectiveStatus }}
            isLive={isLive}
            resolution={resolution}
            sourceLabel={sourceLabel}
            currentTimeString={currentTimeString}
          />
        )}
      </div>

      {/* Chân thẻ nền sáng với các nút hành động */}
      <div className={styles.tileFooter}>
        <div className={styles.tileFooterMeta}>
          <span>{sourceLabel}</span>
          <span>•</span>
          <span>{camera.fps} FPS</span>
          <span>•</span>
          <span>{resolution}</span>
        </div>

        <div className={styles.tileFooterActions}>
          {onToggleFocus && (
            <button
              type="button"
              className={styles.tileBtn}
              onClick={onToggleFocus}
              title={isFocused ? 'Thu nhỏ' : 'Phóng to ô này'}
            >
              {isFocused ? 'Thu nhỏ' : 'Phóng to'}
            </button>
          )}
          <button
            type="button"
            className={`${styles.tileBtn} ${styles.tileBtnPrimary}`}
            onClick={() => onSwitchToList(camera.id)}
            title="Mở cấu hình & chi tiết camera"
          >
            Chi tiết
          </button>
          <button
            type="button"
            className={styles.tileBtn}
            onClick={() => onToggleState(camera.id, !camera.isEnabled)}
            title={camera.isEnabled ? 'Tắt camera' : 'Bật camera'}
          >
            {camera.isEnabled ? 'Tắt' : 'Bật'}
          </button>
        </div>
      </div>
    </div>
  );
}
