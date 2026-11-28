'use client';

import { Loader2 } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import type { UIEventItem } from '@/types';
import {
  CheckBadgeFluentIcon,
  FlagAlertFluentIcon,
  ShieldCheckFluentIcon,
  SirenFluentIcon,
} from './FireAlertIcons';
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
  mandatory?: boolean;
  canReview: boolean;
  onReview?: () => void;
  readOnly?: boolean;
  canCloseEmergency?: boolean;
}

function ConfirmationButtons({
  event,
  submitting,
  onAction,
  canCloseEmergency = true,
}: Pick<FooterProps, 'event' | 'submitting' | 'onAction' | 'canCloseEmergency'>) {
  const reduceMotion = useReducedMotion();
  const hoverMotion = reduceMotion ? undefined : { y: -1.5 };
  const tapMotion = reduceMotion ? undefined : { scale: 0.97 };

  if (event.status === 'DETECTED') {
    return (
      <span className={styles.statusSyncBadge} role="status">
        <Loader2 size={15} className={styles.spinIcon} aria-hidden="true" />
        Đang kích hoạt trạng thái xử lý…
      </span>
    );
  }
  if (event.status === 'NOTIFIED') {
    return (
      <>
        <motion.button
          type="button"
          className={styles.btnOk}
          whileHover={hoverMotion}
          whileTap={tapMotion}
          onClick={() => void onAction('OK')}
          disabled={submitting}
        >
          <ShieldCheckFluentIcon size={19} className={styles.actionIconPulse} />
          <span>{submitting ? 'Đang gửi…' : 'Tôi ổn (An toàn)'}</span>
        </motion.button>
        <motion.button
          type="button"
          className={styles.btnEscalate}
          whileHover={hoverMotion}
          whileTap={tapMotion}
          onClick={() => void onAction('HELP')}
          disabled={submitting}
        >
          <SirenFluentIcon size={19} className={styles.actionIconShake} />
          <span>{submitting ? 'Đang gửi…' : 'Cần giúp đỡ (Leo thang)'}</span>
        </motion.button>
      </>
    );
  }
  if (event.status === 'ESCALATED') {
    if (!canCloseEmergency) {
      return (
        <span className={styles.statusUrgentBadge}>
          <SirenFluentIcon size={18} />
          Đang leo thang khẩn cấp
        </span>
      );
    }
    return (
      <motion.button
        type="button"
        className={styles.btnCloseEmergency}
        whileHover={hoverMotion}
        whileTap={tapMotion}
        onClick={() => void onAction('CLOSE')}
        disabled={submitting}
      >
        <CheckBadgeFluentIcon size={19} className={styles.actionIconPulse} />
        <span>{submitting ? 'Đang đóng…' : 'Đóng sự kiện khẩn cấp'}</span>
      </motion.button>
    );
  }
  if (event.status === 'RESOLVED' || event.status === 'CLOSED') {
    return (
      <span className={styles.statusDoneBadge}>
        <CheckBadgeFluentIcon size={18} />
        {event.status === 'RESOLVED' ? 'Đã xác nhận an toàn' : 'Sự kiện khẩn cấp đã được đóng'}
      </span>
    );
  }
  return null;
}

export function EventDetailFooter(props: FooterProps) {
  const {
    event,
    note,
    onNote,
    submitting,
    requireReview,
    mandatory = false,
    canReview,
    onReview,
    onToggleFalseAlarm,
    readOnly = false,
  } = props;
  const reduceMotion = useReducedMotion();
  if (readOnly) return null;

  const canEnterNote = event.status === 'NOTIFIED' || event.status === 'ESCALATED';
  const showDismissReview = requireReview && !mandatory;

  return (
    <div className={styles.modalFooter}>
      <div className={styles.footerActionsWrapper}>
        {canEnterNote && (
          <div className={styles.noteRow}>
            <input
              className={styles.noteInput}
              type="text"
              aria-label="Ghi chú xử lý"
              placeholder="Thêm ghi chú xử lý sự kiện (không bắt buộc)…"
              value={note}
              onChange={({ currentTarget }) => onNote(currentTarget.value)}
              disabled={submitting}
              maxLength={500}
            />
          </div>
        )}

        <div className={styles.footerRow}>
          <div className={styles.footerLeading}>
            {event.eventType === 'FIRE_SMOKE_DETECTED' && <FireEmergencyCall />}
            {onToggleFalseAlarm && (
              <motion.button
                type="button"
                className={styles.btnFalseAlarm}
                whileHover={reduceMotion ? undefined : { y: -1 }}
                whileTap={reduceMotion ? undefined : { scale: 0.97 }}
                onClick={() => onToggleFalseAlarm(event.id)}
                disabled={submitting}
              >
                <FlagAlertFluentIcon size={17} className={styles.flagIconWave} />
                <span>
                  {event.isFalseAlarm ? 'Bỏ đánh dấu báo động giả' : 'Đánh dấu báo động giả'}
                </span>
              </motion.button>
            )}
            {showDismissReview && (
              <motion.button
                type="button"
                className={styles.reviewButton}
                whileHover={reduceMotion ? undefined : { y: -1 }}
                whileTap={reduceMotion ? undefined : { scale: 0.97 }}
                aria-label="Đã xem cảnh báo, tiếp tục xử lý"
                onClick={onReview}
                disabled={!canReview}
              >
                Đã xem cảnh báo
              </motion.button>
            )}
          </div>
          <div className={styles.confirmationActions}>
            <ConfirmationButtons {...props} />
          </div>
        </div>

        {mandatory && (
          <p className={styles.reviewHint}>
            Cảnh báo lửa yêu cầu xác nhận an toàn hoặc đóng sự kiện trước khi rời khỏi màn hình này.
          </p>
        )}
        {showDismissReview && (
          <p className={styles.reviewHint}>Đã xem cảnh báo không đồng nghĩa xác nhận an toàn.</p>
        )}
      </div>
    </div>
  );
}
