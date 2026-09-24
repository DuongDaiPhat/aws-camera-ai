'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createBrowserPublishSession } from '@/lib/cameras-client';
import styles from './camera-source-form.module.css';

interface WebcamPublisherProps {
  cameraId: string;
  slug: string;
  isAdmin: boolean;
  onSourceUpdated?: () => void;
}

async function publishWhipStream(
  cameraId: string,
  stream: MediaStream,
): Promise<RTCPeerConnection> {
  const session = await createBrowserPublishSession(cameraId);
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  });

  stream.getTracks().forEach((track) => pc.addTrack(track, stream));

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  const res = await fetch(session.publishUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/sdp' },
    body: offer.sdp,
  });

  if (!res.ok) throw new Error(`Lỗi kết nối WebRTC server (${res.status})`);
  const answerSdp = await res.text();
  await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: answerSdp }));

  return pc;
}

export function WebcamPublisher({
  cameraId,
  isAdmin,
}: WebcamPublisherProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [isPreviewing, setIsPreviewing] = useState<boolean>(false);
  const [isPublishing, setIsPublishing] = useState<boolean>(false);
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
  }, []);

  useEffect(() => () => stopAll(), [stopAll]);

  const startPreview = async () => {
    setError(null);
    try {
      const constraints: MediaStreamConstraints = {
        video: selectedDeviceId ? { deviceId: { exact: selectedDeviceId } } : true,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setIsPreviewing(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể truy cập webcam');
    }
  };

  const startPublish = async () => {
    if (!isAdmin) return;
    setError(null);
    try {
      if (!streamRef.current) await startPreview();
      const stream = streamRef.current;
      if (!stream) throw new Error('Không có luồng video');
      pcRef.current = await publishWhipStream(cameraId, stream);
      setIsPublishing(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lỗi truyền phát WHIP');
      stopAll();
    }
  };

  return (
    <div className={styles.formSection}>
      <div className={styles.webcamNotice}>
        <span>⚠️</span>
        <span>
          <strong>Lưu ý:</strong> Luồng phát webcam trực tiếp từ trình duyệt sử dụng giao thức WebRTC (WHIP). Luồng sẽ dừng nếu bạn đóng tab hoặc rời khỏi trang này.
        </span>
      </div>

      {error && <div className={styles.errorAlert}>{error}</div>}

      <div className={styles.formGroup}>
        <label className={styles.formLabel}>Chọn thiết bị Webcam máy tính</label>
        <select
          className={styles.formSelect}
          value={selectedDeviceId}
          disabled={isPreviewing || isPublishing}
          onChange={(e) => setSelectedDeviceId(e.target.value)}
        >
          {devices.map((d, idx) => (
            <option key={d.deviceId || idx} value={d.deviceId}>
              {d.label || `Camera ${idx + 1}`}
            </option>
          ))}
          {devices.length === 0 && <option value="">Mặc định trình duyệt</option>}
        </select>
      </div>

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
            <button type="button" className={styles.submitBtn} onClick={() => void startPublish()}>
              Bắt đầu truyền phát WHIP
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
