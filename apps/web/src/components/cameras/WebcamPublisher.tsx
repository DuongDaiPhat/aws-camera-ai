'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { revokeBrowserPublishSession } from '@/lib/cameras-client';
import { publishWebcam } from './webcam-publish';
import styles from './camera-source-form.module.css';

interface WebcamPublisherProps {
  cameraId: string;
  slug: string;
  isAdmin: boolean;
  onSourceUpdated?: () => void;
}

function WebcamDevicePicker({
  devices,
  value,
  disabled,
  onChange,
}: {
  devices: MediaDeviceInfo[];
  value: string;
  disabled: boolean;
  onChange: (deviceId: string) => void;
}) {
  return (
    <div className={styles.formGroup}>
      <label className={styles.formLabel}>Chọn thiết bị Webcam máy tính</label>
      <select
        className={styles.formSelect}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {devices.map((device, index) => (
          <option key={device.deviceId || index} value={device.deviceId}>
            {device.label || `Camera ${index + 1}`}
          </option>
        ))}
        {devices.length === 0 && <option value="">Mặc định trình duyệt</option>}
      </select>
    </div>
  );
}

function WebcamNotice() {
  return (
    <div className={styles.webcamNotice}>
      <span>⚠️</span>
      <span>
        <strong>Lưu ý:</strong> Luồng phát webcam trực tiếp từ trình duyệt sử dụng giao thức WebRTC (WHIP). Luồng sẽ dừng nếu bạn đóng tab hoặc rời khỏi trang này.
      </span>
    </div>
  );
}

function openWebcam(deviceId: string): Promise<MediaStream> {
  const video = deviceId ? { deviceId: { exact: deviceId } } : true;
  return navigator.mediaDevices.getUserMedia({ video });
}

export function WebcamPublisher({
  cameraId,
  isAdmin,
  onSourceUpdated,
}: WebcamPublisherProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [isPreviewing, setIsPreviewing] = useState<boolean>(false);
  const [isPublishing, setIsPublishing] = useState<boolean>(false);
  const [isStarting, setIsStarting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadDevices() {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return;
      try {
        const allDevices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = allDevices.filter((d) => d.kind === 'videoinput');
        setDevices(videoDevices);
        if (videoDevices.length > 0) setSelectedDeviceId(videoDevices[0].deviceId);
      } catch {
        // bỏ qua nếu chưa được cấp quyền
      }
    }
    void loadDevices();
  }, []);

  const stopAll = useCallback(() => {
    const hadPublisher = pcRef.current !== null;
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setIsPreviewing(false);
    setIsPublishing(false);
    if (hadPublisher) {
      void revokeBrowserPublishSession(cameraId).catch(() => {
        console.warn('Không thể thu hồi phiên truyền phát webcam');
      });
    }
  }, [cameraId]);

  useEffect(() => () => stopAll(), [stopAll]);

  const startPreview = async () => {
    setError(null);
    try {
      const stream = await openWebcam(selectedDeviceId);
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setIsPreviewing(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể truy cập webcam');
    }
  };

  const startPublish = async () => {
    if (!isAdmin || isStarting) return;
    setIsStarting(true);
    setError(null);
    try {
      if (!streamRef.current) await startPreview();
      const stream = streamRef.current;
      if (!stream) throw new Error('Không có luồng video');
      const pc = await publishWebcam(cameraId, stream);
      pcRef.current = pc;
      pc.addEventListener('connectionstatechange', () => {
        if (pc.connectionState !== 'failed') return;
        setError('Kết nối webcam tới MediaMTX đã thất bại');
        stopAll();
      });
      setIsPublishing(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lỗi truyền phát WHIP');
      stopAll();
    } finally {
      setIsStarting(false);
      onSourceUpdated?.();
    }
  };

  return (
    <div className={styles.formSection}>
      <WebcamNotice />

      {error && <div className={styles.errorAlert}>{error}</div>}

      <WebcamDevicePicker
        devices={devices}
        value={selectedDeviceId}
        disabled={isPreviewing || isPublishing}
        onChange={setSelectedDeviceId}
      />

      <div className={styles.webcamBox}>
        <video ref={videoRef} className={styles.videoPreview} autoPlay playsInline muted />

        <div className={styles.actionsRow}>
          {!isPreviewing && !isPublishing ? (
            <button type="button" className={styles.submitBtn} onClick={() => void startPreview()}>
              Bật xem trước Webcam
            </button>
          ) : (
            <button type="button" className={styles.stopBtn} onClick={stopAll}>
              Tắt xem trước
            </button>
          )}

          {isAdmin && isPreviewing && !isPublishing && (
            <button type="button" className={styles.submitBtn} disabled={isStarting} onClick={() => void startPublish()}>
              {isStarting ? 'Đang kết nối...' : 'Bắt đầu truyền phát WHIP'}
            </button>
          )}

          {isPublishing && (
            <span style={{ fontSize: '13px', color: '#059669', fontWeight: 600 }}>
              ● Đang truyền phát trực tiếp lên MediaMTX
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
