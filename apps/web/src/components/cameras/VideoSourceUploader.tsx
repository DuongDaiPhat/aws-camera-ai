'use client';

import { useEffect, useState } from 'react';
import { deleteCameraVideo, uploadCameraVideo } from '@/lib/cameras-client';
import styles from './styles/camera-source-form.module.css';

const MAX_VIDEO_BYTES = 500 * 1024 * 1024;
const SUPPORTED_VIDEO_EXTENSIONS = ['.mp4', '.mkv'];
const SUPPORTED_VIDEO_TYPES = ['video/mp4', 'video/x-matroska', 'video/mkv'];

interface VideoSourceUploaderProps {
  cameraId: string;
  initialLoop?: boolean;
  initialFileName?: string | null;
  isAdmin: boolean;
  onSourceUpdated: () => void;
}

export function validateVideoFile(file: File): string | null {
  const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
  const hasSupportedExtension = SUPPORTED_VIDEO_EXTENSIONS.includes(extension);
  const hasSupportedType = !file.type || SUPPORTED_VIDEO_TYPES.includes(file.type);

  if (!hasSupportedExtension || !hasSupportedType) {
    return 'Chỉ hỗ trợ file video MP4 hoặc MKV.';
  }
  if (file.size > MAX_VIDEO_BYTES) {
    return 'Dung lượng video không được vượt quá 500MB.';
  }
  return null;
}

