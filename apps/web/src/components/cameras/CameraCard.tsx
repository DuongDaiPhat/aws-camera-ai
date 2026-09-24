'use client';

import type { Camera } from '@/types';
import { CameraStatusBadge } from './CameraStatusBadge';
import styles from './camera-view.module.css';

interface CameraCardProps {
  camera: Camera;
  isSelected: boolean;
  isAdmin: boolean;
  isToggling?: boolean;
  onSelect: (id: string) => void;
  onToggleState: (id: string, isEnabled: boolean) => void;
}

export function CameraCard({
  camera,
  isSelected,
  isAdmin,
  isToggling = false,
  onSelect,
  onToggleState,
}: CameraCardProps) {
  const handleToggle = (e: React.MouseEvent | React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (!isAdmin || isToggling) return;
    onToggleState(camera.id, !camera.isEnabled);
  };

  const sourceTypeLabel =
    camera.sourceType === 'BROWSER_WEBCAM'
      ? 'Webcam'
      : camera.sourceType === 'VIDEO_FILE'
        ? 'File Video'
        : 'RTSP';

  return (
    <div
      className={`${styles.cameraCardItem} ${isSelected ? styles.cameraCardActive : ''}`}
      onClick={() => onSelect(camera.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onSelect(camera.id);
      }}
    >
      <div className={styles.cardTopRow}>
        <h3 className={styles.cardName}>{camera.name}</h3>
        <CameraStatusBadge
          isEnabled={camera.isEnabled}
          runtimeStatus={camera.runtimeStatus}
          showConfigBadge
        />
      </div>

      <div className={styles.cardMetaRow}>
        <span>
          Slug: <code>{camera.slug}</code>
        </span>
        <span>
          Nguồn: <strong>{sourceTypeLabel}</strong>
        </span>
        <span>{camera.fps} FPS</span>
        {camera.zoneCount !== undefined && (
          <span>{camera.zoneCount} vùng</span>
        )}
      </div>

      {isAdmin && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingTop: '6px',
            borderTop: '1px solid var(--border)',
            marginTop: '4px',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <span style={{ fontSize: '12px', color: 'var(--ink-secondary)' }}>
            Điều khiển:
          </span>
          <label className={styles.switchWrapper}>
            {isToggling && <span className={styles.spinner} />}
            <span className={styles.switchLabel}>
              {camera.isEnabled ? 'Đang bật' : 'Đang tắt'}
            </span>
            <input
              type="checkbox"
              className={styles.switchInput}
              checked={camera.isEnabled}
              disabled={isToggling}
              onChange={handleToggle}
              aria-label={`Bật hoặc tắt ${camera.name}`}
            />
            <span className={styles.switchSlider} />
          </label>
        </div>
      )}
    </div>
  );
}
