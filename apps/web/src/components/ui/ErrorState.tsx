'use client';

import styles from './error-state.module.css';

export interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
}

function WarningIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

export function ErrorState({
  title = 'Không kết nối được với hệ thống giám sát',
  message,
  onRetry,
}: ErrorStateProps) {
  return (
    <div className={styles.container} role="alert">
      <div className={styles.iconWrapper}>
        <WarningIcon />
      </div>
      <h3 className={styles.title}>{title}</h3>
      <p className={styles.message}>{message}</p>
      {onRetry && (
        <button type="button" className={styles.retryButton} onClick={onRetry}>
          Thử lại
        </button>
      )}
    </div>
  );
}
