'use client';

import { useCallback, useEffect, useState } from 'react';

const EMPTY: ReadonlySet<string> = new Set();
const PREFIX = 'camerai.notifications.read.v1.';

function readIds(key: string): Set<string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return new Set(
      Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [],
    );
  } catch {
    return new Set();
  }
}

export function useNotificationReadState(userId?: string) {
  const key = userId ? PREFIX + userId : undefined;
  const [state, setState] = useState<{ key: string; ids: Set<string> }>();
  useEffect(() => {
    if (!key) return;
    const sync = () => setState({ key, ids: readIds(key) });
    const onStorage = (event: StorageEvent) => {
      if (event.key === key) sync();
    };
    sync();
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [key]);
  const read = state && state.key === key ? state.ids : EMPTY;

  const markRead = useCallback(
    (eventId: string) => {
      if (!key || read.has(eventId)) return;
      const ids = new Set([...readIds(key), ...read, eventId]);
      try {
        localStorage.setItem(key, JSON.stringify([...ids]));
      } catch {
        // The current tab still remembers the receipt when storage is unavailable.
      }
      setState({ key, ids });
    },
    [key, read],
  );
  return { read, markRead };
}
