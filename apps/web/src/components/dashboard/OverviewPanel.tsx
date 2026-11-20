'use client';
import dynamic from 'next/dynamic';
import { MetricCards } from './MetricCards';
import { Icon } from '@/components/ui/Icon';
import type { UIEventItem } from '@/types';
import type { useEventStats } from '@/hooks/useEventStats';
import styles from './overview-panel.module.css';
const CameraShowcase = dynamic(
  () => import('@/components/showcase/CameraShowcase').then((module) => module.CameraShowcase),
  {
    ssr: false,
    loading: () => (
      <div className={styles.loading} role="status">
        Đang chuẩn bị không gian giám sát…
      </div>
    ),
  },
);
export function OverviewPanel({
  metrics,
  onNavigate,
}: {
  metrics: ReturnType<typeof useEventStats>;
  onNavigate: (page: string) => void;
}) {
  return (
    <section className={styles.topGrid} aria-label="Tổng quan hệ thống">
      <CameraShowcase onNavigate={onNavigate} />
      <div className={styles.metrics}>
        <MetricCards
          stats={metrics.stats}
          isLoading={metrics.isLoading}
          error={metrics.error}
          compact
        />
      </div>
    </section>
  );
}
export function SystemOverview({
  events,
  onNavigate,
}: {
  events: UIEventItem[];
  onNavigate: (page: string) => void;
}) {
  const finished = events.filter(
    (event) => event.status === 'RESOLVED' || event.status === 'CLOSED',
  ).length;
  const pending = events.filter(
    (event) =>
      !['RESOLVED', 'CLOSED', 'LOGGED_ONLY'].includes(event.status) && event.priority !== 'P3',
  ).length;
  const info = events.length - finished - pending;
  const p = events.length ? (pending / events.length) * 100 : 0,
    s = events.length ? (finished / events.length) * 100 : 0;
  const categories = [
    { label: 'Cần kiểm tra', value: pending, color: '#a583ed' },
    { label: 'Đã xử lý', value: finished, color: '#69b6d7' },
    { label: 'Thông tin', value: info, color: '#3b516e' },
  ];
  return (
    <aside className={styles.summary} aria-labelledby="activity-summary-title">
      <div className={styles.summaryHeader}>
        <h2 id="activity-summary-title">Nhịp giám sát</h2>
        <span>
          <Icon name="activity" size={17} />
        </span>
      </div>
      <p className={styles.subtitle}>Phân loại các sự kiện đã tải</p>
      <div
        className={styles.donut}
        role="img"
        aria-label={`${events.length} sự kiện đã tải: ${pending} cần kiểm tra, ${finished} đã xử lý, ${info} thông tin`}
        style={{
          background: events.length
            ? `conic-gradient(#a583ed 0% ${p}%,#69b6d7 ${p}% ${p + s}%,#3b516e ${p + s}% 100%)`
            : '#26344e',
        }}
      >
        <div>
          <strong>{events.length}</strong>
          <span>sự kiện</span>
        </div>
      </div>
      <div className={styles.legend}>
        {categories.map((item) => (
          <div key={item.label}>
            <span className={styles.dot} style={{ background: item.color }} />
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </div>
        ))}
      </div>
      <div className={styles.nextStep}>
        <span>
          <Icon name="shield" size={18} />
        </span>
        <div>
          <h3>Chủ động trước cảnh báo</h3>
          <p>Kiểm tra các sự kiện cần chú ý và phản hồi để hệ thống cập nhật trạng thái.</p>
        </div>
      </div>
      <button className={styles.action} type="button" onClick={() => onNavigate('events')}>
        Mở lịch sử sự kiện
        <Icon name="external" size={15} />
      </button>
    </aside>
  );
}
