'use client';

import { useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import type { UIEventItem } from '@/types';
import type { useEvents } from '@/hooks/useEvents';
import type { useEventStats } from '@/hooks/useEventStats';
import { Icon, type IconName } from '@/components/ui/Icon';
import { formatExactTime } from '@/lib/format';
import styles from './dashboard-notifications.module.css';

type Kind = 'all' | 'stranger' | 'fire' | 'fall';
const filters: { id: Kind; title: string; icon: IconName }[] = [
  { id: 'all', title: 'Tất cả', icon: 'grid' },
  { id: 'stranger', title: 'Người lạ', icon: 'face' },
  { id: 'fire', title: 'Lửa', icon: 'flame' },
  { id: 'fall', title: 'Té ngã', icon: 'fall' },
];
const presentation: Record<
  UIEventItem['eventType'],
  { kind: string; title: string; icon: IconName }
> = {
  UNKNOWN_PERSON: { kind: 'stranger', title: 'Phát hiện người lạ', icon: 'face' },
  FIRE_SMOKE_DETECTED: { kind: 'fire', title: 'Phát hiện lửa / khói', icon: 'flame' },
  FALL_DETECTED: { kind: 'fall', title: 'Phát hiện dấu hiệu té ngã', icon: 'fall' },
  RESTRICTED_ZONE: { kind: 'stranger', title: 'Có người vào khu vực giới hạn', icon: 'zone' },
  PERSON_DETECTED: { kind: 'activity', title: 'Phát hiện người', icon: 'users' },
  WELLNESS_TIMEOUT: { kind: 'wellness', title: 'Chưa ghi nhận hoạt động', icon: 'heart' },
};

function NotificationCard({ event, onOpen }: { event: UIEventItem; onOpen: () => void }) {
  const reduce = useReducedMotion();
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const look = presentation[event.eventType];
  const active =
    event.priority !== 'P3' && !['RESOLVED', 'CLOSED', 'LOGGED_ONLY'].includes(event.status);
  return (
    <motion.button
      type="button"
      className={styles.card}
      data-kind={look.kind}
      data-active={active}
      onClick={onOpen}
      initial={
        reduce
          ? false
          : { opacity: 0, y: look.kind === 'fall' ? -7 : 5, scale: look.kind === 'fire' ? 0.98 : 1 }
      }
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: reduce ? 0 : 0.24 }}
    >
      <span className={styles.artwork}>
        {event.thumbnailUrl && failedUrl !== event.thumbnailUrl ? (
          <img
            src={event.thumbnailUrl}
            width={50}
            height={54}
            alt=""
            loading="lazy"
            onError={() => setFailedUrl(event.thumbnailUrl ?? null)}
          />
        ) : (
          <Icon name={look.icon} size={23} />
        )}
      </span>
      <span className={styles.copy}>
        <strong>{look.title}</strong>
        <span>
          {[event.camera?.name, event.zone?.name].filter(Boolean).join(' · ') ||
            event.wellnessResidentName ||
            'Sự kiện camera'}
        </span>
        <small>
          <time dateTime={event.detectedAt} title={formatExactTime(event.detectedAt)}>
            {event.relativeTimeText}
          </time>
          <span>{active ? 'Cần xem' : 'Đã ghi nhận'}</span>
        </small>
      </span>
      <Icon name="chevron" size={14} />
    </motion.button>
  );
}

export function DashboardNotifications({
  state,
  metrics,
  onNavigate,
  onViewDetail,
}: {
  state: ReturnType<typeof useEvents>;
  metrics: ReturnType<typeof useEventStats>;
  onNavigate: (page: string) => void;
  onViewDetail: (event: UIEventItem) => void;
}) {
  const [kind, setKind] = useState<Kind>('all');
  const [onlyPending, setOnlyPending] = useState(false);
  const recent = state.filteredEvents
    .filter(
      (event) =>
        (kind === 'all' ||
          (kind === 'stranger'
            ? event.eventType === 'UNKNOWN_PERSON'
            : presentation[event.eventType].kind === kind)) &&
        (!onlyPending ||
          (event.priority !== 'P3' &&
            !['RESOLVED', 'CLOSED', 'LOGGED_ONLY'].includes(event.status))),
    )
    .slice()
    .sort((a, b) => new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime())
    .slice(0, 5);
  const unknown = metrics.isLoading || Boolean(metrics.error) || !metrics.stats;
  const pending =
    state.isLoading || state.error
      ? '—'
      : state.filteredEvents.filter(
          (event) =>
            event.priority !== 'P3' &&
            !['RESOLVED', 'CLOSED', 'LOGGED_ONLY'].includes(event.status),
        ).length;
  const total = unknown ? '—' : metrics.stats!.totalEvents;

  return (
    <section className={styles.panel} aria-labelledby="notifications-title">
      <div className={styles.heading}>
        <h2 id="notifications-title">
          <Icon name="bell" size={20} />
          Thông báo
        </h2>
        <button
          type="button"
          className={styles.pending}
          title="Cảnh báo cần xử lý trong các sự kiện đã tải"
          aria-pressed={onlyPending}
          onClick={() => setOnlyPending((value) => !value)}
          aria-label={`Lọc cảnh báo cần xử lý (${pending})`}
        >
          <span>{pending}</span>cần xử lý
        </button>
      </div>
      <p className={styles.summary}>
        <Icon name="activity" size={13} />
        {total} sự kiện trong {metrics.stats?.windowHours ?? 24} giờ
      </p>
      <div className={styles.filters} aria-label="Loại thông báo">
        {filters.map((filter) => (
          <button
            key={filter.id}
            type="button"
            aria-pressed={filter.id === kind}
            onClick={() => setKind(filter.id)}
          >
            <Icon name={filter.icon} size={14} />
            {filter.title}
          </button>
        ))}
      </div>
      {state.isLoading ? (
        <p className={styles.empty} role="status">
          Đang tải thông báo…
        </p>
      ) : state.error ? (
        <div className={styles.empty} role="alert">
          <p>{state.error}</p>
          <button type="button" onClick={state.reload}>
            Thử lại
          </button>
        </div>
      ) : recent.length ? (
        <div className={styles.list}>
          {recent.map((event) => (
            <NotificationCard key={event.id} event={event} onOpen={() => onViewDetail(event)} />
          ))}
        </div>
      ) : (
        <div className={styles.empty}>
          <span className={styles.emptyArtwork}>
            <Icon name={filters.find((filter) => filter.id === kind)?.icon ?? 'bell'} size={30} />
          </span>
          <p>
            {kind === 'all'
              ? onlyPending
                ? 'Không có thông báo cần xử lý.'
                : 'Chưa có thông báo trong khu vực đã chọn.'
              : `Chưa có thông báo ${filters.find((filter) => filter.id === kind)?.title.toLowerCase()}${onlyPending ? ' cần xử lý' : ''}.`}
          </p>
        </div>
      )}
      {metrics.error && (
        <p className={styles.summary} role="status">
          Chưa tải được số liệu thống kê.
        </p>
      )}
      <button type="button" className={styles.history} onClick={() => onNavigate('events')}>
        Xem lịch sử sự kiện
        <Icon name="arrow" size={15} />
      </button>
    </section>
  );
}
