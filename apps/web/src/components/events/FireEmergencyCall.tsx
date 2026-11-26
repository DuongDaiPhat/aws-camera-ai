import { FIRE_EMERGENCY_PHONE } from '@/lib/fire-ui-config';
import { EmergencyPhoneFluentIcon } from './FireAlertIcons';
import styles from './fire-attention.module.css';

export function FireEmergencyCall() {
  return (
    <a
      className={styles.emergencyCall}
      href={`tel:${FIRE_EMERGENCY_PHONE}`}
      title="Gọi 114 — Cảnh sát PCCC & cứu nạn, cứu hộ"
    >
      <span className={styles.phoneIconWrap} aria-hidden="true">
        <EmergencyPhoneFluentIcon size={19} />
      </span>
      <span>Gọi 114</span>
    </a>
  );
}
