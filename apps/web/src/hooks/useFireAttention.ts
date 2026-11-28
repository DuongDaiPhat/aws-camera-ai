'use client';

import { useEffect, useRef, useState } from 'react';
import type { UIEventItem } from '@/types';
import { fetchPendingCriticalEvents } from '@/lib/events-client';
import {
  canInterruptCriticalAlert,
  criticalAlertDeadline,
  isMandatoryFireAlert,
  nextMandatoryFire,
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
import { FIRE_ATTENTION_POLL_MS } from '@/lib/fire-ui-config';

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
        const events = await fetchPendingCriticalEvents();
        if (mounted) {
          setData({ userId: owner, events });
          setError(null);
        }
      } catch {
        if (mounted) setError('Chưa đồng bộ được danh sách cảnh báo khẩn cấp.');
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

const CLOCK_SKEW_WAKE_WINDOW_MS = 10000;

function mergeCriticalSources(
  liveEvents: UIEventItem[],
  pendingEvents: UIEventItem[] | null | undefined,
  hasPendingError: boolean,
): UIEventItem[] {
  if (hasPendingError || !pendingEvents) return [...liveEvents];
  const merged = new Map<string, UIEventItem>();
  for (const item of pendingEvents) merged.set(item.id, item);
  for (const item of liveEvents) {
    const existing = merged.get(item.id);
    if (!existing) {
      merged.set(item.id, item);
      continue;
    }
    if (
      ['RESOLVED', 'CLOSED', 'ESCALATED'].includes(item.status) ||
      item.isFalseAlarm ||
      item.status !== existing.status ||
      item.thumbnailUrl !== existing.thumbnailUrl ||
      item.confidence !== existing.confidence
    ) {
      merged.set(item.id, { ...existing, ...item });
    }
  }
  return Array.from(merged.values());
}

function nextWakeTime(event: UIEventItem | null, source: UIEventItem[], now: number): number {
  let wakeAt = event ? (criticalAlertDeadline(event) ?? Infinity) : Infinity;
  for (const item of source) {
    if (item.priority !== 'P0') continue;
    const detectedAt = Date.parse(item.detectedAt);
    if (
      Number.isFinite(detectedAt) &&
      detectedAt > now &&
      detectedAt <= now + CLOCK_SKEW_WAKE_WINDOW_MS
    ) {
      wakeAt = Math.min(wakeAt, detectedAt);
    }
  }
  return wakeAt;
}

function useAttentionClock(event: UIEventItem | null, source: UIEventItem[]) {
  const [now, setNow] = useState(Date.now);
  const wakeAt = nextWakeTime(event, source, now);
  useEffect(() => {
    const delay = Math.min(FIRE_ATTENTION_POLL_MS, Math.max(1, wakeAt - Date.now()));
    const timer = setTimeout(() => setNow(Date.now()), delay);
    return () => clearTimeout(timer);
  }, [wakeAt, now]);
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

export function useFireAttention(
  events: UIEventItem[],
  userId: string | undefined,
  canCloseEmergency = true,
) {
  const [revision, setRevision] = useState(0);
  useReceiptSync(userId, setRevision);
  const token = `${revision}:${events.map((item) => `${item.id}:${item.status}:${Number(Boolean(item.isFalseAlarm))}`).join('|')}`;
  const pending = usePendingFireEvents(userId, token);
  const [current, setCurrent] = useState<{ userId: string; event: UIEventItem } | null>(null);
  const currentRef = useRef(current);
  const [storageError, setStorageError] = useState<string | null>(null);
  const active = current?.userId === userId ? (current?.event ?? null) : null;
  const source = mergeCriticalSources(events, pending.events, Boolean(pending.error));
  const now = useAttentionClock(active, source);
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const claim = () => {
      if (cancelled) return;
      const at = Date.now();
      const stored = readFireReceipts(userId);
      let receipts = reconcileFireReceipts(source, stored.receipts, at);
      const previous = currentRef.current?.userId === userId ? currentRef.current.event : null;
      const latest = source.find((item) => item.id === previous?.id);
      const keepMandatory =
        latest &&
        isMandatoryFireAlert(latest, canCloseEmergency) &&
        canInterruptCriticalAlert(latest, at)
          ? latest
          : null;
      const mandatory = keepMandatory ?? nextMandatoryFire(source, at, canCloseEmergency);
      const event =
        mandatory ??
        (latest && canInterruptCriticalAlert(latest, at)
          ? latest
          : nextUnreviewedFire(source, receipts, at));
      if (event && !isMandatoryFireAlert(event, canCloseEmergency)) {
        receipts = rememberFireAttention(source, event, receipts, at);
      }
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
  }, [events, pending.events, pending.error, userId, now, revision, canCloseEmergency]);
  const visibleEvent = active && canInterruptCriticalAlert(active) ? active : null;
  return {
    event: visibleEvent,
    isMandatory: Boolean(visibleEvent && isMandatoryFireAlert(visibleEvent, canCloseEmergency)),
    error: pending.error ?? storageError,
    retry: () => setRevision((value) => value + 1),
    review: (eventId: string) => {
      if (currentRef.current?.event.id !== eventId) return;
      if (isMandatoryFireAlert(currentRef.current.event, canCloseEmergency)) {
        setRevision((value) => value + 1);
        return;
      }
      currentRef.current = null;
      setCurrent(null);
      setRevision((value) => value + 1);
    },
  };
}
