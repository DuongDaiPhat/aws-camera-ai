'use client';

import { Fragment, useEffect, useRef, useState, type RefObject } from 'react';
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  History,
  Inbox,
  ListChecks,
  Siren,
} from 'lucide-react';
import { Icon, type IconName } from '@/components/ui/Icon';
import { useNotificationClock } from '@/hooks/useNotificationClock';
import { fetchNotificationPage } from '@/lib/events-client';
import { notificationState } from '@/lib/notification-state';
import { alertEmphasis } from '@/lib/fire-alerts';
import { formatExactTime, getPriorityInfo } from '@/lib/format';
import {
  archiveWindow,
  dayStart,
  notificationClock,
  notificationQuery,
  NOTIFICATION_STATES,
  todayWindow,
  type NotificationState,
} from '@/lib/notification-periods';
import type { EventStatus, EventType, UIEventItem } from '@/types';
import {
  ArchiveDateFilter,
  NotificationStateFilter,
  NotificationTypeFilter,
  TodayTimeFilter,
  type Period,
} from './NotificationFilters';
import styles from './notification-inbox.module.css';
import criticalStyles from './alert-emphasis.module.css';

const PAGE_SIZE = 10;

const CATEGORIES: Record<EventType, { label: string; title: string; icon: IconName }> = {
  UNKNOWN_PERSON: { label: 'Người lạ', title: 'Phát hiện người lạ', icon: 'face' },
  FIRE_SMOKE_DETECTED: {
    label: 'Lửa / khói',
    title: 'Phát hiện dấu hiệu lửa hoặc khói',
    icon: 'flame',
  },
  FALL_DETECTED: { label: 'Té ngã', title: 'Phát hiện dấu hiệu té ngã', icon: 'fall' },
  RESTRICTED_ZONE: { label: 'Vùng cấm', title: 'Xâm nhập khu vực cấm', icon: 'zone' },
  PERSON_DETECTED: { label: 'Phát hiện người', title: 'Phát hiện người', icon: 'users' },
  WELLNESS_TIMEOUT: { label: 'Kiểm tra an toàn', title: 'Quá hạn kiểm tra an toàn', icon: 'heart' },
};
const CATEGORY_OPTIONS = [
  { value: '', label: 'Tất cả loại' },
  ...Object.entries(CATEGORIES).map(([value, category]) => ({ value, label: category.label })),
];

const STATUS_LABELS: Record<EventStatus, string> = {
  DETECTED: 'Mới phát hiện',
  LOGGED_ONLY: 'Chỉ ghi nhận',
  NOTIFIED: 'Chờ xác nhận',
  ESCALATED: 'Đã chuyển cấp',
  RESOLVED: 'Đã xác nhận an toàn',
  CLOSED: 'Đã đóng',
  AI_FAILED: 'AI chưa phân tích được',
};

const DAILY_METRICS = [
  { value: 'all', label: 'Tổng hôm nay', icon: Inbox },
  ...NOTIFICATION_STATES.map((group, index) => ({
    ...group,
    icon: [CircleAlert, ListChecks, CheckCircle2][index]!,
  })),
] as const;
const fullDate = new Intl.DateTimeFormat('vi-VN', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});
const countLabel = new Intl.NumberFormat('vi-VN');
type RefreshProps = { recentEvents: UIEventItem[]; actionVersion: number };

function useTodayCounts(day: number, recentEvents: UIEventItem[], actionVersion: number) {
  const [counts, setCounts] = useState<{ day: number; values: (number | null)[] }>();
  useEffect(() => {
    const controller = new AbortController();
    const bounds = todayWindow(day);
    void Promise.allSettled(
      DAILY_METRICS.map(({ value }) =>
        fetchNotificationPage(notificationQuery(bounds, 1, '', value), controller.signal),
      ),
    ).then((results) => {
      if (controller.signal.aborted) return;
      setCounts((previous) => ({
        day,
        values: results.map((item, index) =>
          item.status === 'fulfilled'
            ? item.value.total
            : previous?.day === day
              ? (previous.values[index] ?? null)
              : null,
        ),
      }));
    });
    return () => controller.abort();
  }, [day, recentEvents, actionVersion]);
  return counts?.day === day ? counts.values : undefined;
}

