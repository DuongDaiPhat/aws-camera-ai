'use client';

import { ChevronRight, X } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useState } from 'react';
import type { EventDetail, UIEventItem } from '@/types';
import { useEventDetail } from '@/hooks/useEventDetail';
import { useDialogFocus } from '@/hooks/useDialogFocus';
import { formatExactTime, getEventTypeLabel, getPriorityInfo } from '@/lib/format';
import {
  CameraLensFluentIcon,
  ClockFluentIcon,
  FlameFluentIcon,
  ZonePinFluentIcon,
} from './FireAlertIcons';
import styles from './event-detail-modal.module.css';
import { FireEvidenceSection } from './FireEvidenceSection';
import { EventEvidenceViewer } from './EventEvidenceViewer';
import { EventDetailFooter } from './EventDetailFooter';
import { EventNotifications } from './EventNotifications';
import { FireEventSummary } from './FireEventSummary';

interface EventDetailModalProps {
  event: UIEventItem | null;
  initialDetail?: EventDetail | null;
  refreshSignal?: number;
  onClose: () => void;
  onConfirmOk?: (eventId: string, note?: string) => Promise<void> | void;
  onConfirmHelp?: (eventId: string, note?: string) => Promise<void> | void;
  onCloseEmergency?: (eventId: string, note?: string) => Promise<void> | void;
  onToggleFalseAlarm?: (eventId: string) => void;
  requireReview?: boolean;
  mandatory?: boolean;
  onReview?: () => void;
  readOnly?: boolean;
  canCloseEmergency?: boolean;
}

const PERSON_STATUS_LABELS: Record<string, string> = {
  KNOWN: 'Người quen',
  UNKNOWN: 'Người lạ',
  UNDETERMINED: 'Chưa xác định được',
};

const EVENT_STATUS_LABELS: Record<string, string> = {
  DETECTED: 'Vừa phát hiện',
  LOGGED_ONLY: 'Chỉ ghi nhận',
  NOTIFIED: 'Đang chờ xác nhận',
  ESCALATED: 'Đang leo thang khẩn cấp',
  RESOLVED: 'Đã xác nhận an toàn',
  CLOSED: 'Đã đóng sự kiện',
  AI_FAILED: 'AI không phân tích được',
};

function mergeEventWithDetail(event: UIEventItem, detail: EventDetail | null): UIEventItem {
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

function useModalCountdown(deadlineAt: string | null | undefined): number | null {
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

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.detailItem}>
      <span className={styles.detailLabel}>{label}</span>
      <span className={styles.detailValue}>{value}</span>
    </div>
  );
}

function EventPropertyGrid({ event, detail }: { event: UIEventItem; detail: EventDetail | null }) {
  const priorityInfo = getPriorityInfo(event.priority);
  const confidenceText =
    typeof event.confidence === 'number' ? `${Math.round(event.confidence * 100)}%` : 'Chưa có';
  const personStatusText = event.personStatus
    ? (PERSON_STATUS_LABELS[event.personStatus] ?? event.personStatus)
    : 'Chưa phân tích';
  const location = [event.camera?.name, event.zone?.name].filter(Boolean).join(' — ');

  return (
    <div className={styles.detailGrid}>
      <DetailItem label="Loại sự kiện" value={getEventTypeLabel(event.eventType)} />
      <DetailItem label="Mức độ ưu tiên" value={priorityInfo.label} />
      <DetailItem label="Vị trí" value={location || 'Chưa gán camera'} />
      <DetailItem label="Độ tin cậy AI" value={confidenceText} />
      <DetailItem
        label="Trạng thái hiện tại"
        value={EVENT_STATUS_LABELS[event.status] ?? event.status}
      />
      <DetailItem label="Thời điểm phát hiện" value={formatExactTime(event.detectedAt)} />
      <DetailItem label="Nhận diện người" value={personStatusText} />
      <DetailItem label="Người quen khớp" value={event.matchedPersonName ?? 'Không'} />
      <DetailItem label="Nguồn sự kiện" value={detail?.source ?? 'Đang tải…'} />
      <DetailItem label="Mã track Frigate" value={detail?.trackId ?? 'Không có'} />
      <DetailItem label="Mô hình đại diện" value={detail?.aiModelVersion ?? 'Chưa có'} />
      <DetailItem
        label="AI xử lý lúc"
        value={detail?.aiProcessedAt ? formatExactTime(detail.aiProcessedAt) : 'Chưa có'}
      />
    </div>
  );
}

