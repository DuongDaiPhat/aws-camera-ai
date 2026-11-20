'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Cctv, LayoutGrid, RefreshCw, Clock3 } from 'lucide-react';
import { usePlaybackCameras } from '@/hooks/usePlaybackArchive';
import { useRecordingDays } from '@/hooks/useRecordingDays';
import { useCameraLayout } from '@/hooks/useCameraLayout';
import { useArchiveSelection } from '@/hooks/useArchiveSelection';
import { SelectMenu } from '@/components/ui/SelectMenu';
import { localDateKey, recordingTime } from '@/lib/playback-client';
import {
  clampTime,
  HOUR,
  recordingAt,
  recordingCoverage,
  wallTimeToEpoch,
  type TimeRange,
} from '@/lib/playback-timeline';
import { ArchiveChannels } from './ArchiveChannels';
import { ArchiveTimeline } from './ArchiveTimeline';
import { ArchiveTransport } from './ArchiveTransport';
import { ReplayTile, type ReplayCommand } from './ReplayTile';
import { availableCameraLayout, cameraLayoutOptions } from '@/lib/camera-layout';
import styles from './archive-workspace.module.css';

interface Props {
  selectedDate: Date | null;
  userId?: string;
}
export function PlaybackView({ selectedDate, userId }: Props) {
  const [today, setToday] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setToday(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);
  const date = localDateKey(selectedDate ?? today);
  // A date change clears media and cursor, while layout/channel preferences stay per account.
  return <ArchiveWorkspace key={`${userId ?? 'session'}:${date}`} date={date} userId={userId} />;
}