function NotificationHeader({ day, recentEvents, actionVersion }: RefreshProps & { day: number }) {
  const counts = useTodayCounts(day, recentEvents, actionVersion);
  return (
    <header className={styles.header}>
      <div className={styles.heading}>
        <h1>Thông báo</h1>
        <span className={styles.day}>
          <CalendarDays size={16} aria-hidden="true" />
          {fullDate.format(day)}
        </span>
      </div>
      <dl className={styles.metrics} aria-label="Thống kê thông báo hôm nay" aria-busy={!counts}>
        {DAILY_METRICS.map(({ value, label, icon: MetricIcon }, index) => (
          <div key={value} className={styles.metric} data-metric={value}>
            <dt>
              <span className={styles.metricIcon}>
                <MetricIcon size={18} aria-hidden="true" />
              </span>
              {label}
            </dt>
            <dd>{counts?.[index] == null ? '—' : countLabel.format(counts[index]!)}</dd>
          </div>
        ))}
      </dl>
    </header>
  );
}

function useNotificationPage(
  filters: string,
  page: number,
  recentEvents: UIEventItem[],
  refreshKey: number,
) {
  const [result, setResult] = useState<{
    filters: string;
    page: number;
    events: UIEventItem[];
    total: number;
    failed?: boolean;
  }>();

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams(filters);
    query.set('page', String(page));
    fetchNotificationPage(query.toString(), controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setResult({ filters, page, ...data });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setResult((previous) => ({
          filters,
          page,
          events: previous?.filters === filters && previous.page === page ? previous.events : [],
          total: previous?.filters === filters ? previous.total : 0,
          failed: true,
        }));
      });
    return () => controller.abort();
  }, [filters, page, recentEvents, refreshKey]);

  const sameFilters = result?.filters === filters ? result : undefined;
  return {
    result: sameFilters?.page === page ? sameFilters : undefined,
    total: sameFilters?.total,
  };
}

function NotificationRow({
  event,
  history,
  now,
  unread,
  onViewDetail,
}: {
  event: UIEventItem;
  history: boolean;
  now: number;
  unread: boolean;
  onViewDetail: (event: UIEventItem) => void;
}) {
  const [brokenImage, setBrokenImage] = useState<string>();
  const category = CATEGORIES[event.eventType];
  const emphasis = alertEmphasis(event, now);
  const priority = getPriorityInfo(event.priority);
  const finished = notificationState(event, now) === 'done';
  const source = [event.camera?.name || event.wellnessResidentName, event.zone?.name].filter(
    Boolean,
  );

  return (
    <li>
      <button
        className={`${styles.row} ${criticalStyles.emphasis}`}
        data-alert={emphasis}
        data-unread={unread || undefined}
        type="button"
        onClick={() => onViewDetail(event)}
      >
        <span className={styles.preview} data-type={event.eventType}>
          <Icon name={category?.icon ?? 'bell'} size={25} />
          {event.thumbnailUrl && event.thumbnailUrl !== brokenImage && (
            <img
              src={event.thumbnailUrl}
              alt=""
              loading="lazy"
              onError={() => setBrokenImage(event.thumbnailUrl ?? undefined)}
            />
          )}
        </span>
        <span className={styles.eventText}>
          <time dateTime={event.detectedAt} title={formatExactTime(event.detectedAt)}>
            {history
              ? formatExactTime(event.detectedAt)
              : notificationClock.format(new Date(event.detectedAt))}
          </time>
          <strong>{category?.title ?? 'Thông báo giám sát'}</strong>
          {source.length > 0 && <span className={styles.source}>{source.join(' · ')}</span>}
          <span className={styles.badges}>
            {emphasis && (
              <span className={criticalStyles.urgencyTag}>
                <Siren size={13} aria-hidden="true" />
                {emphasis === 'urgent' ? 'Khẩn cấp' : 'Ưu tiên'}
              </span>
            )}
            {event.priority !== 'P3' && (
              <span
                className={styles.priority}
                data-priority={finished ? undefined : event.priority}
                title={priority.label}
              >
                {event.priority}
              </span>
            )}
            <span className={styles.status} data-status={finished ? 'CLOSED' : event.status}>
              {finished ? 'Đã xử lý' : STATUS_LABELS[event.status]}
            </span>
          </span>
        </span>
        {unread && <span className={criticalStyles.unreadLabel}>Chưa đọc</span>}
        <Icon className={styles.rowArrow} name="chevron" size={16} />
      </button>
    </li>
  );
}

