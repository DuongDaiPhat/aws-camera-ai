'use client';

import React, { useState } from 'react';
import type { Camera } from '@/types';
import { CameraStreamViewport } from './CameraStreamViewport';
import { useCameraDebugStream } from './live/use-camera-debug-stream';
import { CameraAnnotations } from './CameraAnnotations';
import { useLivePersonDetections } from './live/use-live-person-detections';
import { CameraStatusBadge } from './CameraStatusBadge';
import { useWebcamSession } from './source/webcam-session-manager';
import { hasLiveSource } from './live/live-stream-state';
import type { LiveStreamStatus } from './live/camera-reader';
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
  const [playback, setPlayback] = useState<{ id: string; status: LiveStreamStatus } | null>(null);
  const { data: debugData, error: hasError } = useCameraDebugStream(camera.id, camera.isEnabled);

  const personDetections = useLivePersonDetections(
    debugData,
    camera.id,
    camera.isEnabled && showDetections,
    camera.sourceType,
  );
  const overlayHeight = (1000 * (camera.detectHeight || 720)) / (camera.detectWidth || 1280);

  const { isPublishing: isWebcamPublishing } = useWebcamSession(camera.id);
  const isWebcamActive = camera.sourceType === 'BROWSER_WEBCAM' && isWebcamPublishing;
  const canRead = hasLiveSource(camera, isWebcamActive);
  const isLive = canRead && playback?.id === camera.id && playback.status === 'live';
  const effectiveStatus = isLive
    ? 'ONLINE'
    : camera.runtimeStatus === 'ONLINE'
      ? playback?.status === 'unavailable'
        ? 'FAILED'
        : 'STARTING'
      : camera.runtimeStatus;
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
        {canRead && debugData?.streamUrl ? (
          <CameraStreamViewport
            streamUrl={debugData.streamUrl}
            title={camera.name}
            width={camera.detectWidth}
            height={camera.detectHeight}
            onStatusChange={(status) => setPlayback({ id: camera.id, status })}
          >
            {isLive && showDetections && (
              <CameraAnnotations
                cameraId={camera.id}
                people={personDetections}
                height={overlayHeight}
              />
            )}
          </CameraStreamViewport>
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