function ArchiveWorkspace({ date, userId }: { date: string; userId?: string }) {
  const [revision, setRevision] = useState(0),
    [focused, setFocused] = useState('');
  const [cursor, setCursor] = useState<number | null>(null),
    [command, setCommand] = useState<ReplayCommand | null>(null);
  const [playing, setPlaying] = useState(false),
    [rate, setRate] = useState(1),
    [notice, setNotice] = useState('');
  const [windowRange, setWindowRange] = useState<TimeRange | null>(null);
  const [from, setFrom] = useState('00:00:00'),
    [to, setTo] = useState('23:59:59');
  const monitor = useRef<HTMLDivElement>(null),
    nonce = useRef(0);
  const catalog = usePlaybackCameras(revision),
    layout = useCameraLayout(userId, 'playback');
  const displayLayout = availableCameraLayout(layout.layout, catalog.cameras.length);
  const requested = displayLayout === 'custom' ? layout.custom : Number(displayLayout);
  const capacity = Math.max(1, Math.min(catalog.cameras.length, requested));
  const [refreshMessage, setRefreshMessage] = useState('');
  const selection = useArchiveSelection(
    catalog.cameras.map((camera) => camera.id),
    capacity,
    userId,
  );
  const selectedKey = selection.selected.join('|');
  const cameras = useMemo(
    () =>
      selectedKey.split('|').flatMap((id) => {
        const camera = catalog.cameras.find((item) => item.id === id);
        return camera ? [camera] : [];
      }),
    [catalog.cameras, selectedKey],
  );
  const activeId = selection.selected.includes(focused) ? focused : (selection.selected[0] ?? '');
  const camera = catalog.cameras.find((item) => item.id === activeId);
  const recordings = useRecordingDays(selection.selected, date);
  const day = recordings.days[activeId];
  const fallbackStart = Date.parse(date + 'T00:00:00Z');
  const bounds = {
    start: day ? Date.parse(day.dayStartAt) : fallbackStart,
    end: day ? Date.parse(day.dayEndAt) : fallbackStart + 24 * HOUR,
  };
  const range = windowRange ?? bounds,
    timeZone = camera?.timeZone ?? 'Asia/Ho_Chi_Minh';
  const coverage = useMemo(() => recordingCoverage(day?.segments ?? []), [day?.segments]);
  const available = cursor !== null && Boolean(recordingAt(day?.segments ?? [], cursor));
  const previous = coverage.filter((item) => item.start < (cursor ?? bounds.start) - 1).at(-1);
  const next = coverage.find((item) => item.start > (cursor ?? bounds.start));
  const seek = useCallback((at: number, id?: string) => {
    if (id) setFocused(id);
    setCursor(at);
    setCommand({ at, nonce: ++nonce.current });
    setNotice('');
  }, []);
  const block = useCallback((message: string) => {
    setPlaying(false);
    setNotice(message);
  }, []);
  const report = useCallback(
    (id: string, at: number) => {
      if (id === activeId) setCursor(at);
    },
    [activeId],
  );
  useEffect(() => {
    if (!selection.ready || !layout.ready || cursor !== null || !day) return;
    if (day.segments.length) seek(Date.parse(day.segments[0].startAt));
  }, [selection.ready, layout.ready, cursor, day, seek]);

  function focus(id: string) {
    if (!selection.selected.includes(id)) {
      selection.setSelected([id, ...selection.selected].slice(0, capacity));
      if (selection.selected.length >= capacity)
        setNotice('Đã chuyển camera được chọn vào màn hình quan sát.');
    }
    setFocused(id);
    if (cursor !== null) seek(cursor, id);
  }
  function toggle(id: string) {
    const exists = selection.selected.includes(id);
    if (!exists && selection.selected.length >= capacity) {
      setNotice(
        `Bố cục đang giới hạn ${capacity} camera. Bỏ chọn một kênh hoặc tăng số khung hiển thị.`,
      );
      return;
    }
    const ids = exists
      ? selection.selected.filter((item) => item !== id)
      : [...selection.selected, id];
    selection.setSelected(ids);
    if (cursor !== null) seek(cursor, ids.includes(activeId) ? activeId : ids[0]);
    if (!ids.length) setPlaying(false);
  }
  function changeCapacity(value: number) {
    const count = Math.max(1, Math.min(catalog.cameras.length, value));
    const ids = [
      ...selection.selected,
      ...catalog.cameras.map((item) => item.id).filter((id) => !selection.selected.includes(id)),
    ].slice(0, count);
    selection.setSelected(ids);
    if (cursor !== null) seek(cursor, ids.includes(activeId) ? activeId : ids[0]);
  }
  function applyWindow() {
    if (!day) {
      setNotice('Chờ tải dữ liệu camera trước khi chọn khoảng thời gian.');
      return;
    }
    const start = wallTimeToEpoch(from, bounds, timeZone),
      end = wallTimeToEpoch(to, bounds, timeZone);
    if (start === null || end === null || end <= start) {
      setNotice('Giờ kết thúc phải sau giờ bắt đầu và nằm trong ngày đang chọn.');
      return;
    }
    setWindowRange({ start, end: end + 1000 });
    const first = coverage.find((item) => item.end > start && item.start <= end);
    seek(first ? Math.max(start, first.start) : start);
  }
  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (monitor.current?.requestFullscreen) await monitor.current.requestFullscreen();
      else setNotice('Trình duyệt này chưa hỗ trợ chế độ toàn màn hình.');
    } catch {
      setNotice('Không thể mở toàn màn hình. Bạn có thể thử lại từ trình duyệt.');
    }
  }
  const clock = cursor === null ? '—:—:—' : recordingTime(new Date(cursor).toISOString(), timeZone);
  const columns = cameras.length <= 1 ? 1 : cameras.length <= 4 ? 2 : 3;
  const messages = [catalog.cameraError, layout.saveError, selection.saveError, notice].filter(
    Boolean,
  );
  return (
    <div className={styles.workspace}>
      <ArchiveChannels
        cameras={catalog.cameras}
        selected={selection.selected}
        activeId={activeId}
        onToggle={toggle}
        onFocus={focus}
        from={from}
        to={to}
        onFrom={setFrom}
        onTo={setTo}
        onApply={applyWindow}
        onReset={() => {
          setWindowRange(null);
          setFrom('00:00:00');
          setTo('23:59:59');
        }}
        timeZone={timeZone}
      />
      <div className={styles.observation}>
        <div className={styles.toolbar}>
          <div className={styles.activeChannel}>
            <Cctv size={17} aria-hidden="true" />
            <div>
              <strong>{camera?.name ?? 'Chọn kênh camera'}</strong>
              <small>{cameras.length} kênh đang chọn · Cùng thời điểm quan sát</small>
            </div>
          </div>
          <div className={styles.toolbarActions}>
            <button
              className={styles.refresh}
              type="button"
              aria-label="Cập nhật dữ liệu bản ghi"
              title="Tải lại bản ghi mới nhất"
              disabled={recordings.isRefreshing || !cameras.length}
              aria-busy={recordings.isRefreshing}
              onClick={async () => {
                setRefreshMessage('Đang cập nhật bản ghi…');
                const success = await recordings.retry();
                setRefreshMessage(
                  success
                    ? 'Đã cập nhật bản ghi lúc ' +
                        new Date().toLocaleTimeString('vi-VN', { hour12: false }) +
                        '.'
                    : 'Không cập nhật được bản ghi. Dữ liệu đã tải vẫn được giữ lại; hãy thử lại.',
                );
              }}
            >
              <RefreshCw size={16} />
            </button>
            <SelectMenu
              label="Số camera xem lại"
              value={displayLayout}
              visibleOptions={6}
              disabled={!layout.ready || catalog.camerasLoading}
              icon={<LayoutGrid size={15} />}
              options={cameraLayoutOptions(catalog.cameras.length)}
              onChange={(value) => {
                layout.setLayout(value);
                changeCapacity(value === 'custom' ? layout.custom : Number(value));
              }}
            />
            {layout.layout === 'custom' && (
              <input
                className={styles.customCount}
                type="number"
                min={1}
                max={Math.max(1, catalog.cameras.length)}
                value={Math.min(Math.max(1, catalog.cameras.length), layout.custom)}
                aria-label="Số camera xem lại tùy chỉnh"
                onChange={(event) => {
                  const count = Number(event.target.value);
                  if (
                    Number.isInteger(count) &&
                    count >= 1 &&
                    count <= Math.max(1, catalog.cameras.length)
                  ) {
                    layout.setCustom(count);
                    changeCapacity(count);
                  }
                }}
              />
            )}
          </div>
        </div>
        <div
          className={styles.monitor}
          ref={monitor}
          role="region"
          aria-label="Màn hình xem lại camera"
        >
          {(messages.length > 0 || refreshMessage) && (
            <div className={styles.monitorNotice} role="status">
              {messages.length ? messages.join(' ') : refreshMessage}
              {catalog.cameraError && (
                <button type="button" onClick={() => setRevision((value) => value + 1)}>
                  Thử lại
                </button>
              )}
            </div>
          )}
          <div className={styles.monitorInfo}>
            <span>
              <Clock3 size={13} />
              {playing ? 'ĐANG XEM LẠI' : 'XEM LẠI THEO THỜI GIAN'}
            </span>
            <time>{clock}</time>
            <span>{timeZone.replaceAll('_', ' ')}</span>
          </div>
          <div
            className={styles.videoGrid}
            data-count={cameras.length}
            style={{
              gridTemplateColumns: `repeat(${columns},minmax(0,1fr))`,
              gridTemplateRows: `repeat(${Math.max(1, Math.ceil(cameras.length / columns))},minmax(0,1fr))`,
            }}
          >
            {cameras.map((item) => (
              <ReplayTile
                key={item.id}
                camera={item}
                day={recordings.days[item.id]}
                primary={item.id === activeId}
                command={command}
                cursor={cursor}
                playing={playing}
                rate={rate}
                onPosition={report}
                onBlocked={block}
                onFocus={focus}
                error={recordings.errors[item.id]}
              />
            ))}
            {!cameras.length && (
              <div className={styles.noChannels}>
                <Cctv size={38} />
                <strong>
                  {catalog.camerasLoading
                    ? 'Đang tải camera…'
                    : !catalog.cameras.length
                      ? 'Chưa có camera được cấp quyền xem lại'
                      : 'Chọn camera để xem lại'}
                </strong>
                <span>Đánh dấu kênh camera ở bảng bên trái.</span>
              </div>
            )}
          </div>
          <ArchiveTransport
            cursor={cursor}
            playing={playing}
            rate={rate}
            available={available}
            hasPrevious={Boolean(previous)}
            hasNext={Boolean(next)}
            onPlay={() => setPlaying((value) => !value)}
            onStep={(seconds) => seek(clampTime((cursor ?? bounds.start) + seconds * 1000, bounds))}
            onCoverage={(direction) => {
              const target = direction === -1 ? previous : next;
              if (target) seek(target.start);
            }}
            onRate={setRate}
            onFullscreen={() => void fullscreen()}
          />
          <ArchiveTimeline
            cameras={cameras}
            days={recordings.days}
            activeId={activeId}
            bounds={bounds}
            range={range}
            cursor={cursor}
            timeZone={timeZone}
            onRange={setWindowRange}
            onSeek={(at, id) => seek(clampTime(at, bounds), id)}
          />
        </div>
        <div className={styles.workspaceFooter}>
          <span>
            <i data-receiving={day?.sourceStatus === 'receiving'} />
            {day?.sourceStatus === 'receiving'
              ? 'Camera đang ghi · Dữ liệu tự cập nhật mỗi 10 giây'
              : 'Hiển thị các khoảng camera đã ghi được'}
          </span>
          <span>Khoảng trống trên timeline là phần không có dữ liệu.</span>
        </div>
      </div>
    </div>
  );
}
