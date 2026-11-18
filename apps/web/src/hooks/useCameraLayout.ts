'use client';

import { useEffect, useState } from 'react';

import { isCameraLayout } from '@/lib/camera-layout';

export type CameraLayout = 'custom' | `${number}`;
interface Preference {
  layout: CameraLayout;
  custom: number;
}
const defaults: Preference = { layout: '2', custom: 3 };

function parsePreference(raw: string | null): Preference {
  try {
    const value: unknown = JSON.parse(raw ?? 'null');
    if (typeof value !== 'object' || !value) return defaults;
    const candidate = value as Record<string, unknown>;
    if (candidate.version !== 1 || !isCameraLayout(candidate.layout)) return defaults;
    return {
      layout: candidate.layout as CameraLayout,
      custom:
        typeof candidate.custom === 'number' &&
        Number.isSafeInteger(candidate.custom) &&
        candidate.custom > 0
          ? candidate.custom
          : defaults.custom,
    };
  } catch {
    return defaults;
  }
}

export function useCameraLayout(userId?: string, scope: 'dashboard' | 'playback' = 'dashboard') {
  const key = userId ? `cameraai.${scope}.camera-layout.${userId}` : null;
  const [state, setState] = useState<{ owner: string | null | undefined; preference: Preference }>({
    owner: undefined,
    preference: defaults,
  });
  const [saveError, setSaveError] = useState('');
  useEffect(() => {
    let preference = defaults;
    try {
      if (key) preference = parsePreference(localStorage.getItem(key));
    } catch {
      /* Storage can be unavailable. */
    }
    setState({ owner: key, preference });
    setSaveError('');
    const sync = (event: StorageEvent) => {
      if (key && event.storageArea === localStorage && (event.key === key || event.key === null))
        setState({
          owner: key,
          preference: parsePreference(event.key === null ? null : event.newValue),
        });
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [key]);
  const preference = state.owner === key ? state.preference : defaults;
  function update(next: Preference) {
    setState({ owner: key, preference: next });
    setSaveError('');
    try {
      if (key) localStorage.setItem(key, JSON.stringify({ version: 1, ...next }));
    } catch {
      setSaveError(
        'Không thể lưu bố cục trên trình duyệt. Thay đổi đang được giữ trong phiên này.',
      );
    }
  }
  return {
    ...preference,
    ready: state.owner === key,
    saveError,
    setLayout: (layout: string) => {
      if (isCameraLayout(layout)) update({ ...preference, layout: layout as CameraLayout });
    },
    setCustom: (custom: number) => {
      if (Number.isSafeInteger(custom) && custom > 0) update({ ...preference, custom });
    },
  };
}
