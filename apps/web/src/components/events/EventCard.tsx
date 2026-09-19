'use client';

import type { UIEventItem } from '@/types';
import { formatExactTime } from '@/lib/format';
import styles from './event-card.module.css';

interface EventCardProps {
  event: UIEventItem;
  onViewDetail: (event: UIEventItem) => void;
}

const EVENT_TITLES: Record<string, string> = {
  FIRE_SMOKE_DETECTED: 'Phát hiện dấu hiệu cháy hoặc khói',
  FALL_DETECTED: 'Phát hiện dấu hiệu té ngã',
  UNKNOWN_PERSON: 'Phát hiện người chưa xác định',
  RESTRICTED_ZONE: 'Có người vào khu vực giới hạn',
  PERSON_DETECTED: 'Phát hiện người',
  WELLNESS_TIMEOUT: 'Chưa ghi nhận hoạt động',
};

function EventThumbnail({ event }: { event: UIEventItem }) {
  let aiTagClass = styles.aiTagNeutral;
  if (event.aiTagColor === 'danger') aiTagClass = styles.aiTagDanger;
  if (event.aiTagColor === 'warning') aiTagClass = styles.aiTagWarning;
  if (event.aiTagColor === 'info') aiTagClass = styles.aiTagInfo;
  if (event.aiTagColor === 'success') aiTagClass = styles.aiTagSuccess;

  return (
    <div className={styles.thumbnail} aria-hidden="true">
      <div className={styles.thumbBackground}>
        {event.eventType === 'FIRE_SMOKE_DETECTED' ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
          </svg>
        ) : event.eventType === 'FALL_DETECTED' ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <path d="M12 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" />
            <path d="M4 19l4-6 4 2 6-4" />
            <path d="M9 13l2 8" />
          </svg>
        ) : event.eventType === 'UNKNOWN_PERSON' || event.eventType === 'PERSON_DETECTED' ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <circle cx="12" cy="7" r="4" />
            <path d="M6 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <rect x="2" y="3" width="20" height="14" rx="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
          </svg>
        )}
      </div>
      <span className={styles.camCodeTag}>{event.cameraCode}</span>
      <span className={`${styles.aiTag} ${aiTagClass}`}>{event.aiTag}</span>
    </div>
  );
}

export function EventCard({ event, onViewDetail }: EventCardProps) {
  const isResolved = event.status === 'RESOLVED';
  const isP0 = event.priority === 'P0';
  const isP1 = event.priority === 'P1';
  const isP2 = event.priority === 'P2';

  const accentClass = isResolved
    ? styles.accentSuccess
    : isP0
      ? styles.accentP0
      : isP1
        ? styles.accentP1
        : isP2
          ? styles.accentP2
          : styles.accentNeutral;

  const actionButtonClass = isResolved
    ? styles.actionButtonOutline
    : isP0
      ? styles.actionButtonP0
      : isP1 || isP2
        ? styles.actionButtonPrimary
        : styles.actionButtonOutline;

  const actionLabel = isResolved ? 'Xem lại' : 'Xem chi tiết';
  const title = EVENT_TITLES[event.eventType] ?? 'Sự kiện camera';

  return (
    <article className={`${styles.card} ${accentClass}`}>
      <div className={styles.leftGroup}>
        <EventThumbnail event={event} />

        <div className={styles.infoContent}>
          <div className={styles.metaRow}>
            {isResolved ? (
              <span className={`${styles.priorityBadge} ${styles.priorityBadgeSuccess}`}>
                ✅ Đã xác nhận an toàn
              </span>
            ) : isP0 ? (
              <span className={`${styles.priorityBadge} ${styles.priorityBadgeP0}`}>
                🔥 P0 Khẩn cấp
              </span>
            ) : isP1 ? (
              <span className={`${styles.priorityBadge} ${styles.priorityBadgeP1}`}>
                ⚠️ P1 Quan trọng
              </span>
            ) : isP2 ? (
              <span className={`${styles.priorityBadge} ${styles.priorityBadgeP2}`}>
                P2 Cần chú ý
              </span>
            ) : (
              <span className={`${styles.priorityBadge} ${styles.priorityBadgeNeutral}`}>
                Thông tin
              </span>
            )}

            {!isResolved && isP1 && event.eventType === 'FALL_DETECTED' && (
              <span className={`${styles.statusBadge} ${styles.statusBadgeAlert}`}>
                Cần xử lý ngay
              </span>
            )}
            {!isResolved && event.status === 'NOTIFIED' && (
              <span className={styles.statusBadge}>Đã gửi cảnh báo</span>
            )}
            {!isResolved && event.status === 'LOGGED_ONLY' && (
              <span className={styles.statusBadge}>Đã ghi nhận</span>
            )}

            <span className={styles.timeText} title={formatExactTime(event.detectedAt)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              <span>{event.relativeTimeText}</span>
            </span>
          </div>

          <h3 className={styles.eventTitle}>{title}</h3>

          <p className={styles.locationLine}>
            <span className={styles.locationCam}>{event.camera?.name || 'Camera'}</span>
            {event.zone?.name && (
              <>
                <span className={styles.locationSeparator}>—</span>
                <span className={styles.locationZone}>{event.zone.name}</span>
              </>
            )}
            {event.note && (
              <>
                <span className={styles.locationSeparator}>•</span>
                <span className={styles.noteText}>{event.note}</span>
              </>
            )}
          </p>
        </div>
      </div>

      <button
        type="button"
        className={`${styles.actionButton} ${actionButtonClass}`}
        onClick={() => onViewDetail(event)}
      >
        {actionLabel}
      </button>
    </article>
  );
}
