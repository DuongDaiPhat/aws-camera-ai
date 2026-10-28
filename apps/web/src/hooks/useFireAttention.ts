'use client';

import { useEffect, useRef, useState } from 'react';
import type { UIEventItem } from '@/types';
import { fetchPendingFireEvents } from '@/lib/events-client';
import {
  canInterruptFire,
  nextUnreviewedFire,
  reconcileFireReceipts,
  rememberFireAttention,
} from '@/lib/fire-alerts';
import {
  claimFireAttention,
  fireAttentionStorageKey,
  readFireReceipts,
  saveFireReceipts,
} from '@/lib/fire-attention-storage';
import { FIRE_ATTENTION_MAX_AGE_MS, FIRE_ATTENTION_POLL_MS } from '@/lib/fire-ui-config';

function usePendingFireEvents(userId: string | undefined, token: string) {
  const [data, setData] = useState<{ userId: string; events: UIEventItem[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!userId) return;
    const owner = userId;
    let mounted = true;
    let timer: ReturnType<typeof setTimeout>;
    async function load(): Promise<void> {
      try {
        const events = await fetchPendingFireEvents();
        if (mounted) {
          setData({ userId: owner, events });
          setError(null);
        }
      } catch {
        if (mounted) setError('Chưa đồng bộ được danh sách cảnh báo lửa / khói.');
      } finally {
        if (mounted) timer = setTimeout(() => void load(), FIRE_ATTENTION_POLL_MS);
      }
    }
    void load();
    return () => {
      mounted = false;
      clearTimeout(timer);
    };
  }, [userId, token]);
  return { events: data?.userId === userId ? data?.events : null, error };
}

function useAttentionClock(event: UIEventItem | null) {
  const [now, setNow] = useState(Date.now);
  const expiresAt = event ? Date.parse(event.detectedAt) + FIRE_ATTENTION_MAX_AGE_MS : Infinity;
  useEffect(() => {
    const delay = Math.min(FIRE_ATTENTION_POLL_MS, Math.max(1, expiresAt - Date.now()));
    const timer = setTimeout(() => setNow(Date.now()), delay);
    return () => clearTimeout(timer);
  }, [expiresAt, now]);
  return now;
}

function useReceiptSync(
  userId: string | undefined,
  setRevision: (update: (value: number) => number) => void,
) {
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (userId && event.key === fireAttentionStorageKey(userId))
        setRevision((value) => value + 1);
    };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, [userId, setRevision]);
}

export function useFireAttention(events: UIEventItem[], userId: string | undefined) {
  const [revision, setRevision] = useState(0);
  useReceiptSync(userId, setRevision);
  const token = `${revision}:${events.map((item) => `${item.id}:${item.status}`).join('|')}`;
  const pending = usePendingFireEvents(userId, token);
  const [current, setCurrent] = useState<{ userId: string; event: UIEventItem } | null>(null);
  const currentRef = useRef(current);
  const [storageError, setStorageError] = useState<string | null>(null);
  const active = current?.userId === userId ? (current?.event ?? null) : null;
  const now = useAttentionClock(active);
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const source = pending.error ? [...events] : [...(pending.events ?? events)];
    // A terminal SSE update takes precedence over an earlier pending-list response.
    for (const event of events) {
      if (['RESOLVED', 'CLOSED'].includes(event.status)) {
        const index = source.findIndex((item) => item.id === event.id);
        if (index >= 0) source[index] = event;
      }
    }
    const claim = () => {
      if (cancelled) return;
      const at = Date.now();
      const stored = readFireReceipts(userId);
      let receipts = reconcileFireReceipts(source, stored.receipts, at);
      const previous = currentRef.current?.userId === userId ? currentRef.current.event : null;
      const latest = source.find((item) => item.id === previous?.id);
      const event =
        latest && canInterruptFire(latest, at) ? latest : nextUnreviewedFire(source, receipts, at);
      if (event) receipts = rememberFireAttention(source, event, receipts, at);
      setStorageError(saveFireReceipts(userId, receipts) ?? stored.warning);
      currentRef.current = event ? { userId, event } : null;
      setCurrent(currentRef.current);
    };
    void claimFireAttention(userId, claim).catch(() => {
      claim();
      setStorageError('Chưa đồng bộ được trạng thái cảnh báo giữa các thẻ trình duyệt.');
    });
    return () => {
      cancelled = true;
    };
  }, [events, pending.events, pending.error, userId, now, revision]);
  return {
    event: active,
    error: pending.error ?? storageError,
    retry: () => setRevision((value) => value + 1),
    review: (eventId: string) => {
      if (currentRef.current?.event.id !== eventId) return;
      currentRef.current = null;
      setCurrent(null);
      setRevision((value) => value + 1);
    },
  };
}
