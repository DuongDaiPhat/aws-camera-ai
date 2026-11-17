'use client';
import { useMemo, useState, useEffect } from 'react';
import { Film, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react';
import type { RecordingDay } from '@/types';
import { recordingDuration, recordingSessions } from '@/lib/recording-sessions';
import { recordingTime } from '@/lib/playback-client';
import styles from './playback.module.css';
const PAGE_SIZE = 30;
interface Props {
  day?: RecordingDay;
  cameraName: string;
  selectedAt?: string;
  loading: boolean;
  error?: string;
  onChoose: (start: string) => void;
  onRetry: () => void;
}
export function RecordingList({
  day,
  cameraName,
  selectedAt,
  loading,
  error,
  onChoose,
  onRetry,
}: Props) {
  const sessions = useMemo(() => recordingSessions(day?.segments ?? [], day?.timeZone), [day]);
  const [page, setPage] = useState(0);
  const selectedIndex = selectedAt
    ? sessions.findIndex(
        (session) =>
          Date.parse(selectedAt) >= Date.parse(session.startAt) &&
          Date.parse(selectedAt) < Date.parse(session.endAt),
      )
    : -1;
  const selectedPage = selectedIndex < 0 ? -1 : Math.floor(selectedIndex / PAGE_SIZE);
  useEffect(() => {
    if (selectedPage >= 0) setPage(selectedPage);
  }, [selectedAt, selectedPage]);
  const isToday =
    day?.date ===
    new Intl.DateTimeFormat('en-CA', {
      timeZone: day?.timeZone ?? 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  const pages = Math.max(1, Math.ceil(sessions.length / PAGE_SIZE)),
    current = Math.min(page, pages - 1);
  return (
    <aside className={styles.recordings} aria-label="Bản ghi trong ngày">
      <div className={styles.sectionHeading}>
        <h3>
          <Film size={17} />
          Bản ghi trong ngày
        </h3>
        <button className={styles.refreshButton} aria-label="Làm mới bản ghi" onClick={onRetry}>
          <RefreshCw size={15} />
        </button>
      </div>
      <p className={styles.listCamera}>{cameraName || 'Chọn camera'} · Theo giờ ghi hình</p>
      {error && (
        <p role="status" className={styles.notice}>
          {error} Dữ liệu đã tải vẫn được giữ lại.
        </p>
      )}
      {loading ? (
        <p className={styles.empty} role="status">
          Đang tải bản ghi…
        </p>
      ) : !sessions.length ? (
        <div className={styles.empty}>
          <strong>
            {day?.isFutureDate ? 'Ngày này chưa diễn ra' : 'Chưa có bản ghi trong ngày'}
          </strong>
          <p>
            {isToday && day?.sourceStatus === 'no_frames'
              ? 'Nguồn camera chưa gửi hình để ghi lại.'
              : day?.isFutureDate
                ? 'Chọn một ngày trong quá khứ trên lịch phía trên.'
                : isToday
                  ? 'Bản ghi mới sẽ tự xuất hiện sau khi camera lưu xong đoạn video đầu tiên.'
                  : 'Không có video còn được lưu trong ngày đã chọn.'}
          </p>
        </div>
      ) : (
        <div className={styles.clipList}>
          {sessions.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE).map((session) => (
            <button
              className={styles.clipItem}
              key={session.id}
              aria-pressed={Boolean(
                selectedAt &&
                Date.parse(selectedAt) >= Date.parse(session.startAt) &&
                Date.parse(selectedAt) < Date.parse(session.endAt),
              )}
              onClick={() => onChoose(session.startAt)}
            >
              <span className={styles.sessionDot} />
              <span>
                <strong>
                  {recordingTime(session.startAt, day?.timeZone ?? 'Asia/Ho_Chi_Minh')} –{' '}
                  {recordingTime(session.endAt, day?.timeZone ?? 'Asia/Ho_Chi_Minh')}
                </strong>
                <small>
                  {recordingDuration(
                    (Date.parse(session.endAt) - Date.parse(session.startAt)) / 1000,
                  )}{' '}
                  ghi hình liên tục
                </small>
              </span>
            </button>
          ))}
        </div>
      )}
      {pages > 1 && (
        <div className={styles.pager}>
          <button
            aria-label="Bản ghi trước"
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
          >
            <ChevronLeft size={16} />
          </button>
          <span>
            {current + 1}/{pages}
          </span>
          <button
            aria-label="Bản ghi sau"
            disabled={current === pages - 1}
            onClick={() => setPage(current + 1)}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      )}
      <p className={styles.archiveNote}>
        Tự cập nhật mỗi 10 giây. Các khoảng mất tín hiệu được giữ đúng theo thời gian thực tế.
      </p>
    </aside>
  );
}
