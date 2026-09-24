'use client';

import type { CameraRuntimeStatus } from '@/types';
import styles from './camera-view.module.css';

interface CameraStatusBadgeProps {
  isEnabled: boolean;
  runtimeStatus?: CameraRuntimeStatus;
  showConfigBadge?: boolean;
}

export function CameraStatusBadge({
  isEnabled,
  runtimeStatus = 'OFFLINE',
  showConfigBadge = false,
}: CameraStatusBadgeProps) {
  let badgeStyle = styles.badgeOffline;
  let statusText = 'Offline';

  switch (runtimeStatus) {
    case 'ONLINE':
      badgeStyle = styles.badgeOnline;
      statusText = 'Online';
      break;
    case 'STARTING':
      badgeStyle = styles.badgeConnecting;
      statusText = 'Đang khởi động';
      break;
    case 'FAILED':
      badgeStyle = styles.badgeError;
      statusText = 'Lỗi kết nối';
      break;
    case 'DISABLED':
      badgeStyle = styles.badgeOffline;
      statusText = 'Đã tắt';
      break;
    default:
      badgeStyle = styles.badgeOffline;
      statusText = 'Offline';
  }

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
      {showConfigBadge && (
        <span
          className={isEnabled ? styles.badgeConfigOn : styles.badgeConfigOff}
          title={isEnabled ? 'Camera đã được kích hoạt trong cấu hình' : 'Camera đang bị tắt trong cấu hình'}
        >
          {isEnabled ? 'Đã bật' : 'Đã tắt'}
        </span>
      )}
      <span className={`${styles.badge} ${badgeStyle}`}>
        <span className={styles.badgeDot} />
        {statusText}
      </span>
    </div>
  );
}
