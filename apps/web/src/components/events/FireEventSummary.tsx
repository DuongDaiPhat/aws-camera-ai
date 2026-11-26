import type { EventDetail, UIEventItem } from '@/types';
import { formatExactTime } from '@/lib/format';
import { CameraLensFluentIcon, ClockFluentIcon, ZonePinFluentIcon } from './FireAlertIcons';
import styles from './event-detail-modal.module.css';

function statusTone(status: UIEventItem['status']): string {
  if (status === 'ESCALATED') return styles.badgeDanger;
  if (status === 'NOTIFIED' || status === 'DETECTED') return styles.badgeWarning;
  if (status === 'RESOLVED') return styles.badgeSuccess;
  return styles.badgeNeutral;
}

export function FireEventSummary({
  event,
  detail,
  statusLabel,
}: {
  event: UIEventItem;
  detail: EventDetail | null;
  statusLabel: string;
  isSyncing?: boolean;
}) {
  const confidencePercent =
    typeof event.confidence === 'number' ? Math.round(event.confidence * 100) : null;
  const lastUpdate = detail?.statusHistory
    ?.filter((item) => item.toStatus === event.status)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];

  return (
    <section className={styles.fireSummary} aria-label="Thông tin sự kiện">
      <div className={styles.intelHeader}>
        <h3 className={styles.sectionTitle}>Tóm tắt hiện trường</h3>
        <span className={`${styles.inlinePill} ${statusTone(event.status)}`}>{statusLabel}</span>
      </div>

      <dl className={styles.summaryFields}>
        <div className={styles.summaryTile}>
          <dt>
            <CameraLensFluentIcon size={15} />
            <span>Camera</span>
          </dt>
          <dd>{event.camera?.name ?? 'Chưa gán camera'}</dd>
        </div>
        <div className={styles.summaryTile}>
          <dt>
            <ZonePinFluentIcon size={15} />
            <span>Khu vực</span>
          </dt>
          <dd>{event.zone?.name ?? 'Chưa gán khu vực'}</dd>
        </div>
        <div className={`${styles.summaryTile} ${styles.summaryTileWide}`}>
          <dt>
            <ClockFluentIcon size={15} />
            <span>Thời điểm phát hiện</span>
          </dt>
          <dd className={styles.timeRowValue}>
            <time dateTime={event.detectedAt}>{formatExactTime(event.detectedAt)}</time>
            {lastUpdate && (
              <span className={styles.updatedSubtle}>
                Cập nhật {formatExactTime(lastUpdate.createdAt)}
                {lastUpdate.actorName ? ` · ${lastUpdate.actorName}` : ''}
              </span>
            )}
          </dd>
        </div>
      </dl>

      <div className={styles.confidenceBox}>
        <div className={styles.confidenceTop}>
          <span className={styles.confidenceLabel}>Độ tin cậy sự kiện</span>
          <strong className={styles.confidenceNumber}>
            {confidencePercent !== null ? `${confidencePercent}%` : 'Đang đồng bộ…'}
          </strong>
        </div>
        <div className={styles.confidenceTrack} aria-hidden="true">
          <div
            className={styles.confidenceFill}
            style={{
              width: `${confidencePercent !== null ? Math.min(100, Math.max(0, confidencePercent)) : 0}%`,
            }}
          />
        </div>
      </div>
    </section>
  );
}
