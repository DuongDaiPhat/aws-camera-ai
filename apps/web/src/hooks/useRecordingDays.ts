'use client';
import { useEffect, useRef, useState } from 'react';
import { getRecordingDay } from '@/lib/playback-client';
import type { RecordingDay } from '@/types';
const ARCHIVE_REFRESH_MS = 10000,
  MAX_PARALLEL = 2;
export function useRecordingDays(cameraIds: string[], date: string) {
  const key = cameraIds.join('|');
  const [days, setDays] = useState<Record<string, RecordingDay>>({}),
    [errors, setErrors] = useState<Record<string, string>>({});
  const [isRefreshing, setRefreshing] = useState(false);
  const reload = useRef<() => Promise<boolean>>(async () => false);
  useEffect(() => {
    const controller = new AbortController();
    let inFlight: Promise<boolean> | null = null;
    const load = (): Promise<boolean> => {
      if (inFlight) return inFlight;
      setRefreshing(true);
      const ids = key.split('|').filter(Boolean);
      let index = 0,
        success = true;
      const worker = async () => {
        while (index < ids.length && !controller.signal.aborted) {
          const id = ids[index++];
          try {
            const day = await getRecordingDay(id, date, controller.signal);
            if (!controller.signal.aborted) {
              setDays((old) => ({ ...old, [id]: day }));
              setErrors((old) => ({ ...old, [date + ':' + id]: '' }));
            }
          } catch (error: unknown) {
            success = false;
            if (!controller.signal.aborted)
              setErrors((old) => ({
                ...old,
                [date + ':' + id]:
                  error instanceof Error ? error.message : 'Không tải được bản ghi.',
              }));
          }
        }
      };
      inFlight = Promise.all(Array.from({ length: Math.min(ids.length, MAX_PARALLEL) }, worker))
        .then(() => success && !controller.signal.aborted)
        .finally(() => {
          inFlight = null;
          if (!controller.signal.aborted) setRefreshing(false);
        });
      return inFlight;
    };
    reload.current = load;
    void load();
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, ARCHIVE_REFRESH_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [key, date]);
  return {
    days: daysForDate(days, date),
    errors: Object.fromEntries(cameraIds.map((id) => [id, errors[date + ':' + id] ?? ''])),
    isRefreshing,
    retry: () => reload.current(),
  };
}

function daysForDate(days: Record<string, RecordingDay>, date: string) {
  return Object.fromEntries(Object.entries(days).filter(([, day]) => day.date === date));
}
