'use client';

import { useCallback, useEffect, useState } from 'react';
import type { EventDetail, UIEventItem } from '@/types';
import { fetchEventDetail } from '@/lib/events-client';
import { ApiError } from '@/lib/api-client';
import { fireEvidence } from '@/lib/fire-evidence';
import {
  FIRE_CLIP_WAIT_WINDOW_MS,
  FIRE_DETAIL_FAST_POLL_MS,
  FIRE_DETAIL_REFRESH_MS,
  FIRE_DETAIL_RETRY_MS,
} from '@/lib/fire-ui-config';

export interface UseEventDetailOptions {
  initialDetail?: EventDetail | null;
  refreshSignal?: number;
}

function needsFastRefresh(detail: EventDetail): boolean {
  if (detail.eventType !== 'FIRE_SMOKE_DETECTED') return false;
  if (detail.status === 'DETECTED') return true;
  if (!fireEvidence(detail)) return true;
  const media = detail.media ?? [];
  const hasSnapshot = media.some((item) => item.mediaType === 'SNAPSHOT');
  if (!hasSnapshot) return true;
  const hasClip = media.some((item) => item.mediaType === 'CLIP');
  if (!hasClip) {
    const detectedAt = Date.parse(detail.detectedAt);
    if (Number.isFinite(detectedAt) && Date.now() - detectedAt < FIRE_CLIP_WAIT_WINDOW_MS) {
      return true;
    }
  }
  return false;
}

export function useEventDetail(event: UIEventItem | null, options?: UseEventDetailOptions) {
  const initialDetail = options?.initialDetail ?? null;
  const refreshSignal = options?.refreshSignal ?? 0;
  const [loaded, setLoaded] = useState<{ id: string; detail: EventDetail } | null>(() =>
    initialDetail ? { id: initialDetail.id, detail: initialDetail } : null,
  );
  const [isLoading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => setAttempt((value) => value + 1), []);
  const id = event?.id;
  const status = event?.status;
  const thumbnail = event?.thumbnailUrl;

  useEffect(() => {
    if (initialDetail && initialDetail.id === id) {
      setLoaded((current) =>
        current && current.id === initialDetail.id
          ? current
          : { id: initialDetail.id, detail: initialDetail },
      );
    }
  }, [id, initialDetail]);

  useEffect(() => {
    if (!id) return;
    const eventId = id;
    setError(null);
    let mounted = true;
    let timer: ReturnType<typeof setTimeout>;
    async function load(): Promise<void> {
      setLoading(true);
      try {
        const detail = await fetchEventDetail(eventId);
        if (!mounted) return;
        setLoaded({ id: detail.id, detail });
        setError(null);
        const nextDelay = needsFastRefresh(detail)
          ? FIRE_DETAIL_FAST_POLL_MS
          : FIRE_DETAIL_REFRESH_MS;
        timer = setTimeout(() => void load(), nextDelay);
      } catch (cause: unknown) {
        if (!mounted) return;
        const retryable = !(cause instanceof ApiError) || cause.status >= 500 || cause.status === 0;
        setError(
          retryable
            ? 'Tạm thời chưa tải được bằng chứng. Hệ thống đang thử lại.'
            : 'Không tải được bằng chứng. Bạn có thể thử lại.',
        );
        if (retryable) timer = setTimeout(() => void load(), FIRE_DETAIL_RETRY_MS);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    void load();
    return () => {
      mounted = false;
      clearTimeout(timer);
    };
  }, [id, status, thumbnail, attempt, refreshSignal]);

  const currentDetail =
    loaded && loaded.id === id
      ? loaded.detail
      : initialDetail && initialDetail.id === id
        ? initialDetail
        : null;

  return {
    detail: currentDetail,
    isLoading,
    isSyncingEvidence: Boolean(currentDetail && needsFastRefresh(currentDetail)),
    error,
    reload,
  };
}
