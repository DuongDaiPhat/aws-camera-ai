import { useMemo } from 'react';
import { usePlaybackMetadata } from '@/hooks/usePlaybackMetadata';
import { historicalBoxes } from '@/lib/recording-sessions';
import type { RecordingSegment } from '@/types';
import styles from './playback.module.css';
import { PersonBoxLayer } from '@/components/cameras/debug/PersonBoxLayer';
const labels = { person: 'person', fall: 'Té ngã', fire: 'Lửa', smoke: 'Khói' };

export function PlaybackAnnotations({
  cameraId,
  segment,
  position,
  width,
  height,
}: {
  cameraId: string;
  segment: RecordingSegment | null;
  position: number;
  width: number;
  height: number;
}) {
  const { metadata, error } = usePlaybackMetadata(cameraId, segment);
  const at = segment ? Date.parse(segment.startAt) + position * 1000 : 0;
  const boxes = useMemo(() => historicalBoxes(metadata, at), [metadata, at]);
  if (!segment) return null;
  return (
    <div className={styles.annotations} aria-label="Nhận diện trong bản ghi">
      {boxes.length > 0 && (
        <svg
          viewBox={'0 0 1000 ' + (1000 * height) / width}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={boxes.map((box) => labels[box.label]).join(', ')}
        >
          {boxes.map((box, index) => (
            <PersonBoxLayer
              key={index}
              person={box}
              kind={box.label}
              showFootpoint={false}
              height={(1000 * height) / width}
            />
          ))}
        </svg>
      )}
      {(!metadata?.frames.length || error) && (
        <span className={styles.geometryNotice}>
          {error ? 'Chưa tải được dữ liệu nhận diện.' : 'Chưa có dữ liệu nhận diện lịch sử.'}
        </span>
      )}
    </div>
  );
}
