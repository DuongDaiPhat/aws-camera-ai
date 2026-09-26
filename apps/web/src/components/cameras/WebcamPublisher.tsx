'use client';

import { useEffect, useRef, useState } from 'react';
import { useWebcamSession } from './source/webcam-session-manager';
import styles from './styles/camera-source-form.module.css';

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
        <strong>Lưu ý:</strong> Luồng phát webcam trực tiếp từ trình duyệt sử dụng giao thức WebRTC
        (WHIP). Luồng sẽ tiếp tục phát khi bạn chuyển tab hoặc xem trực tiếp, và chỉ dừng khi bạn
        bấm nút dừng phát hoặc đóng trình duyệt.
      </span>
    </div>
  );
}

export function WebcamPublisher({ cameraId, isAdmin, onSourceUpdated }: WebcamPublisherProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const {
    stream,
    deviceId,
    isPreviewing,
    isPublishing,
    isStarting,
    error,
    startPreview,
    startPublish,
    stop,
    setDeviceId,
  } = useWebcamSession(cameraId);

  useEffect(() => {
    async function loadDevices() {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return;
      try {
        const allDevices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = allDevices.filter((d) => d.kind === 'videoinput');
        setDevices(videoDevices);
        if (videoDevices.length > 0 && !deviceId) setDeviceId(videoDevices[0].deviceId);
      } catch {
        // bỏ qua nếu chưa được cấp quyền
      }
    }
    void loadDevices();
  }, [deviceId, setDeviceId]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  const handleStartPreview = async () => {
    try {
      await startPreview(deviceId);
    } catch {
      // error is recorded in session
    }
  };

  const handleStartPublish = async () => {
    if (!isAdmin || isStarting) return;
    try {
      await startPublish(onSourceUpdated);
    } catch {
      // error is recorded in session
    }
  };

  return (
    <div className={styles.formSection}>
      <WebcamNotice />

      {error && <div className={styles.errorAlert}>{error}</div>}

      <WebcamDevicePicker
        devices={devices}
        value={deviceId}
        disabled={isPreviewing || isPublishing}
        onChange={setDeviceId}
      />

      <div className={styles.webcamBox}>
        <video ref={videoRef} className={styles.videoPreview} autoPlay playsInline muted />

        <div className={styles.actionsRow}>
          {!isPreviewing && !isPublishing ? (
            <button
              type="button"
              className={styles.submitBtn}
              onClick={() => void handleStartPreview()}
            >
              Bật xem trước Webcam
            </button>
          ) : (
            <button type="button" className={styles.stopBtn} onClick={() => void stop()}>
              {isPublishing ? 'Dừng phát webcam' : 'Tắt xem trước'}
            </button>
          )}

          {isAdmin && isPreviewing && !isPublishing && (
            <button
              type="button"
              className={styles.submitBtn}
              disabled={isStarting}
              onClick={() => void handleStartPublish()}
            >
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
