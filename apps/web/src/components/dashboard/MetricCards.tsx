'use client';

import type { EventStats } from '@/types';
import { formatRelativeTime } from '@/lib/format';
import styles from './metric-cards.module.css';

interface MetricCardsProps {
  stats: EventStats | null;
  isLoading?: boolean;
  error?: string | null;
}

const PLACEHOLDER = '—';

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

/** Mô tả tình trạng camera — không dùng riêng màu để truyền đạt thông tin. */
function getCameraNote(stats: EventStats | null): string {
  if (!stats) return 'Đang đọc trạng thái camera…';
  if (stats.cameraTotalCount === 0) return 'Chưa có camera nào được đăng ký';
  const offline = stats.cameraTotalCount - stats.cameraOnlineCount;
  return offline === 0
    ? 'Tất cả camera hoạt động bình thường'
    : `${offline} camera đang ngoại tuyến`;
}

/** Dòng mô tả cho thẻ "Cần chú ý ngay": lấy đúng sự kiện chưa xử lý gần nhất. */
function getPendingNote(stats: EventStats | null): string {
  if (!stats) return 'Đang đọc số liệu sự kiện…';
  if (stats.pendingCount === 0) return 'Không có sự kiện nào đang chờ bạn xác nhận';

  const pending = stats.latestPendingEvent;
  if (!pending) return 'Có sự kiện đang chờ bạn xác nhận';

  const location = [pending.cameraName, pending.zoneName].filter(Boolean).join(' — ');
  const timeText = pending.detectedAt
    ? formatRelativeTime(pending.detectedAt)
    : 'Chưa rõ thời điểm';
  return `${location || 'Camera chưa đặt tên'} • ${timeText}`;
}

export function MetricCards({ stats, isLoading = false, error = null }: MetricCardsProps) {
  const cameraValue = stats ? `${stats.cameraOnlineCount}/${stats.cameraTotalCount}` : PLACEHOLDER;
  const totalValue = stats ? stats.totalEvents : PLACEHOLDER;
  const pendingValue = stats ? stats.pendingCount : PLACEHOLDER;
  const windowLabel = stats ? `GHI NHẬN ${stats.windowHours} GIỜ QUA` : 'GHI NHẬN 24 GIỜ QUA';
  const personNote = stats
    ? `${stats.personDetectedCount} lần phát hiện người`
    : isLoading
      ? 'Đang tải số liệu…'
      : 'Chưa có số liệu';

  return (
    <>
      {error && (
        <p className={styles.errorNotice} role="alert">
          Không tải được số liệu tổng hợp: {error}
        </p>
      )}

      <div className={styles.grid}>
        {/* Card 1: Thiết bị bảo vệ */}
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>THIẾT BỊ BẢO VỆ</h2>
            <div className={`${styles.iconPill} ${styles.iconPillSuccess}`} aria-hidden="true">
              <CheckIcon />
            </div>
          </div>
          <div>
            <div className={styles.valueRow}>
              <span className={styles.mainValue}>{cameraValue}</span>
              <span className={styles.valueSuffix}>camera trực tuyến</span>
            </div>
            <p className={styles.footerSubtext}>
              <span className={`${styles.dot} ${styles.dotGreen}`} aria-hidden="true" />
              <span>{getCameraNote(stats)}</span>
            </p>
          </div>
        </div>

        {/* Card 2: Ghi nhận trong cửa sổ thống kê */}
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>{windowLabel}</h2>
            <div className={`${styles.iconPill} ${styles.iconPillInfo}`} aria-hidden="true">
              <ClockIcon />
            </div>
          </div>
          <div>
            <div className={styles.valueRow}>
              <span className={styles.mainValue}>{totalValue}</span>
              <span className={styles.valueSuffix}>sự kiện đã phân tích</span>
            </div>
            <p className={styles.footerSubtext}>
              <span className={`${styles.dot} ${styles.dotBlue}`} aria-hidden="true" />
              <span>{personNote}</span>
            </p>
          </div>
        </div>

        {/* Card 3: Cần chú ý ngay */}
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <h2 className={`${styles.cardTitle} ${styles.cardTitleAlert}`}>CẦN CHÚ Ý NGAY</h2>
            <div className={`${styles.iconPill} ${styles.iconPillDanger}`} aria-hidden="true">
              <AlertIcon />
            </div>
          </div>
          <div>
            <div className={styles.valueRow}>
              <span className={`${styles.mainValue} ${styles.mainValueAlert}`}>{pendingValue}</span>
              <span className={styles.valueSuffix}>sự kiện chờ kiểm tra</span>
            </div>
            <p className={styles.footerSubtext}>
              <span className={`${styles.dot} ${styles.dotRed}`} aria-hidden="true" />
              <span>{getPendingNote(stats)}</span>
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
