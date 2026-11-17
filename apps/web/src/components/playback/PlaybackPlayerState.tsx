import { Cctv, LoaderCircle, RotateCcw } from 'lucide-react';
import styles from './playback.module.css';
export function PlaybackPlayerState({
  loading,
  error,
  onRetry,
}: {
  loading: boolean;
  error: string;
  onRetry: () => void;
}) {
  return (
    <div className={styles.playerState}>
      {loading ? <LoaderCircle size={34} className={styles.spinner} /> : <Cctv size={40} />}
      <strong>
        {loading
          ? 'Đang tải đoạn ghi hình…'
          : error
            ? 'Chưa thể phát bản ghi'
            : 'Đang chờ bản ghi camera'}
      </strong>
      <p>{error || 'Bản ghi sẽ tự cập nhật khi camera gửi hình và lưu xong video.'}</p>
      {error && (
        <button className={styles.lightButton} onClick={onRetry}>
          <RotateCcw size={15} />
          Thử lại
        </button>
      )}
    </div>
  );
}
