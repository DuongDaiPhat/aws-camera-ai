'use client';

import { Loader2, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { EventDetail } from '@/types';
import { useEvidenceUrl } from '@/hooks/useEvidenceUrl';
import styles from './event-detail-modal.module.css';

export function EventRecording({
  detail,
  isFire,
  isSyncing = false,
  onReload,
}: {
  detail: EventDetail | null;
  isFire: boolean;
  isSyncing?: boolean;
  onReload: () => void;
}) {
  const clip = detail?.media?.find((item) => item.mediaType === 'CLIP');
  const [failed, setFailed] = useState(false);
  const url = useEvidenceUrl(clip?.url ?? null, failed);
  useEffect(() => setFailed(false), [url]);
  if (!clip && !isFire) return null;

  return (
    <section
      className={isFire ? styles.fireRecordingStage : styles.recordingSection}
      aria-label="Video diễn biến sự kiện"
    >
      {!isFire && (
        <>
          <h3 className={styles.sectionTitle}>Video diễn biến sự kiện</h3>
          <p className={styles.mediaHint}>
            Xem lại thời điểm phát hiện và các giây trước, sau cảnh báo.
          </p>
        </>
      )}
      {url && !failed ? (
        <video
          className={styles.clipPlayer}
          src={url}
          controls
          playsInline
          preload="metadata"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className={styles.clipPlaceholder} role={failed ? 'alert' : 'status'}>
          {!failed && (isSyncing || !detail) && (
            <Loader2 size={20} className={styles.spinIcon} aria-hidden="true" />
          )}
          <p className={failed ? styles.clipPlaceholderError : styles.clipPlaceholderText}>
            {failed
              ? 'Chưa phát được clip. Hãy tải lại liên kết video.'
              : !detail
                ? 'Đang tải bản ghi camera…'
                : isSyncing
                  ? 'Camera đang tổng hợp clip diễn biến (thường sẵn sàng sau vài giây)…'
                  : 'Chưa có clip để phát. Kiểm tra camera đã bật ghi hình; bằng chứng sẽ cập nhật khi có bản ghi.'}
          </p>
          <button className={styles.retryEvidenceCompact} type="button" onClick={onReload}>
            <RefreshCw size={14} aria-hidden="true" />
            <span>Tải lại bằng chứng</span>
          </button>
        </div>
      )}
    </section>
  );
}
