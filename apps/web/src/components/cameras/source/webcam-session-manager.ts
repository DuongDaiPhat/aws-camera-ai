import { useCallback, useEffect, useState } from 'react';
import { revokeBrowserPublishSession } from '@/lib/cameras-client';
import { publishWebcam } from './webcam-publish';

export interface WebcamSessionState {
  cameraId: string;
  stream: MediaStream | null;
  pc: RTCPeerConnection | null;
  deviceId: string;
  isPreviewing: boolean;
  isPublishing: boolean;
  isStarting: boolean;
  error: string | null;
}

const sessions = new Map<string, WebcamSessionState>();
const listeners = new Map<string, Set<(session: WebcamSessionState) => void>>();

function getOrCreateSession(cameraId: string): WebcamSessionState {
  let session = sessions.get(cameraId);
  if (!session) {
    session = {
      cameraId,
      stream: null,
      pc: null,
      deviceId: '',
      isPreviewing: false,
      isPublishing: false,
      isStarting: false,
      error: null,
    };
    sessions.set(cameraId, session);
  }
  return session;
}

export function getWebcamSession(cameraId: string): WebcamSessionState {
  return getOrCreateSession(cameraId);
}

function updateSession(cameraId: string, patch: Partial<WebcamSessionState>): WebcamSessionState {
  const current = getOrCreateSession(cameraId);
  const next: WebcamSessionState = { ...current, ...patch };
  sessions.set(cameraId, next);
  const subs = listeners.get(cameraId);
  if (subs) {
    subs.forEach((cb) => cb(next));
  }
  return next;
}

export function subscribeWebcamSession(
  cameraId: string,
  callback: (session: WebcamSessionState) => void,
): () => void {
  let set = listeners.get(cameraId);
  if (!set) {
    set = new Set();
    listeners.set(cameraId, set);
  }
  set.add(callback);
  return () => {
    set?.delete(callback);
  };
}

export function setWebcamDeviceId(cameraId: string, deviceId: string): void {
  updateSession(cameraId, { deviceId });
}

export function openWebcamStream(deviceId: string): Promise<MediaStream> {
  const videoConstraints: MediaTrackConstraints = {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    aspectRatio: { ideal: 16 / 9 },
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
  };
  return navigator.mediaDevices.getUserMedia({ video: videoConstraints });
}

export async function startWebcamPreview(
  cameraId: string,
  deviceId?: string,
): Promise<MediaStream> {
  const current = getOrCreateSession(cameraId);
  const targetDeviceId = deviceId !== undefined ? deviceId : current.deviceId;
  updateSession(cameraId, { error: null, deviceId: targetDeviceId });

  try {
    let stream = current.stream;
    if (!stream || !stream.active) {
      stream = await openWebcamStream(targetDeviceId);
    }
    updateSession(cameraId, { stream, isPreviewing: true, error: null });
    return stream;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Không thể truy cập webcam';
    updateSession(cameraId, { error: msg });
    throw err;
  }
}

export async function startWebcamPublish(
  cameraId: string,
  onSourceUpdated?: () => void,
): Promise<void> {
  const current = getOrCreateSession(cameraId);
  if (current.isStarting) return;
  updateSession(cameraId, { isStarting: true, error: null });

  try {
    let stream = current.stream;
    if (!stream || !stream.active) {
      stream = await startWebcamPreview(cameraId, current.deviceId);
    }
    const pc = await publishWebcam(cameraId, stream);
    updateSession(cameraId, { pc, isPublishing: true });

    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'failed') {
        updateSession(cameraId, { error: 'Kết nối webcam tới MediaMTX đã thất bại' });
        void stopWebcamSession(cameraId);
      }
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Lỗi truyền phát WHIP';
    updateSession(cameraId, { error: msg });
    void stopWebcamSession(cameraId);
    throw err;
  } finally {
    updateSession(cameraId, { isStarting: false });
    onSourceUpdated?.();
  }
}

export async function stopWebcamSession(cameraId: string): Promise<void> {
  const session = sessions.get(cameraId);
  if (!session) return;

  const hadPublisher = session.pc !== null;
  if (session.pc) {
    session.pc.close();
  }
  if (session.stream) {
    session.stream.getTracks().forEach((track) => track.stop());
  }
  updateSession(cameraId, {
    stream: null,
    pc: null,
    isPreviewing: false,
    isPublishing: false,
    isStarting: false,
  });

  if (hadPublisher) {
    try {
      await revokeBrowserPublishSession(cameraId);
    } catch {
      console.warn(`Không thể thu hồi phiên truyền phát webcam cho camera: ${cameraId}`);
    }
  }
}

export function stopAllWebcamSessions(): void {
  for (const [cameraId, session] of sessions.entries()) {
    if (session.pc) {
      session.pc.close();
    }
    if (session.stream) {
      session.stream.getTracks().forEach((t) => t.stop());
    }
    void revokeBrowserPublishSession(cameraId).catch(() => undefined);
  }
  sessions.clear();
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    stopAllWebcamSessions();
  });
}

export function useWebcamSession(cameraId: string) {
  const [session, setSession] = useState<WebcamSessionState>(() => getWebcamSession(cameraId));

  useEffect(() => {
    setSession(getWebcamSession(cameraId));
    const unsubscribe = subscribeWebcamSession(cameraId, (updated) => {
      setSession(updated);
    });
    return unsubscribe;
  }, [cameraId]);

  const startPreview = useCallback(
    (deviceId?: string) => startWebcamPreview(cameraId, deviceId),
    [cameraId],
  );

  const startPublish = useCallback(
    (onSourceUpdated?: () => void) => startWebcamPublish(cameraId, onSourceUpdated),
    [cameraId],
  );

  const stop = useCallback(() => stopWebcamSession(cameraId), [cameraId]);

  const setDeviceId = useCallback(
    (deviceId: string) => setWebcamDeviceId(cameraId, deviceId),
    [cameraId],
  );

  return {
    ...session,
    startPreview,
    startPublish,
    stop,
    setDeviceId,
  };
}
