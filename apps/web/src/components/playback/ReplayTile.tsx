'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import type { PlaybackCamera, RecordingDay, RecordingSegment } from '@/types';
import { nextRecording } from '@/lib/recording-sessions';
import { recordingTime } from '@/lib/playback-client';
import { PlaybackPlayer } from './PlaybackPlayer';
import styles from './playback.module.css';
export interface ReplayCommand {
  cameraId: string;
  startAt: string;
  nonce: number;
}
interface Props {
  camera: PlaybackCamera;
  day?: RecordingDay;
  primary: boolean;
  command: ReplayCommand | null;
  onActive: (cameraId: string, start: string) => void;
  error?: string;
}
export function ReplayTile({ camera, day, primary, command, onActive, error }: Props) {
  const consumed = useRef(0);
  const [active, setActive] = useState<{
      segment: RecordingSegment;
      seek: number;
      nonce: number;
      play: boolean;
    } | null>(null),
    [gap, setGap] = useState('');
  const select = useCallback(
    (segment: RecordingSegment, seek = 0, play = false) => {
      setActive((old) => ({ segment, seek, nonce: (old?.nonce ?? 0) + 1, play }));
      setGap('');
      if (primary)
        onActive(camera.id, new Date(Date.parse(segment.startAt) + seek * 1000).toISOString());
    },
    [primary, onActive, camera.id],
  );
  useEffect(() => {
    if (!active && day?.segments[0]) select(day.segments[0]);
  }, [day, active, select]);
  useEffect(() => {
    if (command?.cameraId !== camera.id || !day || command.nonce === consumed.current) return;
    consumed.current = command.nonce;
    const segment = day.segments.find(
      (item) =>
        Date.parse(item.startAt) <= Date.parse(command.startAt) &&
        Date.parse(item.endAt) > Date.parse(command.startAt),
    );
    if (segment)
      select(segment, (Date.parse(command.startAt) - Date.parse(segment.startAt)) / 1000, true);
  }, [command, camera.id, day, select]);
  useEffect(() => {
    if (primary && active)
      onActive(
        camera.id,
        new Date(Date.parse(active.segment.startAt) + active.seek * 1000).toISOString(),
      );
  }, [primary, active, camera.id, onActive]);
  const next = active ? nextRecording(day?.segments ?? [], active.segment) : null;
  const index = active
    ? (day?.segments.findIndex((item) => item.startAt === active.segment.startAt) ?? -1)
    : -1;
  const previous = index > 0 ? day?.segments[index - 1] : null;
  const ended = () => {
    if (next?.contiguous) select(next.segment, next.seekSeconds, true);
    else
      setGap(
        next
          ? 'Không có dữ liệu đến ' + recordingTime(next.segment.startAt, camera.timeZone)
          : 'Đã đến cuối bản ghi hiện có. Danh sách sẽ tiếp tục tự cập nhật.',
      );
  };
  return (
    <div className={styles.replayTile} data-primary={primary}>
      <PlaybackPlayer
        cameraId={camera.id}
        cameraName={camera.name}
        timeZone={camera.timeZone}
        segment={active?.segment ?? null}
        seek={{ seconds: active?.seek ?? 0, nonce: active?.nonce ?? 0 }}
        autoPlay={active?.play ?? false}
        onEnded={ended}
        onPrevious={() => {
          if (previous) select(previous, 0, true);
        }}
        onNext={() => {
          if (next) select(next.segment, next.seekSeconds, true);
        }}
        hasPrevious={Boolean(previous)}
        hasNext={Boolean(next)}
      />
      {(gap || error) && (
        <p role="status" className={styles.gapNotice}>
          {gap || error}
        </p>
      )}
    </div>
  );
}
