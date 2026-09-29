'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CreateZoneRequest, UpdateZoneRequest, Zone } from '@/types';
import { createZone, deleteZone, fetchZones, updateZone } from '@/lib/zones-client';

export function useZones(cameraId: string | null) {
  const [zones, setZones] = useState<Zone[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const reload = useCallback(async () => {
    const currentRequest = ++requestId.current;
    if (!cameraId) {
      setZones([]);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const result = await fetchZones(cameraId);
      if (currentRequest === requestId.current) setZones(result);
    } catch (cause) {
      if (currentRequest === requestId.current) {
        setError(cause instanceof Error ? cause.message : 'Không thể tải danh sách vùng.');
      }
    } finally {
      if (currentRequest === requestId.current) setIsLoading(false);
    }
  }, [cameraId]);

  useEffect(() => void reload(), [reload]);

  const add = useCallback(
    async (payload: CreateZoneRequest) => {
      if (!cameraId) throw new Error('Chưa chọn camera.');
      const saved = await createZone(cameraId, payload);
      setZones((current) => [...current, saved].sort((a, b) => a.name.localeCompare(b.name)));
      return saved;
    },
    [cameraId],
  );

  const save = useCallback(async (zoneId: string, payload: UpdateZoneRequest) => {
    const saved = await updateZone(zoneId, payload);
    setZones((current) => current.map((zone) => (zone.id === zoneId ? saved : zone)));
    return saved;
  }, []);

  const remove = useCallback(async (zoneId: string) => {
    await deleteZone(zoneId);
    setZones((current) => current.filter((zone) => zone.id !== zoneId));
  }, []);

  return { zones, isLoading, error, reload, add, save, remove };
}
