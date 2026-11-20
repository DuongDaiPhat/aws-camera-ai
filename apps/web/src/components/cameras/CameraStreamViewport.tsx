'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Maximize2 } from 'lucide-react';
import { CameraLiveStream } from './CameraLiveStream';
import { cameraReadKey, type LiveStreamStatus } from './live/camera-reader';
import styles from './styles/camera-stream-viewport.module.css';

/** Match video and annotation canvas to the same contained image rectangle. */
export function containCameraFrame(width: number, height: number, aspect: number) {
  const fittedWidth = Math.min(width, height * aspect);
  const fittedHeight = fittedWidth / aspect;
  return {
    width: fittedWidth,
    height: fittedHeight,
    left: (width - fittedWidth) / 2,
    top: (height - fittedHeight) / 2,
  };
}

export function CameraStreamViewport({
  streamUrl,
  title,
  width = 1280,
  height = 720,
  children,
  fullscreen = false,
  onStatusChange,
}: {
  streamUrl: string;
  title: string;
  width?: number;
  height?: number;
  children?: ReactNode;
  fullscreen?: boolean;
  onStatusChange?: (status: LiveStreamStatus) => void;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [fullscreenError, setFullscreenError] = useState(false);
  const [playback, setPlayback] = useState<{ address: string; status: LiveStreamStatus } | null>(
    null,
  );
  const readKey = cameraReadKey(streamUrl);
  const aspect = width > 0 && height > 0 ? width / height : 16 / 9;
  useEffect(() => {
    const node = surface.current;
    if (!node) return;
    const measure = () => {
      const bounds = node.getBoundingClientRect();
      setSize({ width: bounds.width, height: bounds.height });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver((entries) => {
      const bounds = entries[0]?.contentRect;
      if (bounds) setSize({ width: bounds.width, height: bounds.height });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const rectangle =
    size.width > 0 && size.height > 0
      ? containCameraFrame(size.width, size.height, aspect)
      : { inset: 0 };
  return (
    <div ref={surface} className={styles.viewport} data-camera-viewport>
      <div className={styles.image} style={rectangle}>
        <CameraLiveStream
          streamUrl={streamUrl}
          title={title}
          className={styles.stream}
          interactive={false}
          onStatusChange={(status) => {
            setPlayback({ address: readKey, status });
            onStatusChange?.(status);
          }}
        />
        {playback?.address === readKey && playback.status === 'live' && children}
      </div>
      {fullscreen && (
        <button
          type="button"
          className={styles.fullscreen}
          aria-label={`Toàn màn hình ${title}`}
          onClick={async () => {
            try {
              if (document.fullscreenElement) await document.exitFullscreen();
              else if (surface.current?.requestFullscreen)
                await surface.current.requestFullscreen();
              else throw new Error('Fullscreen unavailable');
              setFullscreenError(false);
            } catch {
              setFullscreenError(true);
            }
          }}
        >
          <Maximize2 size={16} />
        </button>
      )}
      {fullscreenError && (
        <span role="status" className={styles.notice}>
          Trình duyệt chưa hỗ trợ toàn màn hình.
        </span>
      )}
    </div>
  );
}
