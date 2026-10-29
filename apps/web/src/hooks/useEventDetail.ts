'use client';

import { useCallback, useEffect, useState } from 'react';
import type { EventDetail, UIEventItem } from '@/types';
import { fetchEventDetail } from '@/lib/events-client';
import { ApiError } from '@/lib/api-client';
import { FIRE_DETAIL_REFRESH_MS, FIRE_DETAIL_RETRY_MS } from '@/lib/fire-ui-config';

export function useEventDetail(event: UIEventItem | null) {
  const [loaded, setLoaded] = useState<{ id: string; detail: EventDetail } | null>(null);
  const [isLoading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => setAttempt((value) => value + 1), []);
  const id = event?.id;
  const status = event?.status;
  const thumbnail = event?.thumbnailUrl;

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
        timer = setTimeout(() => void load(), FIRE_DETAIL_REFRESH_MS);
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
  }, [id, status, thumbnail, attempt]);

  return { detail: loaded && loaded.id === id ? loaded.detail : null, isLoading, error, reload };
}
