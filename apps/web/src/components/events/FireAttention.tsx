'use client';

import { Siren } from 'lucide-react';
import { useState } from 'react';
import type { UIEventItem } from '@/types';
import { useDialogFocus } from '@/hooks/useDialogFocus';
import { useEventDetail } from '@/hooks/useEventDetail';
import { formatExactTime, getEventTypeLabel } from '@/lib/format';
import { EventDetailModal } from './EventDetailModal';
import { FireEmergencyCall } from './FireEmergencyCall';
import { EventSnapshot } from './EventEvidenceViewer';
import styles from './fire-attention.module.css';

interface FireAttentionProps {
  event: UIEventItem;
  onReviewed: () => void;
  onInspect: (eventId: string) => void;
  onConfirmOk: (id: string, note?: string) => Promise<void>;
  onConfirmHelp: (id: string, note?: string) => Promise<void>;
  onCloseEmergency: (id: string, note?: string) => Promise<void>;
  canCloseEmergency?: boolean;
}

function AttentionSnapshot({ event }: { event: UIEventItem }) {
  const { detail } = useEventDetail(event);
  return <EventSnapshot event={event} detail={detail} compact />;
}

export function FireAttention(props: FireAttentionProps) {
  const [opened, setOpened] = useState(false);
  const ref = useDialogFocus(!opened);
  const { event, onReviewed, onInspect } = props;
  if (opened)
    return <EventDetailModal {...props} onClose={onReviewed} requireReview onReview={onReviewed} />;
  return (
    <div className={styles.overlay}>
      <div
        ref={ref}
        tabIndex={-1}
        className={styles.alert}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="fire-attention-title"
        aria-describedby="fire-attention-description"
      >
        <div className={styles.alarmLabel}>
          <Siren size={17} aria-hidden="true" /> CẢNH BÁO KHẨN CẤP · P0
        </div>
        <h2 id="fire-attention-title">{getEventTypeLabel(event.eventType)}</h2>
        <div className={styles.location}>
          <strong>
            {event.camera?.name ?? 'Camera'}
            {event.zone?.name ? ` · ${event.zone.name}` : ''}
          </strong>
          <time dateTime={event.detectedAt}>Phát hiện: {formatExactTime(event.detectedAt)}</time>
        </div>
        <AttentionSnapshot event={event} />
        <p id="fire-attention-description">
          Xem bằng chứng và xác nhận tình trạng.
          {event.status === 'NOTIFIED' && event.escalationDeadlineAt && (
            <>
              {' '}
              Hạn xác nhận{' '}
              <time dateTime={event.escalationDeadlineAt}>
                {formatExactTime(event.escalationDeadlineAt)}
              </time>
              .
            </>
          )}
        </p>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.inspect}
            onClick={() => {
              onInspect(event.id);
              setOpened(true);
            }}
          >
            Xem chi tiết ngay
          </button>
          {event.eventType === 'FIRE_SMOKE_DETECTED' && <FireEmergencyCall />}
        </div>
      </div>
    </div>
  );
}
