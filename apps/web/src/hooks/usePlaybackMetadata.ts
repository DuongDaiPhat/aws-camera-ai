'use client';
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api-client';
import type { PlaybackMetadata, RecordingSegment } from '@/types';
export function usePlaybackMetadata(cameraId: string, segment: RecordingSegment | null) {
  const [data, setData] = useState<{
    key: string;
    metadata: PlaybackMetadata | null;
    error: string;
  }>({ key: '', metadata: null, error: '' });
  const start = segment?.startAt ?? '',
    end = segment?.endAt ?? '',
    key = cameraId + start + end;
  useEffect(() => {
    const controller = new AbortController();
    if (!start || !end) return () => controller.abort();
    const query = new URLSearchParams({ startAt: start, endAt: end });
    apiFetch<PlaybackMetadata>('/playback/cameras/' + cameraId + '/metadata?' + query, {
      signal: controller.signal,
    })
      .then((metadata) => {
        if (!controller.signal.aborted) setData({ key, metadata, error: '' });
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setData({
            key,
            metadata: null,
            error: reason instanceof Error ? reason.message : 'Chưa tải được dữ liệu nhận diện.',
          });
      });
    return () => controller.abort();
  }, [cameraId, start, end, key]);
  return data.key === key ? data : { key, metadata: null, error: '' };
}