function AiResultSection({ detail }: { detail: EventDetail | null }) {
  const results = detail?.aiResults ?? [];
  if (results.length === 0) return null;

  return (
    <div className={styles.aiSection}>
      <h3 className={styles.sectionTitle}>Kết quả phân tích mô hình AI</h3>
      <div className={styles.aiPills}>
        {results.map((result) => (
          <div key={result.resultId} className={styles.aiPill}>
            <span>{result.module}:</span>
            <strong>
              {result.status === 'ERROR' ? `Lỗi ${result.error?.code ?? 'AI'}` : result.label}
            </strong>
            <span>
              {result.confidence === null
                ? '(Chưa xác định)'
                : `(${Math.round(result.confidence * 100)}%)`}
            </span>
            <span>• {formatExactTime(result.processedAt)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusHistorySection({ detail }: { detail: EventDetail | null }) {
  const history = detail?.statusHistory ?? [];
  if (history.length === 0) return null;

  return (
    <div className={styles.aiSection}>
      <h3 className={styles.sectionTitle}>Lịch sử trạng thái</h3>
      <ul className={styles.historyList}>
        {history.map((entry, index) => (
          <li key={`${entry.toStatus}-${index}`} className={styles.historyItem}>
            <span className={styles.historyTime}>{formatExactTime(entry.createdAt)}</span>
            <span>
              {EVENT_STATUS_LABELS[entry.toStatus] ?? entry.toStatus}
              {entry.reason ? ` — ${entry.reason}` : ''}
              {entry.actorName ? ` (${entry.actorName})` : ''}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FireDetailContent({
  event,
  detail,
  isLoading,
  isSyncing,
  reload,
}: {
  event: UIEventItem;
  detail: EventDetail | null;
  isLoading: boolean;
  isSyncing: boolean;
  reload: () => void;
}) {
  return (
    <>
      <div className={styles.fireLayout}>
        <EventEvidenceViewer
          event={event}
          detail={detail}
          onReload={reload}
          isLoading={isLoading}
          isSyncing={isSyncing}
        />
        <aside className={styles.fireInfo}>
          <FireEventSummary
            event={event}
            detail={detail}
            statusLabel={EVENT_STATUS_LABELS[event.status] ?? event.status}
            isSyncing={isSyncing}
          />
          <FireEvidenceSection detail={detail} isSyncing={isSyncing} />
        </aside>
      </div>
      <details className={styles.technicalDetails}>
        <summary className={styles.technicalSummary}>
          <ChevronRight size={15} className={styles.summaryChevron} aria-hidden="true" />
          <span>Thông tin phân tích và lịch sử xử lý</span>
        </summary>
        <div className={styles.technicalBody}>
          <p className={styles.mediaHint}>
            Mã sự kiện: <code>{event.id}</code>
          </p>
          <p className={styles.mediaHint}>Độ tin cậy AI không biểu thị kích thước đám cháy.</p>
          <AiResultSection detail={detail} />
          <StatusHistorySection detail={detail} />
        </div>
      </details>
    </>
  );
}

function ModalHeader({
  event,
  isFire,
  isUrgentActive,
  requireReview,
  mandatory,
  remainingSeconds,
  onClose,
}: {
  event: UIEventItem;
  isFire: boolean;
  isUrgentActive: boolean;
  requireReview: boolean;
  mandatory: boolean;
  remainingSeconds: number | null;
  onClose: () => void;
}) {
  return (
    <div
      className={`${styles.modalHeader} ${isFire ? (isUrgentActive ? styles.heroHeaderFire : styles.heroHeaderArgus) : ''}`}
    >
      {isFire && <span className={styles.heroOrnament} aria-hidden="true" />}
      <div className={styles.headerInfo}>
        {isFire && (
          <span
            className={`${styles.fireHeaderIcon} ${isUrgentActive ? styles.fireHeaderIconLive : ''}`}
            aria-hidden="true"
          >
            {isUrgentActive && <span className={styles.headerBeaconRing} />}
            <FlameFluentIcon size={26} />
          </span>
        )}
        <div className={styles.headerText}>
          <div className={styles.headerTitleRow}>
            <h2 id="modal-title" className={styles.modalTitle}>
              {isFire
                ? isUrgentActive
                  ? 'Cảnh báo khẩn cấp phát hiện lửa'
                  : 'Chi tiết sự kiện lửa'
                : 'Chi tiết sự kiện'}
            </h2>
            {isFire && (
              <span className={styles.heroPriorityPill}>
                {getPriorityInfo(event.priority).label}
              </span>
            )}
            {isFire && event.status === 'ESCALATED' && (
              <span className={`${styles.headerBadge} ${styles.headerBadgeDanger}`}>
                <span className={styles.headerLiveDot} aria-hidden="true" />
                Đang leo thang
              </span>
            )}
            {isFire && event.status === 'NOTIFIED' && remainingSeconds !== null && (
              <span className={`${styles.headerBadge} ${styles.headerBadgeWarning}`}>
                Leo thang sau {remainingSeconds}s
              </span>
            )}
          </div>
          {isFire && (
            <div className={styles.headerMetaStrip}>
              <span>
                <CameraLensFluentIcon size={14} />
                {event.camera?.name ?? 'Camera'}
              </span>
              {event.zone?.name && (
                <span>
                  <ZonePinFluentIcon size={14} />
                  {event.zone.name}
                </span>
              )}
              <span>
                <ClockFluentIcon size={14} />
                <time dateTime={event.detectedAt}>{formatExactTime(event.detectedAt)}</time>
              </span>
            </div>
          )}
        </div>
      </div>

      <div className={styles.headerTrailing}>
        {mandatory && <span className={styles.mandatoryBadge}>Bắt buộc xử lý</span>}
        {!requireReview && (
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Đóng">
            <X size={18} aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}

export function EventDetailModal({
  event,
  initialDetail = null,
  refreshSignal = 0,
  onClose,
  onConfirmOk,
  onConfirmHelp,
  onCloseEmergency,
  onToggleFalseAlarm,
  requireReview = false,
  mandatory = false,
  onReview,
  readOnly = false,
  canCloseEmergency = true,
}: EventDetailModalProps) {
  const { detail, isLoading, isSyncingEvidence, error, reload } = useEventDetail(event, {
    initialDetail,
    refreshSignal,
  });
  const reduceMotion = useReducedMotion();
  const effectiveEvent = event ? mergeEventWithDetail(event, detail) : null;
  const remainingSeconds = useModalCountdown(
    effectiveEvent?.status === 'NOTIFIED' ? effectiveEvent.escalationDeadlineAt : null,
  );
  const ref = useDialogFocus(Boolean(event), requireReview ? undefined : onClose);
  const [note, setNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (!effectiveEvent) return null;

  const isFire = effectiveEvent.eventType === 'FIRE_SMOKE_DETECTED';
  const isUrgentActive =
    isFire &&
    !effectiveEvent.isFalseAlarm &&
    ['DETECTED', 'NOTIFIED', 'ESCALATED'].includes(effectiveEvent.status);

  const handleAction = async (action: 'OK' | 'HELP' | 'CLOSE') => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setActionError(null);
    try {
      if (action === 'OK' && onConfirmOk) {
        await onConfirmOk(effectiveEvent.id, note.trim() || undefined);
      } else if (action === 'HELP' && onConfirmHelp) {
        await onConfirmHelp(effectiveEvent.id, note.trim() || undefined);
      } else if (action === 'CLOSE' && onCloseEmergency) {
        await onCloseEmergency(effectiveEvent.id, note.trim() || undefined);
      }
      if (!(mandatory && action === 'HELP')) onClose();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Có lỗi xảy ra khi xử lý sự kiện.';
      setActionError(
        message.includes('409') || message.includes('xử lý bởi người khác')
          ? 'Sự kiện đã được xử lý bởi người khác hoặc trạng thái đã thay đổi.'
          : message,
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <motion.div
        ref={ref}
        tabIndex={-1}
        className={`${styles.modal} ${isFire ? styles.fireModal : ''} ${isUrgentActive ? styles.fireModalActive : ''}`}
        initial={reduceMotion ? false : { opacity: 0, y: 14, scale: 0.975 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={
          reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 400, damping: 32 }
        }
      >
        <ModalHeader
          event={effectiveEvent}
          isFire={isFire}
          isUrgentActive={isUrgentActive}
          requireReview={requireReview}
          mandatory={mandatory}
          remainingSeconds={remainingSeconds}
          onClose={onClose}
        />

        <div className={styles.modalBody}>
          {isLoading && !detail && (
            <p className={styles.inlineNotice} role="status">
              Đang tải chi tiết sự kiện…
            </p>
          )}
          {error && (
            <div className={styles.errorBanner} role="alert">
              <span>{error}</span>
              <button className={styles.retryEvidence} type="button" onClick={reload}>
                Thử tải lại
              </button>
            </div>
          )}

          {isFire ? (
            <FireDetailContent
              event={effectiveEvent}
              detail={detail}
              isLoading={isLoading}
              isSyncing={isSyncingEvidence}
              reload={reload}
            />
          ) : (
            <>
              <EventEvidenceViewer
                event={effectiveEvent}
                detail={detail}
                onReload={reload}
                isLoading={isLoading}
              />
              <EventPropertyGrid event={effectiveEvent} detail={detail} />
              <AiResultSection detail={detail} />
              <StatusHistorySection detail={detail} />
            </>
          )}
          <EventNotifications
            key={effectiveEvent.id}
            eventId={effectiveEvent.id}
            eventStatus={effectiveEvent.status}
            refreshSignal={refreshSignal}
          />
        </div>

        {actionError && (
          <div className={styles.actionErrorNotice} role="alert">
            {actionError}
          </div>
        )}

        <EventDetailFooter
          event={effectiveEvent}
          note={note}
          onNote={setNote}
          submitting={isSubmitting}
          onAction={handleAction}
          onToggleFalseAlarm={onToggleFalseAlarm}
          requireReview={requireReview}
          mandatory={mandatory}
          canReview={Boolean(detail || error)}
          onReview={onReview}
          readOnly={readOnly}
          canCloseEmergency={canCloseEmergency}
        />
      </motion.div>
    </div>
  );
}