export function formatVideoDuration(durationSeconds: number): string {
  const totalSeconds = Math.max(0, Math.round(durationSeconds));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function useVideoDuration(file: File | null): number | null {
  const [durationSeconds, setDurationSeconds] = useState<number | null>(null);

  useEffect(() => {
    if (!file || typeof document === 'undefined') {
      setDurationSeconds(null);
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () =>
      setDurationSeconds(Number.isFinite(video.duration) ? video.duration : null);
    video.onerror = () => setDurationSeconds(null);
    video.src = objectUrl;

    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  return durationSeconds;
}

interface VideoFilePickerProps {
  displayFileName: string | null;
  disabled: boolean;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

function VideoFilePicker({ displayFileName, disabled, onChange }: VideoFilePickerProps) {
  return (
    <div className={styles.formGroup}>
      <label className={styles.formLabel}>Chọn file video mẫu (.mp4, .mkv)</label>
      <label className={styles.fileUploadBox}>
        <input
          type="file"
          accept="video/mp4,video/x-matroska,video/mkv,.mp4,.mkv"
          className={styles.hiddenFileInput}
          onChange={onChange}
          disabled={disabled}
        />
        <svg
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
        <span className={styles.filePrompt}>
          {displayFileName ? 'Chọn video khác để thay thế' : 'Chọn video từ máy'}
        </span>
        <span className={styles.formHint}>Định dạng MP4/MKV, dung lượng tối đa 500MB</span>
      </label>
    </div>
  );
}

function VideoFileDetails({
  displayFileName,
  selectedFile,
  durationSeconds,
}: {
  displayFileName: string | null;
  selectedFile: File | null;
  durationSeconds: number | null;
}) {
  if (!displayFileName) return null;
  return (
    <div className={styles.fileInfoCard}>
      <div>
        <div className={styles.fileName}>{displayFileName}</div>
        <div className={styles.fileSize}>
          {selectedFile ? `${(selectedFile.size / (1024 * 1024)).toFixed(1)} MB` : 'Đã lưu'}
          {durationSeconds !== null ? ` · ${formatVideoDuration(durationSeconds)}` : ''}
        </div>
      </div>
      <span className={styles.fileReadyLabel}>
        {selectedFile ? 'Sẵn sàng tải' : 'Đang sử dụng'}
      </span>
    </div>
  );
}

function VideoUploadActions({
  canUpload,
  canDelete,
  isSaving,
  isDeleting,
  uploadProgress,
  onUpload,
  onDelete,
}: {
  canUpload: boolean;
  canDelete: boolean;
  isSaving: boolean;
  isDeleting: boolean;
  uploadProgress: number;
  onUpload: () => void;
  onDelete: () => void;
}) {
  return (
    <div className={styles.actionsRow}>
      <button
        type="button"
        className={styles.submitBtn}
        disabled={!canUpload || isSaving || isDeleting}
        onClick={onUpload}
      >
        {isSaving ? `Đang tải lên ${uploadProgress}%` : 'Lưu và kích hoạt nguồn Video'}
      </button>
      {canDelete ? (
        <button
          type="button"
          className={styles.stopBtn}
          disabled={isSaving || isDeleting}
          onClick={onDelete}
        >
          {isDeleting ? 'Đang xóa...' : 'Xóa video hiện tại'}
        </button>
      ) : null}
    </div>
  );
}

export function VideoSourceUploader({
  cameraId,
  initialLoop = true,
  initialFileName,
  isAdmin,
  onSourceUpdated,
}: VideoSourceUploaderProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [currentFileName, setCurrentFileName] = useState<string | null>(initialFileName ?? null);
  const [videoLoop, setVideoLoop] = useState(initialLoop);
  const durationSeconds = useVideoDuration(selectedFile);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const validationError = validateVideoFile(file);
    if (validationError) {
      event.target.value = '';
      setSelectedFile(null);
      setErrorMsg(validationError);
      return;
    }

    setSelectedFile(file);
    setUploadProgress(0);
    setSuccessMsg(null);
    setErrorMsg(null);
  };

  const handleUpload = async () => {
    if (!isAdmin || !selectedFile) return;
    setIsSaving(true);
    setUploadProgress(0);
    setSuccessMsg(null);
    setErrorMsg(null);

    try {
      const source = await uploadCameraVideo(cameraId, selectedFile, videoLoop, setUploadProgress);
      setUploadProgress(100);
      setCurrentFileName(source.videoOriginalName ?? selectedFile.name);
      setSelectedFile(null);
      setSuccessMsg('Đã tải video lên và cập nhật nguồn phát thành công.');
      onSourceUpdated();
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : 'Không thể tải video lên.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!isAdmin || !currentFileName) return;
    setIsDeleting(true);
    setSuccessMsg(null);
    setErrorMsg(null);
    try {
      await deleteCameraVideo(cameraId);
      setCurrentFileName(null);
      setSelectedFile(null);
      setUploadProgress(0);
      setSuccessMsg('Đã xóa video nguồn phát.');
      onSourceUpdated();
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : 'Không thể xóa video nguồn phát.');
    } finally {
      setIsDeleting(false);
    }
  };

  const displayFileName = selectedFile?.name ?? currentFileName;

  return (
    <div className={styles.formSection}>
      <p className={styles.formHint}>
        Video được tải lên hệ thống và Source Runner tự phát lặp qua MediaMTX. Bạn không cần chạy
        FFmpeg thủ công.
      </p>

      {successMsg && <div className={styles.successAlert}>{successMsg}</div>}
      {errorMsg && <div className={styles.errorAlert}>{errorMsg}</div>}

      <VideoFilePicker
        displayFileName={displayFileName}
        disabled={!isAdmin || isSaving || isDeleting}
        onChange={handleFileChange}
      />

      <VideoFileDetails
        displayFileName={displayFileName}
        selectedFile={selectedFile}
        durationSeconds={durationSeconds}
      />

      <div className={styles.formGroup}>
        <div className={styles.progressHeader}>
          <span className={styles.formLabel}>Tiến độ tải lên</span>
          <span className={styles.formHint}>{uploadProgress}%</span>
        </div>
        <progress className={styles.progressBar} value={uploadProgress} max={100} />
      </div>

      <div className={styles.formGroup}>
        <label className={styles.checkboxLabel}>
          <input
            type="checkbox"
            checked={videoLoop}
            onChange={(event) => setVideoLoop(event.target.checked)}
            disabled={!isAdmin || isSaving || isDeleting}
          />
          <span>Tự động phát lặp lại liên tục (Infinite Loop)</span>
        </label>
      </div>

      {isAdmin && (
        <VideoUploadActions
          canUpload={selectedFile !== null}
          canDelete={currentFileName !== null}
          isSaving={isSaving}
          isDeleting={isDeleting}
          uploadProgress={uploadProgress}
          onUpload={() => void handleUpload()}
          onDelete={() => void handleDelete()}
        />
      )}
    </div>
  );
}
