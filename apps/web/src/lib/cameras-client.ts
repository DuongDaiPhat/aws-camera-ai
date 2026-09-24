import { apiFetch } from './api-client';
import type {
  Camera,
  CameraPreview,
  CameraSourceDetail,
  UpdateCameraRequest,
  UpdateCameraSourceRequest,
  UpdateCameraStateRequest,
} from '@/types';

interface ListCamerasResponse {
  data: Camera[];
}

export interface ListCamerasQuery {
  deviceId?: string;
  isEnabled?: boolean;
}

export interface BrowserPublishSession {
  publishUrl: string;
  streamKey: string;
  expiresAt: string;
}

export interface FrigateSyncRetryResponse {
  cameraId: string;
  configVersion: number;
  syncStatus: 'PENDING' | 'SYNCED' | 'FAILED';
}

/**
 * Lấy danh sách camera từ Orchestrator.
 */
export async function fetchCameras(query?: ListCamerasQuery): Promise<Camera[]> {
  const params = new URLSearchParams();
  if (query?.deviceId) params.append('deviceId', query.deviceId);
  if (query?.isEnabled !== undefined) params.append('isEnabled', String(query.isEnabled));

  const qs = params.toString() ? `?${params.toString()}` : '';
  const res = await apiFetch<ListCamerasResponse>(`/cameras${qs}`);
  return Array.isArray(res.data) ? res.data : [];
}

/**
 * Lấy chi tiết một camera theo ID.
 */
export function fetchCamera(cameraId: string): Promise<Camera> {
  return apiFetch<Camera>(`/cameras/${encodeURIComponent(cameraId)}`);
}

/**
 * Bật hoặc tắt camera (desired state).
 */
export function updateCameraState(cameraId: string, isEnabled: boolean): Promise<Camera> {
  const payload: UpdateCameraStateRequest = { isEnabled };
  return apiFetch<Camera>(`/cameras/${encodeURIComponent(cameraId)}/state`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

/**
 * Cập nhật cấu hình thông số camera (chỉ ADMIN).
 */
export function updateCamera(cameraId: string, data: UpdateCameraRequest): Promise<Camera> {
  return apiFetch<Camera>(`/cameras/${encodeURIComponent(cameraId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

/**
 * Xóa camera khỏi hệ thống (chỉ ADMIN).
 */
export function deleteCamera(cameraId: string): Promise<void> {
  return apiFetch<void>(`/cameras/${encodeURIComponent(cameraId)}`, {
    method: 'DELETE',
  });
}

/**
 * Lấy URL snapshot preview hiện tại của camera.
 */
export function fetchCameraSnapshot(cameraId: string): Promise<CameraPreview> {
  return apiFetch<CameraPreview>(`/cameras/${encodeURIComponent(cameraId)}/snapshot`);
}

/**
 * Lấy chi tiết nguồn phát của camera (RTSP, Webcam hoặc Video file).
 */
export function fetchCameraSource(cameraId: string): Promise<CameraSourceDetail> {
  return apiFetch<CameraSourceDetail>(`/cameras/${encodeURIComponent(cameraId)}/source`);
}

/**
 * Cập nhật cấu hình nguồn phát của camera.
 */
export function updateCameraSource(
  cameraId: string,
  data: UpdateCameraSourceRequest,
): Promise<CameraSourceDetail> {
  return apiFetch<CameraSourceDetail>(`/cameras/${encodeURIComponent(cameraId)}/source`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

/**
 * Cấp phiên publish WebRTC/WHIP cho webcam trình duyệt.
 */
export function createBrowserPublishSession(cameraId: string): Promise<BrowserPublishSession> {
  return apiFetch<BrowserPublishSession>(
    `/cameras/${encodeURIComponent(cameraId)}/source/browser-session`,
    {
      method: 'POST',
    },
  );
}

/**
 * Thử lại đồng bộ cấu hình camera xuống Frigate.
 */
export function retryFrigateSync(cameraId: string): Promise<FrigateSyncRetryResponse> {
  return apiFetch<FrigateSyncRetryResponse>(
    `/cameras/${encodeURIComponent(cameraId)}/frigate-sync/retry`,
    {
      method: 'POST',
    },
  );
}
