'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Camera } from '@/types';
import { fetchCameras, updateCameraState } from '@/lib/cameras-client';

export interface UseCamerasReturn {
  cameras: Camera[];
  selectedCameraId: string | null;
  selectedCamera: Camera | null;
  isLoading: boolean;
  error: string | null;
  toggleLoadingMap: Record<string, boolean>;
  loadCameras: () => Promise<void>;
  selectCamera: (cameraId: string) => void;
  toggleCamera: (cameraId: string, desiredState?: boolean) => Promise<boolean>;
}

interface ToggleParams {
  cameraId: string;
  desiredState?: boolean;
  cameras: Camera[];
  setCameras: React.Dispatch<React.SetStateAction<Camera[]>>;
  setToggleLoadingMap: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
}

async function executeCameraToggle(params: ToggleParams): Promise<boolean> {
  const { cameraId, desiredState, cameras, setCameras, setToggleLoadingMap, setError } = params;
  const current = cameras.find((c) => c.id === cameraId);
  if (!current) return false;
  const target = desiredState !== undefined ? desiredState : !current.isEnabled;

  setCameras((prev) =>
    prev.map((c) =>
      c.id === cameraId
        ? { ...c, isEnabled: target, runtimeStatus: target ? 'STARTING' : 'DISABLED' }
        : c,
    ),
  );
  setToggleLoadingMap((prev) => ({ ...prev, [cameraId]: true }));
  setError(null);

  try {
    const updated = await updateCameraState(cameraId, target);
    setCameras((prev) => prev.map((c) => (c.id === cameraId ? updated : c)));
    return true;
  } catch (err) {
    setCameras((prev) => prev.map((c) => (c.id === cameraId ? current : c)));
    setError(err instanceof Error ? err.message : 'Cập nhật trạng thái camera thất bại');
    return false;
  } finally {
    setToggleLoadingMap((prev) => {
      const next = { ...prev };
      delete next[cameraId];
      return next;
    });
  }
}

export function useCameras(initialCameraId?: string): UseCamerasReturn {
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(initialCameraId ?? null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [toggleLoadingMap, setToggleLoadingMap] = useState<Record<string, boolean>>({});

  const refreshCameras = useCallback(async (showLoading: boolean) => {
    if (showLoading) setIsLoading(true);
    setError(null);
    try {
      const data = await fetchCameras();
      setCameras(data);
      setSelectedCameraId((current) => current ?? data[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải danh sách camera');
    } finally {
      if (showLoading) setIsLoading(false);
    }
  }, []);

  const loadCameras = useCallback(async () => refreshCameras(true), [refreshCameras]);

  useEffect(() => {
    void loadCameras();
    const refreshTimer = setInterval(() => void refreshCameras(false), 2000);
    return () => clearInterval(refreshTimer);
  }, [loadCameras, refreshCameras]);

  const selectedCamera = useMemo(() => {
    return cameras.find((c) => c.id === selectedCameraId) ?? cameras[0] ?? null;
  }, [cameras, selectedCameraId]);

  const toggleCamera = useCallback(
    (id: string, desired?: boolean) =>
      executeCameraToggle({
        cameraId: id,
        desiredState: desired,
        cameras,
        setCameras,
        setToggleLoadingMap,
        setError,
      }),
    [cameras],
  );

  return {
    cameras,
    selectedCameraId,
    selectedCamera,
    isLoading,
    error,
    toggleLoadingMap,
    loadCameras,
    selectCamera: setSelectedCameraId,
    toggleCamera,
  };
}
