'use client';

import styles from './disabled-module-banner.module.css';

export function DisabledModuleBanner({
  message,
  onOpenSettings,
}: {
  message: string;
  onOpenSettings?: () => void;
}) {
  return (
    <div className={styles.banner} role="alert">
      <span>{message}</span>
      {onOpenSettings && (
        <button type="button" onClick={onOpenSettings}>
          Mở Cài đặt AI
        </button>
      )}
    </div>
  );
}
