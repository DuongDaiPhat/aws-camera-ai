'use client';
import { useEffect, useState } from 'react';
import { getRecordingDay } from '@/lib/playback-client';
import type { RecordingDay } from '@/types';
const ARCHIVE_REFRESH_MS = 10000,
  MAX_PARALLEL = 2;
export function useRecordingDays(cameraIds: string[], date: string) {
  const key = cameraIds.join('|');
  const [days, setDays] = useState<Record<string, RecordingDay>>({}),
    [errors, setErrors] = useState<Record<string, string>>({}),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let inFlight = false;
    const load = async () => {
      if (inFlight) return;
      inFlight = true;
      const ids = key.split('|').filter(Boolean);
      let index = 0;
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
            if (!controller.signal.aborted)
              setErrors((old) => ({
                ...old,
                [date + ':' + id]:
                  error instanceof Error ? error.message : 'Không tải được bản ghi.',
              }));
          }
        }
      };
      try {
        await Promise.all(Array.from({ length: Math.min(ids.length, MAX_PARALLEL) }, worker));
      } finally {
        inFlight = false;
      }
    };
    void load();
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, ARCHIVE_REFRESH_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [key, date, revision]);
  return {
    days: Object.fromEntries(Object.entries(days).filter(([, day]) => day.date === date)),
    errors: Object.fromEntries(cameraIds.map((id) => [id, errors[date + ':' + id] ?? ''])),
    retry: () => setRevision((n) => n + 1),
  };
}
