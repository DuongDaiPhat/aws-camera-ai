'use client';

import type { Zone } from '@/types';
import styles from './zones.module.css';

const TYPE_LABEL: Record<Zone['zoneType'], string> = {
  RESTRICTED: 'Vùng cấm',
  REST_AREA: 'Khu nghỉ',
  NORMAL: 'Vùng thường',
};

export function ZoneList({
  zones,
  selectedId,
  onSelect,
}: {
  zones: Zone[];
  selectedId: string | null;
  onSelect: (zone: Zone) => void;
}) {
  if (zones.length === 0) return <p className={styles.empty}>Camera này chưa có vùng nào.</p>;
  return (
    <div className={styles.zoneList}>
      {zones.map((zone) => (
        <button
          type="button"
          key={zone.id}
          className={`${styles.zoneItem} ${selectedId === zone.id ? styles.zoneItemSelected : ''}`}
          onClick={() => onSelect(zone)}
        >
          <span>
            <strong>{zone.name}</strong>
            <small>{TYPE_LABEL[zone.zoneType]}</small>
          </span>
          <span className={zone.isEnabled ? styles.enabled : styles.disabled}>
            {zone.isEnabled ? 'Đang bật' : 'Đã tắt'}
          </span>
        </button>
      ))}
    </div>
  );
}
