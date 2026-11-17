import { useMemo } from 'react';
import { usePlaybackMetadata } from '@/hooks/usePlaybackMetadata';
import { historicalBoxes } from '@/lib/recording-sessions';
import type { RecordingSegment } from '@/types';
import styles from './playback.module.css';
const labels = { person: 'Người', fall: 'Té ngã', fire: 'Lửa', smoke: 'Khói' };
const colors = { person: '#6ee7b7', fall: '#fbbf24', fire: '#fb7185', smoke: '#d8b4fe' };
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
          viewBox={'0 0 ' + width + ' ' + height}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={boxes.map((box) => labels[box.label]).join(', ')}
        >
          {boxes.map((box, index) => (
            <g key={index}>
              <rect
                x={box.x * width}
                y={box.y * height}
                width={box.width * width}
                height={box.height * height}
                fill="none"
                stroke={colors[box.label]}
                strokeWidth={width / 450}
              />
              <text
                x={box.x * width}
                y={Math.max(height / 30, box.y * height - height / 100)}
                fill={colors[box.label]}
                fontSize={width / 50}
                stroke="#111"
                strokeWidth={width / 1500}
                paintOrder="stroke"
              >
                {labels[box.label]} {Math.round(box.confidence * 100)}%
              </text>
            </g>
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
