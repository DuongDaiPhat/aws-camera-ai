'use client';

import { useCallback, useEffect, useState } from 'react';
import { fetchEventStats } from '@/lib/events-client';
import type { EventStats } from '@/types';

/** Làm mới số liệu mỗi phút để thẻ trên đầu dashboard không bị cũ (FR-DSH-01). */
const STATS_REFRESH_INTERVAL_MS = 60_000;

export interface UseEventStatsResult {
  stats: EventStats | null;
  isLoading: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * Số liệu tổng hợp cho các thẻ trên đầu dashboard.
 * `refreshToken` cho phép màn hình ép tải lại ngay khi có sự kiện mới qua SSE.
 */
export function useEventStats(refreshToken: number = 0): UseEventStatsResult {
  const [stats, setStats] = useState<EventStats | null>(null);
  const [isLoading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => {
    setReloadToken((token) => token + 1);
  }, []);

  useEffect(() => {
    let isMounted = true;

    function load() {
      fetchEventStats()
        .then((data) => {
          if (!isMounted) return;
          setStats(data);
          setError(null);
        })
        .catch((err: unknown) => {
          if (!isMounted) return;
          setError(err instanceof Error ? err.message : 'Không tải được số liệu tổng hợp.');
        })
        .finally(() => {
          if (isMounted) setLoading(false);
        });
    }

    load();
    const timer = setInterval(load, STATS_REFRESH_INTERVAL_MS);

    return () => {
      isMounted = false;
      clearInterval(timer);
    };
  }, [reloadToken, refreshToken]);

  return { stats, isLoading, error, reload };
}
