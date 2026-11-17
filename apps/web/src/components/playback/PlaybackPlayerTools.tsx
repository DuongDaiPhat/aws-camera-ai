import { Expand, ChevronLeft, ChevronRight } from 'lucide-react';
import { SelectMenu } from '@/components/ui/SelectMenu';
import styles from './playback.module.css';
interface Props {
  speed: string;
  onSpeed: (value: string) => void;
  onFullscreen: () => void;
  hasPrevious: boolean;
  hasNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
}
export function PlaybackPlayerTools({
  speed,
  onSpeed,
  onFullscreen,
  hasPrevious,
  hasNext,
  onPrevious,
  onNext,
}: Props) {
  return (
    <div className={styles.playerTools}>
      <div>
        <button aria-label="Đoạn trước" disabled={!hasPrevious} onClick={onPrevious}>
          <ChevronLeft size={18} />
        </button>
        <button aria-label="Đoạn tiếp theo" disabled={!hasNext} onClick={onNext}>
          <ChevronRight size={18} />
        </button>
      </div>
      <div>
        <SelectMenu
          label="Tốc độ phát"
          value={speed}
          options={['0.5', '1', '2', '4'].map((value) => ({ value, label: value + '×' }))}
          onChange={onSpeed}
          tone="light"
        />
        <button aria-label="Phóng to bản ghi" onClick={onFullscreen}>
          <Expand size={17} />
        </button>
      </div>
    </div>
  );
}
