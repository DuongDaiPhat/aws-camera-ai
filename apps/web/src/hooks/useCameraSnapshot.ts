'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CameraPreview } from '@/types';
import { fetchCameraSnapshot } from '@/lib/cameras-client';

export function useCameraSnapshot(cameraId: string | null, isFrozen: boolean) {
  const [preview, setPreview] = useState<CameraPreview | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const reload = useCallback(async () => {
    if (!cameraId || isFrozen) return;
    const currentRequest = ++requestId.current;
    setIsLoading(true);
    setError(null);
    try {
      const result = await fetchCameraSnapshot(cameraId);
      if (currentRequest === requestId.current) setPreview(result);
    } catch (cause) {
      if (currentRequest === requestId.current) {
        setPreview(null);
        setError(cause instanceof Error ? cause.message : 'Không thể tải ảnh camera.');
      }
    } finally {
      if (currentRequest === requestId.current) setIsLoading(false);
    }
  }, [cameraId, isFrozen]);

  useEffect(() => {
    setPreview(null);
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!preview?.expiresAt || isFrozen) return;
    const delay = Math.max(1_000, new Date(preview.expiresAt).getTime() - Date.now() - 30_000);
    const timer = setTimeout(() => void reload(), delay);
    return () => clearTimeout(timer);
  }, [isFrozen, preview?.expiresAt, reload]);

  return { preview, isLoading, error, reload };
}
