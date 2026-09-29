import type { CreateZoneRequest, UpdateZoneRequest, Zone } from '@/types';
import { apiFetch } from './api-client';

export async function fetchZones(cameraId: string): Promise<Zone[]> {
  const response = await apiFetch<{ data?: Zone[] }>(
    `/cameras/${encodeURIComponent(cameraId)}/zones`,
  );
  return response.data ?? [];
}

export function createZone(cameraId: string, payload: CreateZoneRequest): Promise<Zone> {
  return apiFetch<Zone>(`/cameras/${encodeURIComponent(cameraId)}/zones`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function updateZone(zoneId: string, payload: UpdateZoneRequest): Promise<Zone> {
  return apiFetch<Zone>(`/zones/${encodeURIComponent(zoneId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function deleteZone(zoneId: string): Promise<void> {
  return apiFetch<void>(`/zones/${encodeURIComponent(zoneId)}`, { method: 'DELETE' });
}

export function retryZoneSync(cameraId: string): Promise<void> {
  return apiFetch<void>(`/cameras/${encodeURIComponent(cameraId)}/frigate-sync/retry`, {
    method: 'POST',
  });
}
