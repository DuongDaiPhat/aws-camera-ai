'use client';

import { useEffect, useRef } from 'react';
import styles from './zones.module.css';

export function DeleteZoneDialog({
  zoneName,
  cameraName,
  isBusy,
  onCancel,
  onConfirm,
}: {
  zoneName: string;
  cameraName: string;
  isBusy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => cancelRef.current?.focus(), []);
  return (
    <div className={styles.backdrop} role="presentation" onMouseDown={onCancel}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-zone-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3 id="delete-zone-title">Xóa vùng “{zoneName}”?</h3>
        <p>Vùng sẽ bị xóa khỏi camera “{cameraName}”. Lịch sử sự kiện vẫn giữ tên vùng.</p>
        <div className={styles.formActions}>
          <button ref={cancelRef} type="button" onClick={onCancel}>
            Giữ lại
          </button>
          <button
            type="button"
            className={styles.dangerButton}
            disabled={isBusy}
            onClick={onConfirm}
          >
            {isBusy ? 'Đang xóa…' : 'Xóa vùng'}
          </button>
        </div>
      </div>
    </div>
  );
}
