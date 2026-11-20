'use client';

import React, { useEffect, useRef, useState } from 'react';
import { CameraOff } from 'lucide-react';
import {
  cameraReadKey,
  subscribeCameraRead,
  refreshCameraReadUrl,
  retryCameraRead,
  type LiveStreamSnapshot,
  type LiveStreamStatus,
} from './live/camera-reader';
import styles from './styles/camera-live-stream.module.css';

const VIDEO_WAIT_TIMEOUT_MS = 10000;
const VIDEO_PROGRESS_POLL_MS = 1000;
const EMPTY: LiveStreamSnapshot = { status: 'connecting', stream: null };

interface CameraLiveStreamProps {
  streamUrl: string;
  title: string;
  className?: string;
  interactive?: boolean;
  onStatusChange?: (status: LiveStreamStatus) => void;
}

export function CameraLiveStream({
  streamUrl,
  title,
  className,
  interactive = true,
  onStatusChange,
}: CameraLiveStreamProps) {
  const video = useRef<HTMLVideoElement>(null);
  const notify = useRef(onStatusChange);
  notify.current = onStatusChange;
  const key = cameraReadKey(streamUrl);
  const address = useRef(streamUrl);
  address.current = streamUrl;
  const [read, setRead] = useState({ key: '', snapshot: EMPTY });
  const [playingStream, setPlayingStream] = useState<MediaStream | null>(null);
  const snapshot = read.key === key ? read.snapshot : EMPTY;
  const status =
    snapshot.status === 'live' && playingStream !== snapshot.stream
      ? 'connecting'
      : snapshot.status;

  useEffect(
    () => subscribeCameraRead(address.current, (snapshot) => setRead({ key, snapshot })),
    [key],
  );
  useEffect(() => refreshCameraReadUrl(streamUrl), [streamUrl]);
  useEffect(() => {
    const node = video.current;
    if (!node) return;
    node.srcObject = snapshot.stream;
    return () => {
      node.srcObject = null;
    };
  }, [snapshot.stream]);
  useEffect(() => {
    notify.current?.(status);
  }, [status]);
  useEffect(() => {
    if (status !== 'connecting' || !snapshot.stream) return;
    const timeout = setTimeout(() => retryCameraRead(streamUrl), VIDEO_WAIT_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [status, snapshot.stream, streamUrl]);
  useEffect(() => {
    if (!snapshot.stream) return;
    const node = video.current;
    let lastTime = video.current?.currentTime ?? 0;
    let lastProgressAt = Date.now();
    let frame: number | undefined;
    const hasFrameCallback = Boolean(node?.requestVideoFrameCallback);
    const decoded = () => {
      lastProgressAt = Date.now();
      frame = node?.requestVideoFrameCallback(decoded);
    };
    if (hasFrameCallback) frame = node!.requestVideoFrameCallback(decoded);
    const interval = setInterval(() => {
      // Background tabs may suspend frame callbacks without losing the transport.
      if (document.hidden) {
        lastProgressAt = Date.now();
        return;
      }
      const currentTime = video.current?.currentTime ?? 0;
      if (!hasFrameCallback && currentTime !== lastTime) {
        lastTime = currentTime;
        lastProgressAt = Date.now();
      }
      if (Date.now() - lastProgressAt >= VIDEO_WAIT_TIMEOUT_MS) retryCameraRead(address.current);
    }, VIDEO_PROGRESS_POLL_MS);
    return () => {
      clearInterval(interval);
      if (frame !== undefined) node?.cancelVideoFrameCallback(frame);
    };
  }, [snapshot.stream]);

  return (
    <div className={`${styles.player} ${className ?? ''}`} data-stream-status={status}>
      <video
        ref={video}
        autoPlay
        muted
        playsInline
        controls={interactive}
        controlsList="nofullscreen"
        disablePictureInPicture
        aria-label={`Luồng trực tiếp ${title}`}
        onPlaying={() => setPlayingStream(snapshot.stream)}
        onWaiting={() => setPlayingStream(null)}
        onStalled={() => setPlayingStream(null)}
        onError={() => {
          setPlayingStream(null);
          retryCameraRead(streamUrl);
        }}
      />
      {status !== 'live' && (
        <div className={styles.state} role="status">
          <CameraOff aria-hidden="true" />
          <strong>
            {status === 'unsupported'
              ? 'Trình duyệt chưa hỗ trợ xem trực tiếp'
              : status === 'unavailable'
                ? 'Chưa nhận được tín hiệu camera'
                : 'Đang kết nối camera…'}
          </strong>
          <span>
            {status === 'unsupported'
              ? 'Hãy sử dụng trình duyệt có hỗ trợ WebRTC.'
              : status === 'unavailable'
                ? 'Bật nguồn phát hoặc kiểm tra kết nối. Hệ thống sẽ tự thử lại.'
                : 'Đang chờ hình ảnh từ nguồn phát.'}
          </span>
        </div>
      )}
    </div>
  );
}
