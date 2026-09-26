'use client';

import React, { useEffect, useMemo, useState } from 'react';
import type { Camera } from '@/types';
import type { CameraDebugStream } from '@/lib/cameras-client';
import { fetchCameraDebugStream } from '@/lib/cameras-client';
import { CameraLiveStream } from './CameraLiveStream';
import { CameraStatusBadge } from './CameraStatusBadge';
import { useWebcamSession } from './source/webcam-session-manager';
import styles from './styles/camera-grid.module.css';

interface PersonDetectionBox {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  confidence: number;
}

function GridTileDetections({ detections }: { detections: PersonDetectionBox[] }) {
  if (detections.length === 0) return null;
  return (
    <svg className={styles.detectionSvgOverlay} viewBox="0 0 1000 562.5" preserveAspectRatio="none">
      {detections.map((p, idx) => {
        const rx = p.x * 1000;
        const ry = p.y * 562.5;
        const rw = p.width * 1000;
        const rh = p.height * 562.5;
        return (
          <g key={`det-${idx}`}>
            <rect
              x={rx}
              y={ry}
              width={rw}
              height={rh}
              fill="rgba(37, 99, 235, 0.15)"
              stroke="#38bdf8"
              strokeWidth="2.5"
              strokeDasharray="4 2"
            />
            <rect
              x={rx}
              y={Math.max(0, ry - 18)}
              width={Math.min(120, rw)}
              height={18}
              fill="#0369a1"
            />
            <text
              x={rx + 4}
              y={Math.max(12, ry - 5)}
              fill="#ffffff"
              fontSize="11"
              fontFamily="monospace"
              fontWeight="bold"
            >
              {p.label} {(p.confidence * 100).toFixed(0)}%
            </text>
          </g>
        );
      })}
    </svg>
  );
}

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
    const loadStream = () => {
      if (!camera.isEnabled) {
        setDebugData(null);
        return;
      }
      fetchCameraDebugStream(camera.id)
        .then((data) => {
          if (!isCancelled) {
            setDebugData(data);
            setHasError(false);
          }
        })
        .catch(() => {
          if (!isCancelled) setHasError(true);
        });
    };

    void loadStream();
    const interval = camera.isEnabled ? setInterval(loadStream, 1000) : null;
    return () => {
      isCancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [camera.id, camera.isEnabled]);

  const personDetections = useMemo(() => {
    if (!showDetections || !debugData?.detections) return [];
    return debugData.detections
      .filter((d) => d.box && d.box.length === 4)
      .map((d) => ({
        x: d.box[1],
        y: d.box[0],
        width: d.box[3] - d.box[1],
        height: d.box[2] - d.box[0],
        label: d.label,
        confidence: d.confidence,
      }));
  }, [showDetections, debugData]);

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

        {isLive && <GridTileDetections detections={personDetections} />}

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
