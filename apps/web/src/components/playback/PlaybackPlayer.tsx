'use client';
import { useEffect, useRef, useState } from 'react';
import { Cctv, Maximize2 } from 'lucide-react';
import { PlaybackAnnotations } from './PlaybackAnnotations';
import { PlaybackPlayerState } from './PlaybackPlayerState';
import { usePlaybackClip } from '@/hooks/usePlaybackArchive';
import { recordingTime } from '@/lib/playback-client';
import type { RecordingSegment } from '@/types';
import styles from './playback.module.css';
import workspace from './archive-workspace.module.css';

interface Props {
  cameraId: string;
  cameraName: string;
  timeZone: string;
  segment: RecordingSegment | null;
  seek: { seconds: number; nonce: number };
  playing: boolean;
  rate: number;
  followAt?: number | null;
  emptyMessage?: string;
  onEnded: () => void;
  onPosition: (at: number) => void;
  onPlaybackError: () => void;
}

export function PlaybackPlayer({
  cameraId,
  cameraName,
  timeZone,
  segment,
  seek,
  playing,
  rate,
  followAt,
  emptyMessage,
  onEnded,
  onPosition,
  onPlaybackError,
}: Props) {
  const clip = usePlaybackClip(cameraId, segment);
  const video = useRef<HTMLVideoElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 1280, height: 720 });
  const [mediaError, setMediaError] = useState('');
  const [position, setPosition] = useState(0);
  const [buffering, setBuffering] = useState(false);
  useEffect(() => {
    setMediaError('');
    setPosition(0);
  }, [clip.url]);
  function play(node: HTMLVideoElement) {
    void node.play().catch((error: unknown) => {
      if (error instanceof Error && error.name === 'AbortError') return;
      setMediaError('Trình duyệt chưa thể phát bản ghi. Hãy nhấn Thử lại.');
      onPlaybackError();
    });
  }
  useEffect(() => {
    const node = video.current;
    if (!node || node.readyState < 1) return;
    node.playbackRate = rate;
    if (playing) play(node);
    else node.pause();
  }, [playing, rate, clip.url]);
  useEffect(() => {
    const node = video.current;
    if (node && node.readyState >= 1) {
      node.currentTime = seek.seconds;
      setPosition(seek.seconds);
      if (playing) play(node);
    }
  }, [seek.nonce, seek.seconds]);
  useEffect(() => {
    const node = video.current;
    if (!node || node.readyState < 1 || !segment || followAt == null) return;
    const offset = (followAt - Date.parse(segment.startAt)) / 1000;
    // Correct obvious drift without repeatedly seeking on every primary video frame.
    if (
      offset >= 0 &&
      offset < segment.durationSeconds &&
      Math.abs(node.currentTime - offset) > 1.5
    )
      node.currentTime = offset;
  }, [followAt, segment]);
  function report() {
    const seconds = video.current?.currentTime ?? 0;
    setPosition(seconds);
    if (segment) onPosition(Date.parse(segment.startAt) + seconds * 1000);
  }
  async function fullscreen() {
    try {
      if (document.fullscreenElement === surface.current) await document.exitFullscreen();
      else if (surface.current?.requestFullscreen) await surface.current.requestFullscreen();
      else throw new Error('Fullscreen unavailable');
    } catch {
      setMediaError('Không thể mở toàn màn hình trên trình duyệt này.');
    }
  }
  const at = segment ? Date.parse(segment.startAt) + position * 1000 : null;
  return (
    <section
      className={`${styles.playerCard} ${workspace.channelVideo}`}
      aria-label={`Bản ghi ${cameraName}`}
    >
      <div className={workspace.videoHeading}>
        <span>
          <Cctv size={14} aria-hidden="true" />
          {cameraName}
        </span>
        <span>{at === null ? '—:—:—' : recordingTime(new Date(at).toISOString(), timeZone)}</span>
      </div>
      <div ref={surface} className={`${styles.videoSurface} ${workspace.channelSurface}`}>
        {clip.url && !mediaError ? (
          <>
            <video
              ref={video}
              src={clip.url}
              muted
              playsInline
              preload="auto"
              aria-label={`Hình ảnh đã ghi của ${cameraName}`}
              onLoadedMetadata={() => {
                const node = video.current;
                if (!node) return;
                setDimensions({ width: node.videoWidth, height: node.videoHeight });
                node.currentTime = seek.seconds;
                node.playbackRate = rate;
                report();
                if (playing) play(node);
              }}
              onTimeUpdate={report}
              onSeeked={report}
              onEnded={onEnded}
              onWaiting={() => setBuffering(true)}
              onPlaying={() => setBuffering(false)}
              onCanPlay={() => setBuffering(false)}
              onError={() => {
                setMediaError('Không thể phát hình ảnh đã ghi. Hãy tải lại bản ghi.');
                onPlaybackError();
              }}
            />
            <PlaybackAnnotations
              cameraId={cameraId}
              segment={segment}
              position={position}
              width={dimensions.width}
              height={dimensions.height}
            />
            {buffering && (
              <span className={workspace.buffering} role="status">
                Đang tải hình…
              </span>
            )}
          </>
        ) : segment || clip.error || mediaError ? (
          <div className={workspace.playerOverlay}>
            <PlaybackPlayerState
              loading={clip.loading}
              error={clip.error || mediaError}
              onRetry={() => {
                setMediaError('');
                clip.retry();
              }}
            />
          </div>
        ) : (
          <div className={`${styles.playerState} ${workspace.playerOverlay}`}>
            <Cctv size={32} aria-hidden="true" />
            <strong>{emptyMessage || 'Không có bản ghi tại thời điểm này'}</strong>
            <p>Chọn vùng có dữ liệu trên thanh thời gian bên dưới.</p>
          </div>
        )}
        <button
          className={workspace.videoExpand}
          type="button"
          aria-label={`Toàn màn hình ${cameraName}`}
          onClick={() => void fullscreen()}
        >
          <Maximize2 size={15} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
