'use client';

import { useState } from 'react';
import type { CameraSourceType } from '@/types';
import { updateCameraSource } from '@/lib/cameras-client';
import { WebcamPublisher } from './WebcamPublisher';
import { VideoSourceUploader } from './VideoSourceUploader';
import styles from './styles/camera-source-form.module.css';

interface RtspFormProps {
  cameraId: string;
  initialRtspUrl?: string | null;
  isAdmin: boolean;
  onSourceUpdated?: () => void;
}

function RtspSourceForm({ cameraId, initialRtspUrl, isAdmin, onSourceUpdated }: RtspFormProps) {
  const [rtspUrl, setRtspUrl] = useState<string>(initialRtspUrl ?? '');
  const [transport, setTransport] = useState<'TCP' | 'UDP'>('TCP');
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    setIsSaving(true);
    setSuccessMsg(null);
    setErrorMsg(null);

    try {
      await updateCameraSource(cameraId, {
        sourceType: 'RTSP',
        rtspUrl,
        transport,
        videoLoop: true,
      });
      setSuccessMsg('Đã cập nhật nguồn phát RTSP thành công!');
      onSourceUpdated?.();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Lỗi khi cập nhật cấu hình RTSP');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form className={styles.formSection} onSubmit={handleSave}>
      <p className={styles.formHint}>
        Kết nối luồng RTSP tiêu chuẩn từ camera an ninh vật lý (IP Camera / NVR).
      </p>

      {successMsg && <div className={styles.successAlert}>{successMsg}</div>}
      {errorMsg && <div className={styles.errorAlert}>{errorMsg}</div>}

      <div className={styles.formGroup}>
        <label className={styles.formLabel}>RTSP Stream URL</label>
        <input
          type="text"
          className={styles.formInput}
          placeholder="rtsp://admin:password@192.168.1.100:554/stream1"
          value={rtspUrl}
          onChange={(e) => setRtspUrl(e.target.value)}
          disabled={!isAdmin || isSaving}
          required
        />
        <span className={styles.formHint}>
          Mật khẩu trong URL sẽ được tự động bảo mật theo chuẩn NFR-09 và không bị lộ ra giao diện.
        </span>
      </div>

      <div className={styles.formGroup}>
        <label className={styles.formLabel}>Giao thức truyền tải (Transport Protocol)</label>
        <div className={styles.radioGroup}>
          <label className={styles.radioLabel}>
            <input
              type="radio"
              name="transport"
              value="TCP"
              checked={transport === 'TCP'}
              onChange={() => setTransport('TCP')}
              disabled={!isAdmin || isSaving}
            />
            <span>TCP (Độ tin cậy cao, khuyên dùng)</span>
          </label>
          <label className={styles.radioLabel}>
            <input
              type="radio"
              name="transport"
              value="UDP"
              checked={transport === 'UDP'}
              onChange={() => setTransport('UDP')}
              disabled={!isAdmin || isSaving}
            />
            <span>UDP (Độ trễ thấp)</span>
          </label>
        </div>
      </div>

      {isAdmin && (
        <button type="submit" className={styles.submitBtn} disabled={isSaving}>
          {isSaving ? 'Đang lưu...' : 'Lưu cấu hình RTSP'}
        </button>
      )}
    </form>
  );
}

interface CameraSourceFormProps {
  cameraId: string;
  slug: string;
  initialSourceType?: CameraSourceType;
  initialRtspUrl?: string | null;
  isAdmin: boolean;
  onSourceUpdated?: () => void;
}

export function CameraSourceForm({
  cameraId,
  slug,
  initialSourceType = 'RTSP',
  initialRtspUrl,
  isAdmin,
  onSourceUpdated,
}: CameraSourceFormProps) {
  const [activeTab, setActiveTab] = useState<CameraSourceType>(initialSourceType);

  return (
    <div className={styles.container}>
      <div className={styles.subTabs}>
        <button
          type="button"
          className={`${styles.subTabBtn} ${activeTab === 'RTSP' ? styles.subTabBtnActive : ''}`}
          onClick={() => setActiveTab('RTSP')}
        >
          Nguồn RTSP Trực tiếp
        </button>
        <button
          type="button"
          className={`${styles.subTabBtn} ${activeTab === 'BROWSER_WEBCAM' ? styles.subTabBtnActive : ''}`}
          onClick={() => setActiveTab('BROWSER_WEBCAM')}
        >
          Webcam Trình duyệt (WHIP)
        </button>
        <button
          type="button"
          className={`${styles.subTabBtn} ${activeTab === 'VIDEO_FILE' ? styles.subTabBtnActive : ''}`}
          onClick={() => setActiveTab('VIDEO_FILE')}
        >
          Phát lặp từ File Video
        </button>
      </div>

      {activeTab === 'RTSP' && (
        <RtspSourceForm
          cameraId={cameraId}
          initialRtspUrl={initialRtspUrl}
          isAdmin={isAdmin}
          onSourceUpdated={onSourceUpdated}
        />
      )}

      {activeTab === 'BROWSER_WEBCAM' && (
        <WebcamPublisher
          cameraId={cameraId}
          slug={slug}
          isAdmin={isAdmin}
          onSourceUpdated={onSourceUpdated}
        />
      )}

      {activeTab === 'VIDEO_FILE' && (
        <VideoSourceUploader
          cameraId={cameraId}
          isAdmin={isAdmin}
          onSourceUpdated={() => onSourceUpdated?.()}
        />
      )}
    </div>
  );
}
