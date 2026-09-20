'use client';

import { useEffect, useState } from 'react';
import type { UIEventItem, EventDetail } from '@/lib/mock-events';
import { getMockEventDetail } from '@/lib/mock-events';
import styles from './event-detail-modal.module.css';

interface EventDetailModalProps {
  event: UIEventItem | null;
  onClose: () => void;
  onConfirmOk?: (eventId: string) => void;
  onConfirmHelp?: (eventId: string) => void;
  onToggleFalseAlarm?: (eventId: string) => void;
}

function SnapshotPreview({ event }: { event: UIEventItem }) {
  return (
    <div className={styles.snapshotContainer} aria-hidden="true">
      <div className={styles.snapshotGrid} />
      <div className={styles.camWatermark}>
        <span className={styles.liveRecDot} />
        <span>
          {event.camera?.name || 'Camera'} • {event.cameraCode}
        </span>
      </div>
      <div className={styles.boundingBox}>
        <span className={styles.bboxLabel}>{event.aiTag}</span>
      </div>
      <div className={styles.timeWatermark}>
        {new Date(event.detectedAt).toLocaleString('vi-VN')}
      </div>
    </div>
  );
}

function EventPropertyGrid({ event }: { event: UIEventItem }) {
  return (
    <div className={styles.detailGrid}>
      <div className={styles.detailItem}>
        <span className={styles.detailLabel}>Loại sự kiện</span>
        <span className={styles.detailValue}>{event.eventType}</span>
      </div>
      <div className={styles.detailItem}>
        <span className={styles.detailLabel}>Mức độ ưu tiên</span>
        <span className={styles.detailValue}>
          {event.priority} {event.priority === 'P0' ? '(Khẩn cấp)' : '(Cảnh báo)'}
        </span>
      </div>
      <div className={styles.detailItem}>
        <span className={styles.detailLabel}>Vị trí</span>
        <span className={styles.detailValue}>
          {event.camera?.name} — {event.zone?.name || 'Khu vực chính'}
        </span>
      </div>
      <div className={styles.detailItem}>
        <span className={styles.detailLabel}>Độ tin cậy AI</span>
        <span className={styles.detailValue}>
          {event.confidence ? `${(event.confidence * 100).toFixed(0)}%` : 'N/A'}
        </span>
      </div>
      <div className={styles.detailItem}>
        <span className={styles.detailLabel}>Trạng thái hiện tại</span>
        <span className={styles.detailValue}>{event.status}</span>
      </div>
      <div className={styles.detailItem}>
        <span className={styles.detailLabel}>Thời điểm phát hiện</span>
        <span className={styles.detailValue}>
          {new Date(event.detectedAt).toLocaleString('vi-VN')}
        </span>
      </div>
    </div>
  );
}

export function EventDetailModal({
  event,
  onClose,
  onConfirmOk,
  onConfirmHelp,
  onToggleFalseAlarm,
}: EventDetailModalProps) {
  const [detail, setDetail] = useState<EventDetail | null>(null);

  useEffect(() => {
    if (!event) {
      setDetail(null);
      return;
    }
    setDetail(getMockEventDetail(event));
  }, [event]);

  if (!event || !detail) return null;

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
          <SnapshotPreview event={event} />
          <EventPropertyGrid event={event} />

          <div className={styles.aiSection}>
            <h3 className={styles.sectionTitle}>Kết quả phân tích mô hình AI</h3>
            <div className={styles.aiPills}>
              {detail.aiResults?.map((res, i) => (
                <div key={i} className={styles.aiPill}>
                  <span>{res.module}:</span>
                  <strong>{res.label}</strong>
                  <span>({(res.confidence * 100).toFixed(0)}%)</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className={styles.modalFooter}>
          <button
            type="button"
            className={styles.btnFalseAlarm}
            onClick={() => onToggleFalseAlarm?.(event.id)}
          >
            {event.isFalseAlarm ? 'Bỏ đánh dấu báo động giả' : 'Đánh dấu báo động giả'}
          </button>
          <div className={styles.actionButtonGroup}>
            <button type="button" className={styles.btnOk} onClick={() => onConfirmOk?.(event.id)}>
              ✅ Tôi ổn (An toàn)
            </button>
            <button
              type="button"
              className={styles.btnEscalate}
              onClick={() => onConfirmHelp?.(event.id)}
            >
              🆘 Cần giúp đỡ (Leo thang)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
