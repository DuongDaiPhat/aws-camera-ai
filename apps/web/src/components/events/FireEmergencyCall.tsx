import { FIRE_EMERGENCY_PHONE } from '@/lib/fire-ui-config';
import styles from './fire-attention.module.css';

export function FireEmergencyCall() {
  return (
    <a
      className={styles.emergencyCall}
      href={`tel:${FIRE_EMERGENCY_PHONE}`}
      title="Gọi 114 — Cảnh sát PCCC & cứu nạn, cứu hộ"
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.69 2.79a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.89.33 1.83.56 2.79.69A2 2 0 0 1 22 16.92z" />
      </svg>
      <span>Gọi 114</span>
    </a>
  );
}