function NotificationResults({
  result,
  emptyLabel,
  history,
  now,
  readIds,
  onRetry,
  onViewDetail,
}: {
  result: ReturnType<typeof useNotificationPage>['result'];
  emptyLabel: string;
  history: boolean;
  now: number;
  readIds?: ReadonlySet<string>;
  onRetry: () => void;
  onViewDetail: (event: UIEventItem) => void;
}) {
  return (
    <div className={styles.results} aria-busy={!result}>
      {!result && (
        <p className={styles.feedback} role="status">
          Đang tải thông báo…
        </p>
      )}
      {result?.failed && (
        <div className={styles.feedback} role="alert">
          <span>Chưa tải được thông báo.</span>
          <button type="button" className={styles.clear} onClick={onRetry}>
            Thử lại
          </button>
        </div>
      )}
      {result && !result.failed && result.events.length === 0 && (
        <p className={styles.feedback}>
          <Inbox size={22} aria-hidden="true" />
          {emptyLabel}
        </p>
      )}
      {!!result?.events.length && (
        <ul className={styles.list}>
          {result.events.map((event) => (
            <NotificationRow
              key={event.id}
              event={event}
              history={history}
              now={now}
              unread={!readIds?.has(event.id)}
              onViewDetail={onViewDetail}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function ListHeading({
  history,
  count,
  switchRef,
  onSwitch,
}: {
  history: boolean;
  count?: string;
  switchRef: RefObject<HTMLButtonElement>;
  onSwitch: () => void;
}) {
  return (
    <div className={styles.listHeading}>
      <div className={styles.listTitle}>
        <h2 id="notification-list-title">
          {history ? 'Lịch sử thông báo' : 'Thông báo trong ngày'}
        </h2>
        {count && (
          <span className={styles.resultCount} aria-live="polite">
            {count} <span>thông báo</span>
          </span>
        )}
      </div>
      <button ref={switchRef} type="button" className={styles.switchView} onClick={onSwitch}>
        {history ? (
          <ArrowLeft size={16} aria-hidden="true" />
        ) : (
          <History size={17} aria-hidden="true" />
        )}
        {history ? 'Về hôm nay' : 'Lịch sử'}
      </button>
    </div>
  );
}

function ListPagination({
  page,
  lastPage,
  onPage,
}: {
  page: number;
  lastPage: number;
  onPage: (page: number) => void;
}) {
  if (lastPage <= 1) return null;
  const nearby = Array.from(
    { length: Math.min(3, lastPage) },
    (_, index) => Math.min(Math.max(page - 1, 1), Math.max(lastPage - 2, 1)) + index,
  );
  const pages = [...new Set([1, ...nearby, lastPage])];
  return (
    <nav className={styles.pagination} aria-label="Trang thông báo">
      {pages.map((number, index) => (
        <Fragment key={number}>
          {index > 0 && number > pages[index - 1]! + 1 && <span aria-hidden="true">…</span>}
          <button
            type="button"
            aria-label={`Trang ${number}`}
            aria-current={number === page ? 'page' : undefined}
            onClick={() => onPage(number)}
          >
            {number}
          </button>
        </Fragment>
      ))}
    </nav>
  );
}

function NotificationList({
  history,
  now,
  recentEvents,
  actionVersion,
  onSwitch,
  switchRef,
  readIds,
  onViewDetail,
}: RefreshProps & {
  history: boolean;
  now: number;
  onSwitch: () => void;
  switchRef: RefObject<HTMLButtonElement>;
  readIds?: ReadonlySet<string>;
  onViewDetail: (event: UIEventItem) => void;
}) {
  const [eventType, setEventType] = useState('');
  const [period, setPeriod] = useState<Period>({ preset: 0 });
  const PeriodFilter = history ? ArchiveDateFilter : TodayTimeFilter;
  const [state, setState] = useState<NotificationState>('all');
  const [page, setPage] = useState(1);
  const [retries, setRetries] = useState(0);
  const bounds =
    period.custom ??
    (history ? archiveWindow(now, period.preset) : todayWindow(now, period.preset));
  const request =
    notificationQuery(bounds, PAGE_SIZE, eventType, state) + (history ? '' : '&urgentFirst=true');
  const { result, total } = useNotificationPage(
    request,
    page,
    recentEvents,
    actionVersion + retries,
  );
  const lastPage = Math.max(1, Math.ceil((total ?? 0) / PAGE_SIZE));
  const filtered = Boolean(period.preset || period.custom || eventType || state !== 'all');

  useEffect(() => {
    if (result && !result.failed && page > lastPage) setPage(lastPage);
  }, [result, lastPage, page]);

  return (
    <section className={styles.panel} aria-labelledby="notification-list-title">
      <ListHeading
        history={history}
        count={
          result?.failed && !total
            ? '—'
            : total === 0
              ? undefined
              : total === undefined
                ? '…'
                : countLabel.format(total)
        }
        switchRef={switchRef}
        onSwitch={onSwitch}
      />
      <div className={styles.toolbar}>
        <NotificationTypeFilter
          options={CATEGORY_OPTIONS}
          value={eventType}
          onChange={(value) => {
            setEventType(value);
            setPage(1);
          }}
        />
        <PeriodFilter
          period={period}
          now={now}
          onChange={(value) => {
            setPeriod(value);
            setPage(1);
          }}
        />
        <NotificationStateFilter
          value={state}
          onChange={(value) => {
            setState(value);
            setPage(1);
          }}
        />
      </div>
      <NotificationResults
        result={result}
        emptyLabel={
          filtered
            ? 'Không có thông báo phù hợp với bộ lọc.'
            : history
              ? 'Chưa có thông báo trước hôm nay.'
              : 'Hôm nay chưa có thông báo.'
        }
        history={history}
        now={now}
        readIds={readIds}
        onRetry={() => setRetries((count) => count + 1)}
        onViewDetail={onViewDetail}
      />
      <ListPagination page={page} lastPage={lastPage} onPage={setPage} />
    </section>
  );
}

export function NotificationInbox({
  onViewDetail,
  readIds,
  recentEvents,
  actionVersion,
}: RefreshProps & { onViewDetail: (event: UIEventItem) => void; readIds?: ReadonlySet<string> }) {
  const [history, setHistory] = useState(false);
  const now = useNotificationClock(recentEvents);
  const pendingCount = recentEvents.filter(
    (event) => notificationState(event, now) === 'pending',
  ).length;
  const refresh = {
    recentEvents,
    actionVersion: actionVersion + pendingCount + Math.floor(now / 60000),
  };
  const switchRef = useRef<HTMLButtonElement>(null);
  const focusSwitch = useRef(false);
  const day = dayStart(now);
  useEffect(() => {
    if (focusSwitch.current) {
      switchRef.current?.focus({ preventScroll: true });
      focusSwitch.current = false;
    }
  }, [history]);

  return (
    <div className={styles.inbox}>
      <NotificationHeader day={day} {...refresh} />
      <NotificationList
        key={`${history}-${day}`}
        history={history}
        now={now}
        readIds={readIds}
        {...refresh}
        switchRef={switchRef}
        onSwitch={() => {
          focusSwitch.current = true;
          setHistory((open) => !open);
        }}
        onViewDetail={onViewDetail}
      />
    </div>
  );
}
