'use client';

import { useEffect, useState } from 'react';
import type { EventDetail } from '@/types';
import { useEvidenceUrl } from '@/hooks/useEvidenceUrl';
import styles from './event-detail-modal.module.css';

export function EventRecording({
  detail,
  isFire,
  onReload,
}: {
  detail: EventDetail | null;
  isFire: boolean;
  onReload: () => void;
}) {
  const clip = detail?.media?.find((item) => item.mediaType === 'CLIP');
  const [failed, setFailed] = useState(false);
  const url = useEvidenceUrl(clip?.url ?? null, failed);
  useEffect(() => setFailed(false), [url]);
  if (!clip && !isFire) return null;
  return (
    <section className={styles.recordingSection} aria-label="Video diễn biến sự kiện">
      <h3 className={styles.sectionTitle}>Video diễn biến sự kiện</h3>
      <p className={styles.mediaHint}>
        Xem lại thời điểm phát hiện và các giây trước, sau cảnh báo.
      </p>
      {url ? (
        <video
          className={styles.clipPlayer}
          src={url}
          controls
          playsInline
          preload="metadata"
          onError={() => setFailed(true)}
        />
      ) : (
        <p className={styles.inlineNotice} role="status">
          {detail
            ? 'Chưa có clip để phát. Kiểm tra camera đã bật ghi hình; bằng chứng sẽ cập nhật khi có bản ghi.'
            : 'Đang tải bản ghi camera…'}
        </p>
      )}
      {failed && (
        <p className={styles.inlineNoticeError} role="alert">
          Chưa phát được clip. Hãy tải lại liên kết video.
        </p>
      )}
      {(!url || failed) && (
        <button className={styles.retryEvidence} type="button" onClick={onReload}>
          Tải lại bằng chứng
        </button>
      )}
    </section>
  );
}
