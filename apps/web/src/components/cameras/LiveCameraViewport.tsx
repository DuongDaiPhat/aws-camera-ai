'use client';

import { useEffect, useRef, useState } from 'react';
import type { Camera } from '@/types';
import { Icon } from '@/components/ui/Icon';
import { CameraStreamViewport } from './CameraStreamViewport';
import { CameraAnnotations } from './CameraAnnotations';
import { useCameraDebugStream } from './live/use-camera-debug-stream';
import { useLivePersonDetections } from './live/use-live-person-detections';
import { useWebcamSession } from './source/webcam-session-manager';
import { hasLiveSource } from './live/live-stream-state';
import type { LiveStreamStatus } from './live/camera-reader';
import styles from './styles/live-camera-viewport.module.css';

export function LiveCameraViewport({
  camera,
  compact = false,
  paused = false,
  onStatusChange,
}: {
  camera: Camera;
  compact?: boolean;
  paused?: boolean;
  onStatusChange?: (status: LiveStreamStatus) => void;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (!surface.current || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) =>
      setVisible(Boolean(entries[0]?.isIntersecting)),
    );
    observer.observe(surface.current);
    return () => observer.disconnect();
  }, []);
  const session = useWebcamSession(camera.id);
  const active =
    !paused &&
    visible &&
    camera.isEnabled &&
    (camera.runtimeStatus === 'ONLINE' ||
      camera.runtimeStatus === 'STARTING' ||
      session.isPublishing);
  const { data, error } = useCameraDebugStream(camera.id, active);
  const canRead = active && Boolean(data?.streamUrl) && hasLiveSource(camera, session.isPublishing);
  const notify = useRef(onStatusChange);
  notify.current = onStatusChange;
  useEffect(() => {
    if (!canRead) notify.current?.(active && !error ? 'connecting' : 'unavailable');
  }, [canRead, active, error, camera.id]);
  const people = useLivePersonDetections(
    data,
    camera.id,
    active && camera.detectionEnabled !== false,
    camera.sourceType,
  );
  const height = (1000 * (camera.detectHeight || 720)) / (camera.detectWidth || 1280);
  return (
    <div
      ref={surface}
      className={styles.surface}
      data-compact={compact}
      data-live-camera={camera.id}
    >
      {canRead && data?.streamUrl ? (
        <CameraStreamViewport
          streamUrl={data.streamUrl}
          title={camera.name}
          width={camera.detectWidth || 1280}
          height={camera.detectHeight || 720}
          onStatusChange={onStatusChange}
        >
          <CameraAnnotations cameraId={camera.id} people={people} height={height} />
        </CameraStreamViewport>
      ) : (
        <div className={styles.placeholder} role="status">
          <Icon name="camera" size={compact ? 24 : 38} />
          <strong>
            {!camera.isEnabled
              ? 'Camera đang tắt'
              : error || camera.runtimeStatus === 'OFFLINE' || camera.runtimeStatus === 'FAILED'
                ? 'Chưa kết nối được camera'
                : 'Đang chờ luồng camera'}
          </strong>
          {!compact && <span>Hình ảnh sẽ xuất hiện khi nguồn phát sẵn sàng.</span>}
        </div>
      )}
    </div>
  );
}
