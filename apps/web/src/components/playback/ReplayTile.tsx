'use client';
import { useEffect, useState, useRef, useCallback } from 'react';
import type { PlaybackCamera, RecordingDay, RecordingSegment } from '@/types';
import { nextRecording } from '@/lib/recording-sessions';
import { recordingTime } from '@/lib/playback-client';
import { recordingCoverage, recordingAt } from '@/lib/playback-timeline';
import { PlaybackPlayer } from './PlaybackPlayer';
import styles from './archive-workspace.module.css';

export interface ReplayCommand {
  at: number;
  nonce: number;
}
interface Props {
  camera: PlaybackCamera;
  day?: RecordingDay;
  primary: boolean;
  command: ReplayCommand | null;
  cursor: number | null;
  playing: boolean;
  rate: number;
  onPosition: (id: string, at: number) => void;
  onBlocked: (message: string) => void;
  onFocus: (id: string) => void;
  error?: string;
}
export function ReplayTile({
  camera,
  day,
  primary,
  command,
  cursor,
  playing,
  rate,
  onPosition,
  onBlocked,
  onFocus,
  error,
}: Props) {
  const consumed = useRef(0);
  const [active, setActive] = useState<{
    segment: RecordingSegment;
    seek: number;
    nonce: number;
  } | null>(null);
  const [gap, setGap] = useState('');
  const [waiting, setWaiting] = useState(false);
  const sequence = useRef(0);
  const select = useCallback((segment: RecordingSegment | null, at: number) => {
    setActive(
      segment
        ? {
            segment,
            seek: Math.max(0, (at - Date.parse(segment.startAt)) / 1000),
            nonce: ++sequence.current,
          }
        : null,
    );
    setGap(segment ? '' : 'Không có bản ghi tại thời điểm này');
    setWaiting(false);
  }, []);
  useEffect(() => {
    if (!command || !day || consumed.current === command.nonce) return;
    consumed.current = command.nonce;
    const segment = recordingAt(day.segments, command.at);
    select(segment, command.at);
    if (!segment && primary)
      onBlocked('Không có bản ghi tại thời điểm này. Chọn vùng có dữ liệu trên timeline.');
  }, [command, day, select, primary, onBlocked]);
  useEffect(() => {
    if (primary || cursor === null || !day || !command || consumed.current !== command.nonce)
      return;
    const segment = recordingAt(day.segments, cursor);
    if (segment?.id !== active?.segment.id) select(segment, cursor);
  }, [primary, cursor, day, active?.segment.id, command, select]);
  const next = active ? nextRecording(day?.segments ?? [], active.segment) : null;
  useEffect(() => {
    if (waiting && next?.contiguous && playing)
      select(next.segment, Date.parse(next.segment.startAt) + next.seekSeconds * 1000);
  }, [
    waiting,
    next?.segment.startAt,
    next?.segment.endAt,
    next?.seekSeconds,
    next?.contiguous,
    playing,
    select,
  ]);
  function ended() {
    // Secondary channels follow the primary clock instead of racing into the next clip.
    if (!primary) return;
    if (next?.contiguous) {
      select(next.segment, Date.parse(next.segment.startAt) + next.seekSeconds * 1000);
      return;
    }
    const message = next
      ? `Mất dữ liệu đến ${recordingTime(next.segment.startAt, camera.timeZone)}. Chọn khoảng có dữ liệu tiếp theo.`
      : day?.sourceStatus === 'receiving'
        ? 'Đã đến cuối dữ liệu hiện có. Đang chờ camera lưu thêm hình ảnh…'
        : 'Đã đến cuối dữ liệu của camera trong ngày này.';
    setGap(message);
    setWaiting(!next && day?.sourceStatus === 'receiving');
    if (primary && (next || day?.sourceStatus !== 'receiving')) onBlocked(message);
  }
  // Counting coverage does not invent recordings for disabled or disconnected cameras.
  const empty = !day
    ? 'Đang tải dữ liệu trong ngày…'
    : day.isFutureDate
      ? 'Ngày này chưa có dữ liệu'
      : !day.recordingEnabled
        ? 'Camera chưa bật lưu bản ghi'
        : !recordingCoverage(day.segments).length
          ? 'Không có dữ liệu trong ngày này'
          : undefined;
  return (
    <div className={styles.tile} data-primary={primary}>
      <button
        className={styles.activateChannel}
        type="button"
        aria-pressed={primary}
        aria-label={`Điều khiển ${camera.name}`}
        onClick={() => onFocus(camera.id)}
      />
      <PlaybackPlayer
        cameraId={camera.id}
        cameraName={camera.name}
        timeZone={camera.timeZone}
        segment={active?.segment ?? null}
        seek={{ seconds: active?.seek ?? 0, nonce: active?.nonce ?? 0 }}
        playing={playing}
        rate={rate}
        followAt={primary ? undefined : cursor}
        emptyMessage={error || empty || gap}
        onEnded={ended}
        onPosition={(at) => {
          if (primary) onPosition(camera.id, at);
        }}
        onPlaybackError={() => {
          if (primary) onBlocked('Chưa thể phát camera đang điều khiển.');
        }}
      />
      {gap && active && (
        <p className={styles.gap} role="status">
          {gap}
        </p>
      )}
      {error && (
        <p className={styles.gap} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
