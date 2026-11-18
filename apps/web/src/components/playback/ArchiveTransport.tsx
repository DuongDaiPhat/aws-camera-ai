'use client';
import { Play, Pause, SkipBack, SkipForward, RotateCcw, RotateCw, Maximize2 } from 'lucide-react';
import styles from './archive-workspace.module.css';

interface Props {
  cursor: number | null;
  playing: boolean;
  rate: number;
  available: boolean;
  hasPrevious: boolean;
  hasNext: boolean;
  onPlay: () => void;
  onStep: (seconds: number) => void;
  onCoverage: (direction: -1 | 1) => void;
  onRate: (rate: number) => void;
  onFullscreen: () => void;
}
export function ArchiveTransport(props: Props) {
  const controls = [
    {
      label: 'Khoảng có dữ liệu trước',
      icon: SkipBack,
      action: () => props.onCoverage(-1),
      disabled: !props.hasPrevious,
    },
    {
      label: 'Lùi 10 giây',
      icon: RotateCcw,
      action: () => props.onStep(-10),
      disabled: props.cursor === null,
    },
    {
      label: props.playing ? 'Tạm dừng' : 'Phát bản ghi',
      icon: props.playing ? Pause : Play,
      action: props.onPlay,
      disabled: !props.available && !props.playing,
      toggle: true,
    },
    {
      label: 'Tiến 10 giây',
      icon: RotateCw,
      action: () => props.onStep(10),
      disabled: props.cursor === null,
    },
    {
      label: 'Khoảng có dữ liệu tiếp theo',
      icon: SkipForward,
      action: () => props.onCoverage(1),
      disabled: !props.hasNext,
    },
  ];
  return (
    <div className={styles.transport} aria-label="Điều khiển xem lại">
      <div className={styles.transportButtons}>
        {controls.map(({ label, icon: Icon, action, disabled, toggle }) => (
          <button
            key={toggle ? 'playback' : label}
            type="button"
            className={toggle ? styles.playButton : undefined}
            aria-label={label}
            title={label}
            aria-pressed={toggle ? props.playing : undefined}
            disabled={disabled}
            onClick={action}
          >
            <Icon size={17} aria-hidden="true" />
          </button>
        ))}
      </div>
      <div className={styles.transportEnd}>
        <label className={styles.rateControl}>
          <span>Tốc độ</span>
          <select
            aria-label="Tốc độ xem lại"
            value={props.rate}
            onChange={(event) => props.onRate(Number(event.target.value))}
          >
            {[0.5, 1, 2, 4, 8].map((rate) => (
              <option key={rate} value={rate}>
                {rate}×
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          aria-label="Toàn màn hình xem lại"
          title="Toàn màn hình"
          onClick={props.onFullscreen}
        >
          <Maximize2 size={17} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
