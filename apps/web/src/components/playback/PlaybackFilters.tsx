import { SelectMenu } from '@/components/ui/SelectMenu';
import type { PlaybackCamera } from '@/types';
import styles from './playback.module.css';
interface Props {
  cameras: PlaybackCamera[];
  cameraId: string;
  onCamera: (id: string) => void;
  layout: string;
  custom: number;
  onLayout: (value: string) => void;
  onCustom: (value: number) => void;
}
export function PlaybackFilters({
  cameras,
  cameraId,
  onCamera,
  layout,
  custom,
  onLayout,
  onCustom,
}: Props) {
  return (
    <div className={styles.filters} aria-label="Bố cục camera xem lại">
      <SelectMenu
        label="Camera xem lại"
        value={cameraId}
        options={cameras.map((camera) => ({ value: camera.id, label: camera.name }))}
        onChange={onCamera}
        disabled={!cameras.length}
        tone="violet"
      />
      <div className={styles.layoutControl}>
        <SelectMenu
          label="Số camera xem lại"
          value={layout}
          options={[1, 2, 4, 6, 8]
            .map((n) => ({ value: String(n), label: n + ' camera' }))
            .concat({ value: 'custom', label: 'Tùy chỉnh' })}
          onChange={onLayout}
        />
        {layout === 'custom' && (
          <input
            aria-label="Số camera xem lại tùy chỉnh"
            type="number"
            min={1}
            max={64}
            value={custom}
            onChange={(event) => {
              const n = Number(event.target.value);
              if (Number.isSafeInteger(n) && n > 0 && n <= 64) onCustom(Math.min(n, 64));
            }}
          />
        )}
      </div>
    </div>
  );
}
