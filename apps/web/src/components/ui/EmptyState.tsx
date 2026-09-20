'use client';

import styles from './empty-state.module.css';

export interface EmptyStateProps {
  title?: string;
  message?: string;
  onResetFilter?: () => void;
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function ResetIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  );
}

export function EmptyState({
  title = 'Hiện chưa có sự kiện cảnh báo nào',
  message = 'Tất cả camera và AI giám sát đang hoạt động ổn định. Ngôi nhà của bạn đang được bảo vệ an toàn 24/7.',
  onResetFilter,
}: EmptyStateProps) {
  return (
    <div className={styles.emptyContainer} role="status">
      <div className={styles.statusBadge}>
        <span className={styles.pulseDot} aria-hidden="true" />
        <span>Hệ thống an toàn · 4 Camera trực tuyến</span>
      </div>

      <div className={`${styles.iconWrapper} ${styles.iconShield}`}>
        <ShieldIcon />
      </div>

      <h3 className={styles.title}>{title}</h3>
      <p className={styles.description}>{message}</p>

      {onResetFilter && (
        <button
          type="button"
          id="empty-state-reset-filter-btn"
          className={styles.resetButton}
          onClick={onResetFilter}
        >
          <ResetIcon />
          <span>Đặt lại bộ lọc</span>
        </button>
      )}
    </div>
  );
}
