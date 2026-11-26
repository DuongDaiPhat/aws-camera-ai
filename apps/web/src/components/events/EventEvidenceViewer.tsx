'use client';

import { RefreshCw } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useId, useState } from 'react';
import type { EventDetail, UIEventItem } from '@/types';
import { useEvidenceUrl } from '@/hooks/useEvidenceUrl';
import { formatExactTime } from '@/lib/format';
import { SnapshotFrameFluentIcon, VideoReelFluentIcon } from './FireAlertIcons';
import { FireBoxes } from './FireEvidenceSection';
import { EventRecording } from './EventRecording';
import styles from './event-detail-modal.module.css';

export function EventSnapshot({
  event,
  detail,
  compact = false,
  isLoading = false,
}: {
  event: UIEventItem;
  detail: EventDetail | null;
  compact?: boolean;
  isLoading?: boolean;
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
        <div className={styles.snapshotEmptyState}>
          {isLoading && <div className={styles.mediaSkeleton} aria-hidden="true" />}
          <p className={styles.snapshotMissing}>
            {failed && compact
              ? 'Ảnh chưa sẵn sàng. Mở chi tiết để kiểm tra bằng chứng.'
              : failed
                ? 'Chưa tải được ảnh. Bấm tải lại bằng chứng để làm mới liên kết.'
                : isLoading
                  ? 'Đang tải ảnh bằng chứng từ camera…'
                  : 'Ảnh camera chưa sẵn sàng.'}
          </p>
        </div>
      )}
      {url && !failed && <FireBoxes detail={detail} {...size} />}
      <div className={styles.camWatermark}>
        <span className={styles.liveRecDot} aria-hidden="true" />
        <span>
          {event.camera?.name ?? 'Camera'} · {event.cameraCode}
        </span>
      </div>
      <div className={styles.timeWatermark}>{formatExactTime(event.detectedAt)}</div>
    </div>
  );
}

export function EventEvidenceViewer({
  event,
  detail,
  onReload,
  isLoading = false,
  isSyncing = false,
}: {
  event: UIEventItem;
  detail: EventDetail | null;
  onReload: () => void;
  isLoading?: boolean;
  isSyncing?: boolean;
}) {
  const [mode, setMode] = useState<'snapshot' | 'video'>('snapshot');
  const [spinTick, setSpinTick] = useState(0);
  const reduceMotion = useReducedMotion();
  const switchId = useId();
  const isFire = event.eventType === 'FIRE_SMOKE_DETECTED';
  const hasClip = Boolean(detail?.media?.some((item) => item.mediaType === 'CLIP'));

  return (
    <section className={styles.evidenceColumn} aria-label="Ảnh và video bằng chứng">
      {isFire && (
        <div className={styles.mediaToolbar}>
          <div className={styles.mediaSwitch} role="group" aria-label="Chọn bằng chứng">
            <button
              type="button"
              className={styles.mediaTabBtn}
              aria-pressed={mode === 'snapshot'}
              onClick={() => setMode('snapshot')}
            >
              {mode === 'snapshot' && (
                <motion.span
                  layoutId={`media-pill-${switchId}`}
                  className={styles.mediaTabPill}
                  transition={
                    reduceMotion
                      ? { duration: 0 }
                      : { type: 'spring', stiffness: 440, damping: 34, mass: 0.75 }
                  }
                />
              )}
              <SnapshotFrameFluentIcon size={17} className={styles.mediaTabIcon} />
              <span className={styles.mediaTabLabel}>Ảnh khoanh vùng</span>
            </button>
            <button
              type="button"
              className={styles.mediaTabBtn}
              aria-pressed={mode === 'video'}
              onClick={() => setMode('video')}
            >
              {mode === 'video' && (
                <motion.span
                  layoutId={`media-pill-${switchId}`}
                  className={styles.mediaTabPill}
                  transition={
                    reduceMotion
                      ? { duration: 0 }
                      : { type: 'spring', stiffness: 440, damping: 34, mass: 0.75 }
                  }
                />
              )}
              <VideoReelFluentIcon size={17} className={styles.mediaTabIcon} />
              <span className={styles.mediaTabLabel}>Xem video diễn biến</span>
              {!hasClip && isSyncing && <span className={styles.clipPendingTag}>Đang tạo</span>}
            </button>
          </div>
          <motion.button
            className={styles.reloadButton}
            type="button"
            whileHover={reduceMotion ? undefined : { scale: 1.05 }}
            whileTap={reduceMotion ? undefined : { scale: 0.93 }}
            onClick={() => {
              setSpinTick((value) => value + 1);
              onReload();
            }}
            aria-label="Tải lại bằng chứng"
            title="Tải lại bằng chứng"
          >
            <motion.span
              className={styles.reloadIconWrap}
              animate={reduceMotion ? undefined : { rotate: spinTick * 360 }}
              transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
            >
              <RefreshCw
                size={15}
                className={isLoading ? styles.spinIcon : undefined}
                aria-hidden="true"
              />
            </motion.span>
          </motion.button>
        </div>
      )}

      {isFire ? (
        <AnimatePresence mode="wait" initial={false}>
          {mode === 'snapshot' ? (
            <motion.div
              key="snapshot"
              initial={reduceMotion ? false : { opacity: 0, scale: 0.985 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={reduceMotion ? undefined : { opacity: 0, scale: 0.985 }}
              transition={{ duration: reduceMotion ? 0 : 0.18, ease: [0.16, 1, 0.3, 1] }}
            >
              <EventSnapshot event={event} detail={detail} isLoading={isLoading && !detail} />
            </motion.div>
          ) : (
            <motion.div
              key="video"
              initial={reduceMotion ? false : { opacity: 0, scale: 0.985 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={reduceMotion ? undefined : { opacity: 0, scale: 0.985 }}
              transition={{ duration: reduceMotion ? 0 : 0.18, ease: [0.16, 1, 0.3, 1] }}
            >
              <EventRecording
                detail={detail}
                isFire={isFire}
                isSyncing={isSyncing}
                onReload={onReload}
              />
            </motion.div>
          )}
        </AnimatePresence>
      ) : (
        <>
          <EventSnapshot event={event} detail={detail} isLoading={isLoading && !detail} />
          <EventRecording
            detail={detail}
            isFire={false}
            isSyncing={isSyncing}
            onReload={onReload}
          />
        </>
      )}
    </section>
  );
}
