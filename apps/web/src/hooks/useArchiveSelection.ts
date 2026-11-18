'use client';
import { useEffect, useState } from 'react';

export function useArchiveSelection(cameraIds: string[], capacity: number, userId?: string) {
  const key = userId ? `cameraai.playback.channels.${userId}` : null;
  const [state, setState] = useState<{ owner: string | null | undefined; ids: string[] | null }>({
    owner: undefined,
    ids: null,
  });
  const [saveError, setSaveError] = useState('');
  useEffect(() => {
    let ids: string[] | null = null;
    try {
      const parsed: unknown = key ? JSON.parse(localStorage.getItem(key) ?? 'null') : null;
      if (Array.isArray(parsed) && parsed.every((id) => typeof id === 'string'))
        ids = [...new Set<string>(parsed)];
    } catch {
      /* Keep a usable default when browser storage is unavailable. */
    }
    setState({ owner: key, ids });
    setSaveError('');
  }, [key]);
  const selected =
    state.owner === key && state.ids !== null
      ? state.ids.filter((id) => cameraIds.includes(id)).slice(0, capacity)
      : cameraIds.slice(0, capacity);
  function setSelected(ids: string[]) {
    const unique = [...new Set(ids)].filter((id) => cameraIds.includes(id));
    setState({ owner: key, ids: unique });
    setSaveError('');
    try {
      if (key) localStorage.setItem(key, JSON.stringify(unique));
    } catch {
      setSaveError(
        'Không thể lưu lựa chọn camera trên trình duyệt. Lựa chọn vẫn dùng được trong phiên này.',
      );
    }
  }
  return { selected, setSelected, saveError, ready: state.owner === key };
}
