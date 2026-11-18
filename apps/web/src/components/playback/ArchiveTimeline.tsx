'use client';
import { memo, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, ZoomIn } from 'lucide-react';
import type { PlaybackCamera, RecordingDay } from '@/types';
import { recordingTime } from '@/lib/playback-client';
import {
  clampTime,
  HOUR,
  recordingCoverage,
  timelinePercent,
  zoomRange,
  type TimeRange,
} from '@/lib/playback-timeline';
import styles from './archive-workspace.module.css';

interface Props {
  cameras: PlaybackCamera[];
  days: Record<string, RecordingDay>;
  activeId: string;
  bounds: TimeRange;
  range: TimeRange;
  cursor: number | null;
  timeZone: string;
  onRange: (range: TimeRange) => void;
  onSeek: (at: number, cameraId?: string) => void;
}
export function ArchiveTimeline({
  cameras,
  days,
  activeId,
  bounds,
  range,
  cursor,
  timeZone,
  onRange,
  onSeek,
}: Props) {
  const spans = [
    { label: 'Cả ngày', value: bounds.end - bounds.start },
    { label: '6 giờ', value: 6 * HOUR },
    { label: '1 giờ', value: HOUR },
    { label: '15 phút', value: HOUR / 4 },
  ];
  const span = range.end - range.start;
  const ticks = Array.from({ length: 7 }, (_, index) => range.start + (span * index) / 6);
  const format = (at: number) => recordingTime(new Date(at).toISOString(), timeZone).slice(0, 5);
  return (
    <section className={styles.timeline} aria-label="Dòng thời gian bản ghi">
      <div className={styles.timelineToolbar}>
        <span className={styles.legend}>
          <i />
          Có bản ghi <span className={styles.missingKey} />
          Không có dữ liệu
        </span>
        <div className={styles.zoomControls} aria-label="Thu phóng thời gian">
          <ZoomIn size={14} aria-hidden="true" />
          {spans.map((item) => (
            <button
              key={item.label}
              type="button"
              aria-pressed={Math.abs(span - item.value) < 1}
              onClick={() => onRange(zoomRange(bounds, cursor ?? range.start, item.value))}
            >
              {item.label}
            </button>
          ))}
          <button
            type="button"
            aria-label="Khoảng thời gian trước"
            disabled={range.start <= bounds.start}
            onClick={() => onRange(zoomRange(bounds, range.start, span))}
          >
            <ChevronLeft size={15} />
          </button>
          <button
            type="button"
            aria-label="Khoảng thời gian sau"
            disabled={range.end >= bounds.end}
            onClick={() => onRange(zoomRange(bounds, range.end, span))}
          >
            <ChevronRight size={15} />
          </button>
        </div>
      </div>
      <div className={styles.ruler} aria-hidden="true">
        <span />
        <div>
          {ticks.map((at, index) => (
            <span key={at} style={{ left: `${(index * 100) / 6}%` }}>
              {index === 6 && at === bounds.end ? '24:00' : format(at)}
            </span>
          ))}
        </div>
      </div>
      <div className={styles.timelineRows}>
        {cameras.map((camera) => (
          <TimelineRow
            key={camera.id}
            camera={camera}
            day={days[camera.id]}
            active={camera.id === activeId}
            range={range}
            cursor={cursor}
            onSeek={onSeek}
          />
        ))}
      </div>
      <p className={styles.timelineHint}>
        Bấm hoặc kéo để chọn thời điểm · Phím ← → dịch 10 giây · Ngày được chọn trên lịch phía trên.
      </p>
    </section>
  );
}

const TimelineRow = memo(function TimelineRow({
  camera,
  day,
  active,
  range,
  cursor,
  onSeek,
}: {
  camera: PlaybackCamera;
  day?: RecordingDay;
  active: boolean;
  range: TimeRange;
  cursor: number | null;
  onSeek: Props['onSeek'];
}) {
  const [preview, setPreview] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const coverage = useMemo(() => recordingCoverage(day?.segments ?? []), [day?.segments]);
  const at = preview ?? cursor ?? range.start;
  const clock = recordingTime(new Date(at).toISOString(), camera.timeZone);
  function pointerAt(event: React.PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return clampTime(
      range.start +
        ((event.clientX - rect.left) / Math.max(1, rect.width)) * (range.end - range.start),
      range,
    );
  }
  return (
    <div className={styles.timelineRow} data-active={active}>
      <span className={styles.channelLabel} title={camera.name}>
        {camera.name}
      </span>
      <div
        className={styles.track}
        role="slider"
        tabIndex={0}
        aria-label={`Thời điểm ${camera.name}`}
        aria-valuemin={Math.floor(range.start / 1000)}
        aria-valuemax={Math.floor((range.end - 1) / 1000)}
        aria-valuenow={Math.floor(clampTime(at, range) / 1000)}
        aria-valuetext={`${clock}, ${coverage.some((item) => item.start <= at && at < item.end) ? 'có bản ghi' : 'không có dữ liệu'}`}
        onKeyDown={(event) => {
          let next: number | null = null;
          if (event.key === 'ArrowLeft') next = at - (event.shiftKey ? 60000 : 10000);
          if (event.key === 'ArrowRight') next = at + (event.shiftKey ? 60000 : 10000);
          if (event.key === 'Home') next = range.start;
          if (event.key === 'End') next = range.end - 1;
          if (next !== null) {
            event.preventDefault();
            onSeek(clampTime(next, range), camera.id);
          }
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging(true);
          setPreview(pointerAt(event));
        }}
        onPointerMove={(event) => {
          if (dragging) setPreview(pointerAt(event));
        }}
        onPointerUp={(event) => {
          if (!dragging) return;
          const next = pointerAt(event);
          setDragging(false);
          setPreview(null);
          event.currentTarget.releasePointerCapture(event.pointerId);
          onSeek(next, camera.id);
        }}
        onPointerCancel={() => {
          setDragging(false);
          setPreview(null);
        }}
      >
        {coverage
          .filter((item) => item.end > range.start && item.start < range.end)
          .map((item) => {
            const left = timelinePercent(item.start, range),
              right = timelinePercent(item.end, range);
            return (
              <span
                key={item.start}
                className={styles.coverage}
                style={{ left: `${left}%`, width: `${right - left}%` }}
              />
            );
          })}
        {!day && <span className={styles.trackEmpty}>Đang tải…</span>}
        {day && !coverage.length && <span className={styles.trackEmpty}>Không có bản ghi</span>}
        {at >= range.start && at < range.end && (
          <span className={styles.playhead} style={{ left: `${timelinePercent(at, range)}%` }}>
            {(active || dragging) && <span>{clock}</span>}
          </span>
        )}
      </div>
    </div>
  );
});
