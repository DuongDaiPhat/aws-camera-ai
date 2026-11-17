'use client';
import { useEffect, useRef, useState } from 'react';
import { PlaybackAnnotations } from './PlaybackAnnotations';
import { Film } from 'lucide-react';
import { PlaybackPlayerState } from './PlaybackPlayerState';
import { PlaybackPlayerTools } from './PlaybackPlayerTools';
import { usePlaybackClip } from '@/hooks/usePlaybackArchive';
import { recordingTime } from '@/lib/playback-client';
import type { RecordingSegment } from '@/types';
import styles from './playback.module.css';
interface Props {
  cameraId: string;
  cameraName: string;
  timeZone: string;
  segment: RecordingSegment | null;
  seek: { seconds: number; nonce: number };
  onPrevious: () => void;
  onNext: () => void;
  hasPrevious: boolean;
  hasNext: boolean;
  autoPlay?: boolean;
  onEnded?: () => void;
}
export function PlaybackPlayer({
  cameraId,
  cameraName,
  timeZone,
  segment,
  seek,
  onPrevious,
  onNext,
  hasPrevious,
  hasNext,
  autoPlay,
  onEnded,
}: Props) {
  const clip = usePlaybackClip(cameraId, segment);
  const video = useRef<HTMLVideoElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 1280, height: 720 });
  const [speed, setSpeed] = useState('1'),
    [mediaError, setMediaError] = useState(''),
    [fullscreenError, setFullscreenError] = useState(''),
    [position, setPosition] = useState(0);
  useEffect(() => {
    setMediaError('');
    setPosition(0);
  }, [clip.url]);
  useEffect(() => {
    if (video.current) video.current.playbackRate = Number(speed);
  }, [speed]);
  useEffect(() => {
    if (video.current && video.current.readyState >= 1) video.current.currentTime = seek.seconds;
  }, [seek.seconds, seek.nonce]);
  const clock = segment
    ? recordingTime(new Date(Date.parse(segment.startAt) + position * 1000).toISOString(), timeZone)
    : '--:--:--';
  const enterFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await surface.current?.requestFullscreen();
      setFullscreenError('');
    } catch {
      setFullscreenError('Trình duyệt chưa hỗ trợ toàn màn hình. Bạn có thể dùng nút trên video.');
    }
  };
  return (
    <section className={styles.playerCard} aria-label="Trình phát bản ghi">
      <div className={styles.playerHeading}>
        <span>
          <Film size={15} /> {cameraName}
        </span>
        <span>{clock}</span>
      </div>
      <div ref={surface} className={styles.videoSurface}>
        {clip.url && !mediaError ? (
          <video
            ref={video}
            src={clip.url}
            controls
            muted
            autoPlay={autoPlay}
            onEnded={onEnded}
            onSeeked={() => setPosition(video.current?.currentTime ?? 0)}
            playsInline
            preload="metadata"
            aria-label={'Xem lại ' + cameraName}
            onLoadedMetadata={() => {
              if (video.current) {
                setDimensions({
                  width: video.current.videoWidth || 1280,
                  height: video.current.videoHeight || 720,
                });
                video.current.currentTime = seek.seconds;
                video.current.playbackRate = Number(speed);
              }
            }}
            onTimeUpdate={() => setPosition(video.current?.currentTime ?? 0)}
            onError={() =>
              setMediaError(
                'Không phát được video này. Hãy thử tải lại hoặc dùng trình duyệt hỗ trợ MP4.',
              )
            }
          />
        ) : (
          <PlaybackPlayerState
            loading={clip.loading}
            error={clip.error || mediaError}
            onRetry={() => {
              setMediaError('');
              clip.retry();
            }}
          />
        )}
        {clip.url && !mediaError && (
          <PlaybackAnnotations
            cameraId={cameraId}
            segment={segment}
            position={position}
            width={dimensions.width}
            height={dimensions.height}
          />
        )}
      </div>
      <PlaybackPlayerTools
        speed={speed}
        onSpeed={setSpeed}
        onFullscreen={() => void enterFullscreen()}
        hasPrevious={hasPrevious}
        hasNext={hasNext}
        onPrevious={onPrevious}
        onNext={onNext}
      />
      {fullscreenError && (
        <p role="status" className={styles.hint}>
          {fullscreenError}
        </p>
      )}
    </section>
  );
}
