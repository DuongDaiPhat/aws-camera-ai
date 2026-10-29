import type { UIEventItem } from '@/types';
import { FireEmergencyCall } from './FireEmergencyCall';
import styles from './event-detail-modal.module.css';

interface FooterProps {
  event: UIEventItem;
  note: string;
  onNote: (note: string) => void;
  submitting: boolean;
  onAction: (action: 'OK' | 'HELP' | 'CLOSE') => Promise<void>;
  onToggleFalseAlarm?: (eventId: string) => void;
  requireReview: boolean;
  canReview: boolean;
  onReview?: () => void;
}

function ConfirmationButtons({
  event,
  submitting,
  onAction,
}: Pick<FooterProps, 'event' | 'submitting' | 'onAction'>) {
  if (event.status === 'NOTIFIED')
    return (
      <>
        <button
          type="button"
          className={styles.btnOk}
          onClick={() => void onAction('OK')}
          disabled={submitting}
        >
          {submitting ? 'Đang gửi…' : '✅ Tôi ổn (An toàn)'}
        </button>
        <button
          type="button"
          className={styles.btnEscalate}
          onClick={() => void onAction('HELP')}
          disabled={submitting}
        >
          {submitting ? 'Đang gửi…' : '🆘 Cần giúp đỡ (Leo thang)'}
        </button>
      </>
    );
  if (event.status === 'ESCALATED')
    return (
      <button
        type="button"
        className={styles.btnCloseEmergency}
        onClick={() => void onAction('CLOSE')}
        disabled={submitting}
      >
        {submitting ? 'Đang đóng…' : 'Đóng sự kiện khẩn cấp'}
      </button>
    );
  if (event.status === 'RESOLVED' || event.status === 'CLOSED')
    return (
      <span className={styles.statusDoneBadge}>
        {event.status === 'RESOLVED' ? '✅ Đã xác nhận an toàn' : 'Sự kiện khẩn cấp đã được đóng'}
      </span>
    );
  return null;
}

export function EventDetailFooter(props: FooterProps) {
  const {
    event,
    note,
    onNote,
    submitting,
    requireReview,
    canReview,
    onReview,
    onToggleFalseAlarm,
  } = props;
  return (
    <div className={styles.modalFooter}>
      <div className={styles.footerActionsWrapper}>
        <div className={styles.footerRow}>
          {event.eventType === 'FIRE_SMOKE_DETECTED' && <FireEmergencyCall />}
          {requireReview && (
            <button
              type="button"
              className={styles.reviewButton}
              aria-label="Đã xem cảnh báo, tiếp tục xử lý"
              onClick={onReview}
              disabled={!canReview}
            >
              Đã xem cảnh báo
            </button>
          )}
          <div className={styles.confirmationActions}>
            <ConfirmationButtons {...props} />
          </div>
        </div>
        <div className={styles.noteRow}>
          {(event.status === 'NOTIFIED' || event.status === 'ESCALATED') && (
            <input
              className={styles.noteInput}
              type="text"
              aria-label="Ghi chú xử lý"
              placeholder="Ghi chú xử lý (không bắt buộc)…"
              value={note}
              onChange={({ currentTarget }) => onNote(currentTarget.value)}
              disabled={submitting}
              maxLength={500}
            />
          )}
          {onToggleFalseAlarm && (
            <button
              type="button"
              className={styles.btnFalseAlarm}
              onClick={() => onToggleFalseAlarm(event.id)}
              disabled={submitting}
            >
              {event.isFalseAlarm ? 'Bỏ đánh dấu báo động giả' : 'Đánh dấu báo động giả'}
            </button>
          )}
        </div>
        {requireReview && (
          <p className={styles.reviewHint}>Đã xem cảnh báo không đồng nghĩa xác nhận an toàn.</p>
        )}
      </div>
    </div>
  );
}
