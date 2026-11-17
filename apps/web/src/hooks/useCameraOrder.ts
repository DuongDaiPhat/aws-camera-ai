'use client';

import { useEffect, useState } from 'react';
import type { Camera } from '@/types';
import { reconcileCameraOrder } from '@/lib/camera-order';

export function useCameraOrder(cameras: Camera[], userId?: string) {
  const [saved, setSaved] = useState<{ owner?: string; ids: string[] }>({ ids: [] });
  const key = userId ? `cameraai.dashboard.camera-order.${userId}` : null;
  useEffect(() => {
    let ids: string[] = [];
    try {
      const value: unknown = key ? JSON.parse(localStorage.getItem(key) ?? '[]') : [];
      if (Array.isArray(value)) ids = value.filter((id): id is string => typeof id === 'string');
    } catch {
      /* Fall back to API order. */
    }
    setSaved({ owner: userId, ids });
  }, [key, userId]);
  const ids = reconcileCameraOrder(
    cameras.map((camera) => camera.id),
    saved.owner === userId ? saved.ids : [],
  );
  const byId = new Map(cameras.map((camera) => [camera.id, camera]));
  const ordered = ids.map((id) => byId.get(id)!);
  function save(next: string[]) {
    const valid = reconcileCameraOrder(
      cameras.map((camera) => camera.id),
      next,
    );
    setSaved({ owner: userId, ids: valid });
    try {
      if (key) {
        localStorage.setItem(key, JSON.stringify(valid));
        return 'Đã lưu thứ tự trên trình duyệt này.';
      }
    } catch {
      /* Preserve in-memory order. */
    }
    return 'Đã áp dụng thứ tự cho phiên hiện tại.';
  }
  return { ordered, save };
}
