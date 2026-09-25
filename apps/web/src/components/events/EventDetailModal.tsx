'use client';

import { useEffect, useState } from 'react';
import type { EventDetail, EventMedia, UIEventItem } from '@/types';
import { fetchEventDetail } from '@/lib/events-client';
import { formatExactTime, getEventTypeLabel, getPriorityInfo } from '@/lib/format';
import styles from './event-detail-modal.module.css';

interface EventDetailModalProps {
  event: UIEventItem | null;
  onClose: () => void;
  onConfirmOk?: (eventId: string, note?: string) => Promise<void> | void;
  onConfirmHelp?: (eventId: string, note?: string) => Promise<void> | void;
  onCloseEmergency?: (eventId: string, note?: string) => Promise<void> | void;
  onToggleFalseAlarm?: (eventId: string) => void;
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

function findMediaByType(media: EventMedia[] | undefined, mediaType: EventMedia['mediaType']) {
  return media?.find((item) => item.mediaType === mediaType) ?? null;
}

/**
 * Khung ảnh/video của sự kiện. Ưu tiên ảnh snapshot đầy đủ lấy từ
 * `/events/{id}/media`, nếu chưa có thì dùng thumbnail đã tải ở danh sách.
 */
function SnapshotPreview({ event, detail }: { event: UIEventItem; detail: EventDetail | null }) {
  const [hasImageError, setImageError] = useState(false);
  const snapshot = findMediaByType(detail?.media, 'SNAPSHOT');
  const snapshotUrl = snapshot?.url ?? event.thumbnailUrl ?? null;

  useEffect(() => {
    setImageError(false);
  }, [snapshotUrl]);

  return (
    <div className={styles.snapshotContainer}>
      {snapshotUrl && !hasImageError ? (
        <img
          className={styles.snapshotImage}
          src={snapshotUrl}
          alt={`Ảnh chụp sự kiện tại ${event.camera?.name ?? 'camera'}`}
          onError={() => setImageError(true)}
        />
      ) : (
        <>
          <div className={styles.snapshotGrid} aria-hidden="true" />
          <p className={styles.snapshotMissing}>
            {hasImageError
              ? 'Không tải được ảnh snapshot (liên kết có thể đã hết hạn).'
              : 'Sự kiện này chưa có ảnh snapshot từ camera.'}
          </p>
        </>
      )}

      <div className={styles.camWatermark}>
        <span className={styles.liveRecDot} aria-hidden="true" />
        <span>
          {event.camera?.name || 'Camera'} • {event.cameraCode}
        </span>
      </div>
      <div className={styles.timeWatermark}>{formatExactTime(event.detectedAt)}</div>
    </div>
  );
}

function ClipPlayer({ detail }: { detail: EventDetail | null }) {
  const clip = findMediaByType(detail?.media, 'CLIP');
  if (!clip) return null;

  return (
    <div className={styles.aiSection}>
      <h3 className={styles.sectionTitle}>Video clip của sự kiện</h3>
      {/* Clip ghi tu camera nen khong co phu de di kem */}
      <video className={styles.clipPlayer} src={clip.url} controls preload="metadata" />
    </div>
  );
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
        {results.map((result, index) => (
          <div key={`${result.module}-${index}`} className={styles.aiPill}>
            <span>{result.module}:</span>
            <strong>{result.label}</strong>
            <span>
              {result.confidence === null
                ? '(Chưa xác định)'
                : `(${Math.round(result.confidence * 100)}%)`}
            </span>
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

function useEventDetail(event: UIEventItem | null) {
  const [detail, setDetail] = useState<EventDetail | null>(null);
  const [isLoading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!event) {
      setDetail(null);
      setError(null);
      return;
    }

    let isMounted = true;
    setLoading(true);
    setError(null);

    fetchEventDetail(event.id)
      .then((data) => {
        if (isMounted) setDetail(data);
      })
      .catch(() => {
        // Vẫn hiển thị được các thông số đã có ở danh sách, chỉ thiếu phần chi tiết.
        if (isMounted) setError('Không tải được chi tiết đầy đủ của sự kiện này.');
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [event]);

  return { detail, isLoading, error };
}

export function EventDetailModal({
  event,
  onClose,
  onConfirmOk,
  onConfirmHelp,
  onCloseEmergency,
  onToggleFalseAlarm,
}: EventDetailModalProps) {
  const { detail, isLoading, error } = useEventDetail(event);
  const [note, setNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (!event) return null;

  const currentStatus = event.status;

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
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <div className={styles.headerInfo}>
            <h2 id="modal-title" className={styles.modalTitle}>
              Chi tiết sự kiện
            </h2>
          </div>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Đóng">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="18" x2="18" y2="6" />
            </svg>
          </button>
        </div>

        <div className={styles.modalBody}>
          {isLoading && (
            <p className={styles.inlineNotice} role="status">
              Đang tải chi tiết sự kiện…
            </p>
          )}
          {error && (
            <p className={styles.inlineNoticeError} role="alert">
              {error}
            </p>
          )}

          <SnapshotPreview event={event} detail={detail} />
          <EventPropertyGrid event={event} detail={detail} />
          <ClipPlayer detail={detail} />
          <AiResultSection detail={detail} />
          <StatusHistorySection detail={detail} />
        </div>

        {actionError && (
          <div className={styles.actionErrorNotice} role="alert">
            {actionError}
          </div>
        )}

        <div className={styles.modalFooter}>
          <div className={styles.footerActionsWrapper}>
            {(currentStatus === 'NOTIFIED' || currentStatus === 'ESCALATED') && (
              <input
                type="text"
                className={styles.noteInput}
                placeholder={
                  currentStatus === 'NOTIFIED'
                    ? 'Ghi chú xác nhận (không bắt buộc)...'
                    : 'Ghi chú kết quả xử lý khẩn cấp...'
                }
                value={note}
                onChange={(e) => setNote(e.target.value)}
                disabled={isSubmitting}
                maxLength={500}
              />
            )}

            <div className={styles.footerRow}>
              <button
                type="button"
                className={styles.btnFalseAlarm}
                onClick={() => onToggleFalseAlarm?.(event.id)}
                disabled={isSubmitting}
              >
                {event.isFalseAlarm ? 'Bỏ đánh dấu báo động giả' : 'Đánh dấu báo động giả'}
              </button>

              <div className={styles.actionButtonGroup}>
                {currentStatus === 'NOTIFIED' && (
                  <>
                    <button
                      type="button"
                      className={styles.btnOk}
                      onClick={() => handleAction('OK')}
                      disabled={isSubmitting}
                    >
                      {isSubmitting ? 'Đang gửi…' : '✅ Tôi ổn (An toàn)'}
                    </button>
                    <button
                      type="button"
                      className={styles.btnEscalate}
                      onClick={() => handleAction('HELP')}
                      disabled={isSubmitting}
                    >
                      {isSubmitting ? 'Đang gửi…' : '🆘 Cần giúp đỡ (Leo thang)'}
                    </button>
                  </>
                )}

                {currentStatus === 'ESCALATED' && (
                  <button
                    type="button"
                    className={styles.btnCloseEmergency}
                    onClick={() => handleAction('CLOSE')}
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? 'Đang đóng…' : '🏁 Đóng sự kiện khẩn cấp'}
                  </button>
                )}

                {currentStatus === 'RESOLVED' && (
                  <span className={styles.statusDoneBadge}>
                    ✅ Đã xác nhận an toàn
                  </span>
                )}

                {currentStatus === 'CLOSED' && (
                  <span className={styles.statusDoneBadge}>
                    🏁 Sự kiện khẩn cấp đã được đóng
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

