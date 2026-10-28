'use client';

import { useState } from 'react';
import type { UIEventItem } from '@/types';
import { useDialogFocus } from '@/hooks/useDialogFocus';
import { useEventDetail } from '@/hooks/useEventDetail';
import { formatExactTime } from '@/lib/format';
import { EventDetailModal } from './EventDetailModal';
import { FireEmergencyCall } from './FireEmergencyCall';
import { EventSnapshot } from './EventEvidenceViewer';
import styles from './fire-attention.module.css';

interface FireAttentionProps {
  event: UIEventItem;
  onReviewed: () => void;
  onConfirmOk: (id: string, note?: string) => Promise<void>;
  onConfirmHelp: (id: string, note?: string) => Promise<void>;
  onCloseEmergency: (id: string, note?: string) => Promise<void>;
}

function AttentionSnapshot({ event }: { event: UIEventItem }) {
  const { detail } = useEventDetail(event);
  return <EventSnapshot event={event} detail={detail} compact />;
}

export function FireAttention(props: FireAttentionProps) {
  const [opened, setOpened] = useState(false);
  const ref = useDialogFocus(!opened);
  const { event, onReviewed } = props;
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
          <span aria-hidden="true">🔥</span> CẢNH BÁO KHẨN CẤP · P0
        </div>
        <h2 id="fire-attention-title">Phát hiện lửa / khói</h2>
        <div className={styles.location}>
          <strong>
            {event.camera?.name ?? 'Camera'}
            {event.zone?.name ? ` · ${event.zone.name}` : ''}
          </strong>
          <time dateTime={event.detectedAt}>Phát hiện: {formatExactTime(event.detectedAt)}</time>
        </div>
        <AttentionSnapshot event={event} />
        <p id="fire-attention-description">
          Xem bằng chứng và thời điểm phát hiện để kiểm tra cảnh báo.
        </p>
        <div className={styles.actions}>
          <button type="button" className={styles.inspect} onClick={() => setOpened(true)}>
            Xem chi tiết ngay
          </button>
          <FireEmergencyCall />
        </div>
      </div>
    </div>
  );
}
