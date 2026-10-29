'use client';

import { useState } from 'react';
import type { EventDetail, UIEventItem } from '@/types';
import { useEventDetail } from '@/hooks/useEventDetail';
import { useDialogFocus } from '@/hooks/useDialogFocus';
import { formatExactTime, getEventTypeLabel, getPriorityInfo } from '@/lib/format';
import styles from './event-detail-modal.module.css';
import { FireEvidenceSection } from './FireEvidenceSection';
import { EventEvidenceViewer } from './EventEvidenceViewer';
import { EventDetailFooter } from './EventDetailFooter';
import { FireEventSummary } from './FireEventSummary';

interface EventDetailModalProps {
  event: UIEventItem | null;
  onClose: () => void;
  onConfirmOk?: (eventId: string, note?: string) => Promise<void> | void;
  onConfirmHelp?: (eventId: string, note?: string) => Promise<void> | void;
  onCloseEmergency?: (eventId: string, note?: string) => Promise<void> | void;
  onToggleFalseAlarm?: (eventId: string) => void;
  requireReview?: boolean;
  onReview?: () => void;
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
  reload,
}: {
  event: UIEventItem;
  detail: EventDetail | null;
  reload: () => void;
}) {
  return (
    <>
      <div className={styles.fireLayout}>
        <EventEvidenceViewer event={event} detail={detail} onReload={reload} />
        <aside className={styles.fireInfo}>
          <FireEventSummary
            event={event}
            detail={detail}
            statusLabel={EVENT_STATUS_LABELS[event.status] ?? event.status}
          />
          <FireEvidenceSection detail={detail} />
        </aside>
      </div>
      <details className={styles.technicalDetails}>
        <summary>Thông tin phân tích và lịch sử xử lý</summary>
        <p className={styles.mediaHint}>Mã sự kiện: {event.id}</p>
        <p className={styles.mediaHint}>Độ tin cậy AI không biểu thị kích thước đám cháy.</p>
        <AiResultSection detail={detail} />
        <StatusHistorySection detail={detail} />
      </details>
    </>
  );
}

export function EventDetailModal({
  event,
  onClose,
  onConfirmOk,
  onConfirmHelp,
  onCloseEmergency,
  onToggleFalseAlarm,
  requireReview = false,
  onReview,
}: EventDetailModalProps) {
  const { detail, isLoading, error, reload } = useEventDetail(event);
  const ref = useDialogFocus(Boolean(event), requireReview ? undefined : onClose);
  const [note, setNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (!event) return null;

  const isFire = event.eventType === 'FIRE_SMOKE_DETECTED';

  const handleAction = async (action: 'OK' | 'HELP' | 'CLOSE') => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setActionError(null);

    try {
      if (action === 'OK' && onConfirmOk) {
        await onConfirmOk(event.id, note.trim() || undefined);
      } else if (action === 'HELP' && onConfirmHelp) {
        await onConfirmHelp(event.id, note.trim() || undefined);
      } else if (action === 'CLOSE' && onCloseEmergency) {
        await onCloseEmergency(event.id, note.trim() || undefined);
      }
      onClose();
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
      <div ref={ref} tabIndex={-1} className={`${styles.modal} ${isFire ? styles.fireModal : ''}`}>
        <div className={styles.modalHeader}>
          <div className={styles.headerInfo}>
            <h2 id="modal-title" className={styles.modalTitle}>
              {isFire ? 'Chi tiết sự kiện lửa' : 'Chi tiết sự kiện'}
            </h2>
            {isFire && (
              <time className={styles.headerTime} dateTime={event.detectedAt}>
                Phát hiện: {formatExactTime(event.detectedAt)}
              </time>
            )}
          </div>
          {!requireReview && (
            <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Đóng">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                aria-hidden="true"
                focusable="false"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>

        <div className={styles.modalBody}>
          {isLoading && !detail && (
            <p className={styles.inlineNotice} role="status">
              Đang tải chi tiết sự kiện…
            </p>
          )}
          {error && (
            <p className={styles.inlineNoticeError} role="alert">
              {error}
            </p>
          )}

          {error && (
            <button className={styles.retryEvidence} type="button" onClick={reload}>
              Thử tải lại bằng chứng
            </button>
          )}

          {isFire ? (
            <FireDetailContent event={event} detail={detail} reload={reload} />
          ) : (
            <>
              <EventEvidenceViewer event={event} detail={detail} onReload={reload} />
              <EventPropertyGrid event={event} detail={detail} />
              <AiResultSection detail={detail} />
              <StatusHistorySection detail={detail} />
            </>
          )}
        </div>

        {actionError && (
          <div className={styles.actionErrorNotice} role="alert">
            {actionError}
          </div>
        )}

        <EventDetailFooter
          event={event}
          note={note}
          onNote={setNote}
          submitting={isSubmitting}
          onAction={handleAction}
          onToggleFalseAlarm={onToggleFalseAlarm}
          requireReview={requireReview}
          canReview={Boolean(detail || error)}
          onReview={onReview}
        />
      </div>
    </div>
  );
}
