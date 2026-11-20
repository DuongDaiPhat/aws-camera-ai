import { Icon } from '@/components/ui/Icon';
import type { CameraCommand } from './camera-parts';
import styles from './camera-showcase.module.css';
interface CameraControlsProps {
  exploded: boolean;
  autoRotate: boolean;
  available: boolean;
  reducedMotion: boolean;
  onToggleExploded: () => void;
  onToggleAutoRotate: () => void;
  onReset: () => void;
  send: (action: CameraCommand['action']) => void;
}
export function CameraControls({
  exploded,
  autoRotate,
  available,
  reducedMotion,
  onToggleExploded,
  onToggleAutoRotate,
  onReset,
  send,
}: CameraControlsProps) {
  return (
    <>
      {' '}
      <div className={styles.viewerToolbar}>
        <button
          type="button"
          className={styles.explodeButton}
          onClick={onToggleExploded}
          aria-pressed={exploded}
          disabled={!available}
        >
          <Icon name="layers" size={18} />
          {exploded ? 'Lắp lại camera' : 'Tách linh kiện'}
        </button>
        <button type="button" className={styles.toolButton} onClick={onReset} disabled={!available}>
          <Icon name="refresh" size={16} />
          Đặt lại góc nhìn
        </button>
        <button
          type="button"
          className={`${styles.toolButton} ${autoRotate ? styles.activeTool : ''}`}
          onClick={onToggleAutoRotate}
          aria-pressed={autoRotate}
          disabled={!available || reducedMotion}
        >
          Tự xoay {autoRotate ? 'bật' : 'tắt'}
        </button>
      </div>
      <div className={styles.navigationTools} aria-label="Điều khiển góc nhìn bằng nút">
        <span>Kéo để xoay · Cuộn để phóng to</span>
        <div>
          {(
            [
              { action: 'left', label: 'Xoay trái', text: '↶' },
              { action: 'right', label: 'Xoay phải', text: '↷' },
              { action: 'in', label: 'Phóng to', text: '+' },
              { action: 'out', label: 'Thu nhỏ', text: '−' },
            ] as const
          ).map((item) => (
            <button
              type="button"
              key={item.action}
              aria-label={item.label}
              title={item.label}
              onClick={() => send(item.action)}
              disabled={!available}
            >
              {item.text}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
