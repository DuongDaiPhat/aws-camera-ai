'use client';

import type { ZonePoint } from '@/lib/zone-geometry';
import styles from './zones.module.css';

export function ZonePolygonEditor({
  points,
  error,
  onChange,
  onComplete,
  onCancel,
}: {
  points: ZonePoint[];
  error: string | null;
  onChange: (points: ZonePoint[]) => void;
  onComplete: () => void;
  onCancel: () => void;
}) {
  return (
    <div className={styles.editorBar} aria-live="polite">
      <span>
        {points.length === 0 ? 'Chạm lên ảnh để đặt đỉnh đầu tiên.' : `${points.length} đỉnh`}
      </span>
      {error && <span className={styles.editorError}>{error}</span>}
      <div className={styles.editorActions}>
        <button
          type="button"
          disabled={points.length === 0}
          onClick={() => onChange(points.slice(0, -1))}
        >
          Hoàn tác điểm
        </button>
        <button
          type="button"
          disabled={points.length <= 3}
          onClick={() => onChange(points.slice(0, -1))}
        >
          Xóa đỉnh cuối
        </button>
        <button type="button" disabled={Boolean(error)} onClick={onComplete}>
          Hoàn tất polygon
        </button>
        <button type="button" onClick={onCancel}>
          Hủy
        </button>
      </div>
    </div>
  );
}
