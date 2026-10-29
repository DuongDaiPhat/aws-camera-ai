'use client';

import { useEffect, useState } from 'react';
import type { EventDetail, UIEventItem } from '@/types';
import { useEvidenceUrl } from '@/hooks/useEvidenceUrl';
import { formatExactTime } from '@/lib/format';
import { FireBoxes } from './FireEvidenceSection';
import { EventRecording } from './EventRecording';
import styles from './event-detail-modal.module.css';

export function EventSnapshot({
  event,
  detail,
  compact = false,
}: {
  event: UIEventItem;
  detail: EventDetail | null;
  compact?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const snapshot = detail?.media?.find((item) => item.mediaType === 'SNAPSHOT');
  const url = useEvidenceUrl(snapshot?.url ?? event.thumbnailUrl ?? null, failed);
  useEffect(() => {
    setFailed(false);
    setSize({ width: 0, height: 0 });
  }, [url]);
  return (
    <div
      className={`${styles.snapshotContainer} ${event.eventType === 'FIRE_SMOKE_DETECTED' ? styles.fireSnapshot : ''} ${compact ? styles.compactSnapshot : ''}`}
    >
      {url && !failed ? (
        <img
          className={styles.snapshotImage}
          src={url}
          alt={`Ảnh chụp sự kiện tại ${event.camera?.name ?? 'camera'}`}
          onError={() => setFailed(true)}
          onLoad={({ currentTarget }) =>
            setSize({ width: currentTarget.naturalWidth, height: currentTarget.naturalHeight })
          }
        />
      ) : (
        <p className={styles.snapshotMissing}>
          {failed && compact
            ? 'Ảnh chưa sẵn sàng. Mở chi tiết để kiểm tra bằng chứng.'
            : failed
              ? 'Chưa tải được ảnh. Bấm tải lại bằng chứng để làm mới liên kết.'
              : 'Ảnh camera chưa sẵn sàng.'}
        </p>
      )}
      {url && !failed && <FireBoxes detail={detail} {...size} />}
      <div className={styles.camWatermark}>
        {event.camera?.name ?? 'Camera'} · {event.cameraCode}
      </div>
      <div className={styles.timeWatermark}>{formatExactTime(event.detectedAt)}</div>
    </div>
  );
}

export function EventEvidenceViewer({
  event,
  detail,
  onReload,
}: {
  event: UIEventItem;
  detail: EventDetail | null;
  onReload: () => void;
}) {
  const [mode, setMode] = useState<'snapshot' | 'video'>('snapshot');
  const isFire = event.eventType === 'FIRE_SMOKE_DETECTED';
  return (
    <section aria-label="Ảnh và video bằng chứng">
      {isFire && (
        <div className={styles.mediaSwitch} aria-label="Chọn bằng chứng">
          <button
            type="button"
            aria-pressed={mode === 'snapshot'}
            onClick={() => setMode('snapshot')}
          >
            Ảnh khoanh vùng
          </button>
          <button type="button" aria-pressed={mode === 'video'} onClick={() => setMode('video')}>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
              focusable="false"
            >
              <path d="m8 5 11 7-11 7z" />
            </svg>
            Xem video diễn biến
          </button>
          <button
            className={styles.reloadButton}
            type="button"
            onClick={onReload}
            aria-label="Tải lại bằng chứng"
            title="Tải lại bằng chứng"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M21 12a9 9 0 1 1-9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
              <path d="M21 3v5h-5" />
            </svg>
          </button>
        </div>
      )}
      {(!isFire || mode === 'snapshot') && <EventSnapshot event={event} detail={detail} />}
      {(!isFire || mode === 'video') && (
        <EventRecording detail={detail} isFire={isFire} onReload={onReload} />
      )}
    </section>
  );
}
