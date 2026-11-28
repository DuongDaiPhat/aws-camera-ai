'use client';

import { ArrowRight } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useState } from 'react';
import type { EventDetail, UIEventItem } from '@/types';
import { useDialogFocus } from '@/hooks/useDialogFocus';
import { useEventDetail } from '@/hooks/useEventDetail';
import { formatExactTime, getEventTypeLabel } from '@/lib/format';
import {
  CameraLensFluentIcon,
  ClockFluentIcon,
  FlameFluentIcon,
  SirenFluentIcon,
  ZonePinFluentIcon,
} from './FireAlertIcons';
import { EventDetailModal } from './EventDetailModal';
import { FireEmergencyCall } from './FireEmergencyCall';
import { EventSnapshot } from './EventEvidenceViewer';
import styles from './fire-attention.module.css';

interface FireAttentionProps {
  event: UIEventItem;
  mandatory?: boolean;
  refreshSignal?: number;
  onReviewed: () => void;
  onInspect: (eventId: string) => void;
  onConfirmOk: (id: string, note?: string) => Promise<void>;
  onConfirmHelp: (id: string, note?: string) => Promise<void>;
  onCloseEmergency: (id: string, note?: string) => Promise<void>;
  onToggleFalseAlarm?: (id: string) => void;
  canCloseEmergency?: boolean;
}

function useDeadlineSeconds(deadlineAt: string | null | undefined): number | null {
  const target = deadlineAt ? Date.parse(deadlineAt) : NaN;
  const [remaining, setRemaining] = useState<number | null>(() =>
    Number.isFinite(target) ? Math.max(0, Math.ceil((target - Date.now()) / 1000)) : null,
  );
  useEffect(() => {
    if (!Number.isFinite(target)) {
      setRemaining(null);
      return;
    }
    const tick = () => setRemaining(Math.max(0, Math.ceil((target - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [target]);
  return remaining;
}

function mergeLiveEvent(event: UIEventItem, detail: EventDetail | null): UIEventItem {
  if (!detail || detail.id !== event.id) return event;
  return {
    ...event,
    status: detail.status,
    priority: detail.priority,
    confidence: detail.confidence ?? event.confidence,
    camera: detail.camera ?? event.camera,
    zone: detail.zone ?? event.zone,
    escalationDeadlineAt: detail.escalationDeadlineAt ?? event.escalationDeadlineAt,
    isFalseAlarm: detail.isFalseAlarm ?? event.isFalseAlarm,
  };
}

function AttentionHero({
  event,
  isFire,
  remainingSeconds,
}: {
  event: UIEventItem;
  isFire: boolean;
  remainingSeconds: number | null;
}) {
  return (
    <div className={styles.heroBanner}>
      <span className={styles.heroOrnament} aria-hidden="true" />
      <div className={styles.heroRow}>
        <div className={styles.titleGroup}>
          <span className={styles.beaconBadge} aria-hidden="true">
            <span className={styles.beaconRing} />
            {isFire ? (
              <FlameFluentIcon size={28} className={styles.flameLive} />
            ) : (
              <SirenFluentIcon size={26} />
            )}
          </span>
          <div className={styles.titleBlock}>
            <div className={styles.titleRow}>
              <h2 id="fire-attention-title">{getEventTypeLabel(event.eventType)}</h2>
              <span className={styles.priorityPill}>Khẩn cấp P0</span>
            </div>
            <div className={styles.heroMetaRow}>
              <span className={styles.heroMetaItem}>
                <CameraLensFluentIcon size={15} />
                <strong>{event.camera?.name ?? 'Camera'}</strong>
              </span>
              {event.zone?.name && (
                <span className={styles.heroMetaItem}>
                  <ZonePinFluentIcon size={15} />
                  <span>{event.zone.name}</span>
                </span>
              )}
              <span className={styles.heroMetaItem}>
                <ClockFluentIcon size={15} />
                <time dateTime={event.detectedAt}>{formatExactTime(event.detectedAt)}</time>
              </span>
            </div>
          </div>
        </div>

        {event.status === 'ESCALATED' ? (
          <span className={styles.escalatedPill} role="status">
            <span className={styles.liveDot} aria-hidden="true" />
            Đang leo thang
          </span>
        ) : remainingSeconds !== null ? (
          <span className={styles.countdownPill} role="status">
            <span className={styles.countdownDot} aria-hidden="true" />
            Còn {remainingSeconds}s
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function FireAttention(props: FireAttentionProps) {
  const {
    event,
    mandatory = false,
    refreshSignal = 0,
    onReviewed,
    onInspect,
    onConfirmOk,
    onConfirmHelp,
    onCloseEmergency,
    onToggleFalseAlarm,
    canCloseEmergency = true,
  } = props;
  const [opened, setOpened] = useState(false);
  const reduceMotion = useReducedMotion();
  const { detail, isSyncingEvidence } = useEventDetail(event, { refreshSignal });
  const liveEvent = mergeLiveEvent(event, detail);
  const remainingSeconds = useDeadlineSeconds(
    liveEvent.status === 'NOTIFIED' ? liveEvent.escalationDeadlineAt : null,
  );
  const ref = useDialogFocus(!opened);

  if (opened) {
    return (
      <EventDetailModal
        event={liveEvent}
        initialDetail={detail}
        refreshSignal={refreshSignal}
        onClose={onReviewed}
        requireReview
        mandatory={mandatory}
        onReview={onReviewed}
        onConfirmOk={onConfirmOk}
        onConfirmHelp={onConfirmHelp}
        onCloseEmergency={onCloseEmergency}
        onToggleFalseAlarm={onToggleFalseAlarm}
        canCloseEmergency={canCloseEmergency}
      />
    );
  }

  const isFire = liveEvent.eventType === 'FIRE_SMOKE_DETECTED';

  return (
    <div className={styles.overlay}>
      <motion.div
        ref={ref}
        tabIndex={-1}
        className={styles.alert}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="fire-attention-title"
        aria-describedby="fire-attention-description"
        initial={reduceMotion ? false : { opacity: 0, y: 16, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={
          reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 30 }
        }
      >
        <AttentionHero event={liveEvent} isFire={isFire} remainingSeconds={remainingSeconds} />

        <div className={styles.body}>
          <div className={styles.mediaWrap}>
            <EventSnapshot
              event={liveEvent}
              detail={detail}
              compact
              isLoading={!detail && isSyncingEvidence}
            />
          </div>

          <p id="fire-attention-description" className={styles.description}>
            {mandatory
              ? 'Hệ thống phát hiện dấu hiệu lửa. Vui lòng mở kiểm tra bằng chứng và xác nhận tình trạng ngay.'
              : 'Xem bằng chứng và xác nhận tình trạng sự kiện.'}
            {liveEvent.status === 'NOTIFIED' && liveEvent.escalationDeadlineAt && (
              <>
                {' '}
                Tự động leo thang lúc{' '}
                <time dateTime={liveEvent.escalationDeadlineAt}>
                  {formatExactTime(liveEvent.escalationDeadlineAt)}
                </time>
                .
              </>
            )}
          </p>

          <div className={styles.actions}>
            {isFire && <FireEmergencyCall />}
            <motion.button
              type="button"
              className={styles.inspect}
              whileHover={reduceMotion ? undefined : { y: -1.5 }}
              whileTap={reduceMotion ? undefined : { scale: 0.98 }}
              onClick={() => {
                onInspect(liveEvent.id);
                setOpened(true);
              }}
            >
              <span>Kiểm tra &amp; xử lý ngay</span>
              <ArrowRight size={17} className={styles.inspectArrow} aria-hidden="true" />
            </motion.button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
