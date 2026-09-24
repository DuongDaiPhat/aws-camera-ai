'use client';

import { useState } from 'react';
import { updateCameraSource } from '@/lib/cameras-client';
import styles from './camera-source-form.module.css';

interface VideoSourceUploaderProps {
  cameraId: string;
  initialLoop?: boolean;
  initialFileName?: string | null;
  isAdmin: boolean;
  onSourceUpdated: () => void;
}

export function VideoSourceUploader({
  cameraId,
  initialLoop = true,
  initialFileName,
  isAdmin,
  onSourceUpdated,
}: VideoSourceUploaderProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [videoLoop, setVideoLoop] = useState<boolean>(initialLoop);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
      setSuccessMsg(null);
      setErrorMsg(null);
    }
  };

  const handleSave = async () => {
    if (!isAdmin) return;
    setIsSaving(true);
    setSuccessMsg(null);
    setErrorMsg(null);

    try {
      await updateCameraSource(cameraId, {
        sourceType: 'VIDEO_FILE',
        videoLoop,
        transport: 'TCP',
      });
      setSuccessMsg('Đã cập nhật cấu hình nguồn video lặp thành công!');
      onSourceUpdated();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Lỗi khi cập nhật nguồn video');
    } finally {
      setIsSaving(false);
    }
  };

  const displayFileName = selectedFile ? selectedFile.name : initialFileName;

  return (
    <div className={styles.formSection}>
      <p className={styles.formHint}>
        Nguồn video cho phép mô phỏng luồng camera thực tế bằng cách phát lặp lại một file video mẫu qua FFmpeg.
      </p>

      {successMsg && <div className={styles.successAlert}>{successMsg}</div>}
      {errorMsg && <div className={styles.errorAlert}>{errorMsg}</div>}

      <div className={styles.formGroup}>
        <label className={styles.formLabel}>Chọn file video mẫu (.mp4, .mkv)</label>
        <label className={styles.fileUploadBox}>
          <input
            type="file"
            accept="video/mp4,video/x-matroska,video/mkv"
            style={{ display: 'none' }}
            onChange={handleFileChange}
            disabled={!isAdmin || isSaving}
          />
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <span style={{ fontSize: '13px', fontWeight: 600 }}>
            {selectedFile ? 'Bấm để đổi file video khác' : 'Bấm để chọn file video từ máy'}
          </span>
          <span className={styles.formHint}>Dung lượng tối đa hỗ trợ: 500MB</span>
        </label>
      </div>

      {displayFileName && (
        <div className={styles.fileInfoCard}>
          <div>
            <div className={styles.fileName}>{displayFileName}</div>
            {selectedFile && (
              <div className={styles.fileSize}>
                {(selectedFile.size / (1024 * 1024)).toFixed(1)} MB
              </div>
            )}
          </div>
          <span style={{ fontSize: '11px', color: '#059669', fontWeight: 600 }}>Đã chọn</span>
        </div>
      )}

      <div className={styles.formGroup}>
        <label className={styles.checkboxLabel}>
          <input
            type="checkbox"
            checked={videoLoop}
            onChange={(e) => setVideoLoop(e.target.checked)}
            disabled={!isAdmin || isSaving}
          />
          <span>Tự động phát lặp lại liên tục (Infinite Loop)</span>
        </label>
      </div>

      {isAdmin && (
        <button
          type="button"
          className={styles.submitBtn}
          disabled={isSaving}
          onClick={() => void handleSave()}
        >
          {isSaving ? 'Đang lưu...' : 'Lưu và kích hoạt nguồn Video'}
        </button>
      )}
    </div>
  );
}
