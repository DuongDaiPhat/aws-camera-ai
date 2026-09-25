'use client';

import React, { useState } from 'react';
import type { Camera } from '@/types';
import { retryFrigateSync } from '@/lib/cameras-client';
import styles from './styles/camera-view.module.css';

interface CameraSettingsPanelProps {
  camera: Camera;
  isAdmin: boolean;
  onSynced?: () => void;
}

export function CameraSettingsPanel({ camera, isAdmin, onSynced }: CameraSettingsPanelProps) {
  const [isRetrying, setIsRetrying] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const resolution =
    camera.detectWidth && camera.detectHeight
      ? `${camera.detectWidth}x${camera.detectHeight}`
      : '1280x720';

  const handleRetrySync = async () => {
    setIsRetrying(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await retryFrigateSync(camera.id);
      if (res.syncStatus === 'SYNCED') {
        setSuccessMsg(`Đồng bộ Frigate thành công! Phiên bản cấu hình: v${res.configVersion}`);
        onSynced?.();
      } else {
        setErrorMsg('Đồng bộ Frigate thất bại hoặc đang chờ xử lý.');
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Lỗi khi gọi API đồng bộ Frigate');
    } finally {
      setIsRetrying(false);
    }
  };

  return (
    <div className={styles.sourceFormContainer} style={{ marginTop: '16px' }}>
      <div className={styles.infoNotice}>
        <strong>🛡️ Bảo toàn Polygon Zones (US-12 Handoff):</strong> Cấu hình Frigate của camera này
        được đồng bộ an toàn qua Mutex Lock, bảo toàn 100% các vùng đa giác do Thành viên C thiết
        lập.
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '16px',
          marginTop: '16px',
        }}
      >
        <div className={styles.summaryCard}>
          <span className={styles.summaryLabel}>Độ phân giải nhận diện</span>
          <span className={styles.summaryValue}>{resolution}</span>
        </div>
        <div className={styles.summaryCard}>
          <span className={styles.summaryLabel}>Khung hình trên giây (FPS)</span>
          <span className={styles.summaryValue}>{camera.fps} FPS</span>
        </div>
        <div className={styles.summaryCard}>
          <span className={styles.summaryLabel}>Phiên bản cấu hình</span>
          <span className={styles.summaryValue}>v{camera.configVersion}</span>
        </div>
        <div className={styles.summaryCard}>
          <span className={styles.summaryLabel}>Trạng thái đồng bộ</span>
          <span
            className={`${styles.summaryValue} ${camera.syncStatus === 'SYNCED' ? styles.summaryValueOnline : styles.summaryValueErrors}`}
          >
            {camera.syncStatus}
          </span>
        </div>
      </div>

      {successMsg && (
        <div
          className={styles.infoNotice}
          style={{
            background: 'rgba(16, 185, 129, 0.1)',
            borderColor: '#10b981',
            color: '#10b981',
            marginTop: '16px',
          }}
        >
          {successMsg}
        </div>
      )}

      {errorMsg && (
        <div
          className={styles.infoNotice}
          style={{
            background: 'rgba(239, 68, 68, 0.1)',
            borderColor: '#ef4444',
            color: '#ef4444',
            marginTop: '16px',
          }}
        >
          {errorMsg}
        </div>
      )}

      {isAdmin && (
        <div style={{ marginTop: '20px' }}>
          <button
            type="button"
            className={styles.addBtn}
            disabled={isRetrying}
            onClick={handleRetrySync}
          >
            {isRetrying && <span className={styles.spinner} style={{ marginRight: '8px' }} />}
            {isRetrying ? 'Đang gửi cấu hình...' : 'Đồng bộ lại xuống Frigate'}
          </button>
        </div>
      )}
    </div>
  );
}
