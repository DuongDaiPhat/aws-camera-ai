'use client';

import styles from './empty-state.module.css';

export interface EmptyStateProps {
  title?: string;
  message?: string;
  onResetFilter?: () => void;
}

export function EmptyState({
  title = 'Chưa có dữ liệu',
  message = 'Hệ thống đang hoạt động bình thường.',
  onResetFilter,
}: EmptyStateProps) {
  return (
    <div className={styles.emptyContainer} role="status">
      <div className={styles.iconWrapper} aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      </div>
      <h3 className={styles.title}>{title}</h3>
      <p className={styles.description}>{message}</p>
      {onResetFilter && (
        <button type="button" className={styles.resetButton} onClick={onResetFilter}>
          Đặt lại bộ lọc
        </button>
      )}
    </div>
  );
}
