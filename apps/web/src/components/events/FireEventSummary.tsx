import type { EventDetail, UIEventItem } from '@/types';
import { formatExactTime, getPriorityInfo } from '@/lib/format';
import { fireEvidence } from '@/lib/fire-evidence';
import styles from './event-detail-modal.module.css';

export function FireEventSummary({
  event,
  detail,
  statusLabel,
}: {
  event: UIEventItem;
  detail: EventDetail | null;
  statusLabel: string;
}) {
  const evidence = fireEvidence(detail);
  const labels = [...new Set(evidence?.detections.map(() => 'Lửa') ?? [])];
  const lastUpdate = detail?.statusHistory
    ?.filter((item) => item.toStatus === event.status)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
  const fields = [
    { label: 'Camera', value: event.camera?.name ?? 'Chưa gán camera' },
    { label: 'Khu vực', value: event.zone?.name ?? 'Chưa gán khu vực' },
    { label: 'Trạng thái', value: statusLabel },
    { label: 'Ưu tiên', value: getPriorityInfo(event.priority).label },
    { label: 'Dấu hiệu', value: labels.join(', ') || 'Chưa có bằng chứng lửa' },
    {
      label: 'Độ tin cậy sự kiện',
      value:
        typeof event.confidence === 'number' ? `${Math.round(event.confidence * 100)}%` : 'Chưa có',
    },
  ];
  return (
    <section className={styles.fireSummary} aria-label="Thông tin sự kiện">
      <dl className={styles.summaryFields}>
        <div className={styles.detectedTime}>
          <dt>Thời điểm phát hiện</dt>
          <dd>
            <time dateTime={event.detectedAt}>{formatExactTime(event.detectedAt)}</time>
          </dd>
        </div>
        {fields.map(({ label, value }) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {lastUpdate && (
        <p className={styles.lastUpdate}>
          Cập nhật:{' '}
          <time dateTime={lastUpdate.createdAt}>{formatExactTime(lastUpdate.createdAt)}</time>
          {lastUpdate.actorName ? ` · ${lastUpdate.actorName}` : ''}
        </p>
      )}
    </section>
  );
}
