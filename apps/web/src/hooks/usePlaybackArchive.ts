'use client';
import { useEffect, useState } from 'react';
import { listPlaybackCameras, getRecordingDay, getRecordingClip } from '@/lib/playback-client';
import type { PlaybackCamera, RecordingDay, RecordingSegment } from '@/types';
const message = (error: unknown) =>
  error instanceof Error ? error.message : 'Không thể tải bản ghi. Vui lòng thử lại.';
export function usePlaybackCameras(revision: number) {
  const [cameras, setCameras] = useState<PlaybackCamera[]>([]),
    [cameraId, setCameraId] = useState('');
  const [cameraError, setCameraError] = useState(''),
    [camerasLoading, setCamerasLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    setCamerasLoading(true);
    setCameraError('');
    listPlaybackCameras(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setCameras(result.data);
        setCameraId((old) =>
          result.data.some((c) => c.id === old) ? old : (result.data[0]?.id ?? ''),
        );
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setCameraError(message(reason));
      })
      .finally(() => {
        if (!controller.signal.aborted) setCamerasLoading(false);
      });
    return () => controller.abort();
  }, [revision]);
  return { cameras, cameraId, setCameraId, cameraError, camerasLoading };
}
export function usePlaybackArchive(date: string) {
  const [revision, setRevision] = useState(0);
  const { cameras, cameraId, setCameraId, cameraError, camerasLoading } =
    usePlaybackCameras(revision);
  const [day, setDay] = useState<RecordingDay | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setDay(null);
    setError('');
    if (!cameraId) {
      setLoading(false);
      return () => controller.abort();
    }
    setLoading(true);
    getRecordingDay(cameraId, date, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setDay(result);
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(message(reason));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [cameraId, date, revision]);
  // Hide the old day synchronously during a camera/date transition, before effects run.
  const currentDay = day?.cameraId === cameraId && day.date === date ? day : null;
  return {
    cameras,
    cameraId,
    setCameraId,
    day: currentDay,
    loading: loading || camerasLoading,
    error: cameraError || error,
    retry: () => setRevision((n) => n + 1),
  };
}
export function usePlaybackClip(cameraId: string, segment: RecordingSegment | null) {
  const identity = cameraId + ':' + (segment?.id ?? '');
  const [source, setSource] = useState({ identity: '', url: '' }),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false),
    [revision, setRevision] = useState(0);
  const startAt = segment?.startAt,
    endAt = segment?.endAt;
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = '';
    setSource({ identity, url: '' });
    setError('');
    if (!segment) {
      setLoading(false);
      return () => controller.abort();
    }
    setLoading(true);
    getRecordingClip(cameraId, segment, controller.signal)
      .then((blob) => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setSource({ identity, url: objectUrl });
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(message(reason));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [cameraId, startAt, endAt, identity, revision]);
  return {
    url: source.identity === identity ? source.url : '',
    error,
    loading,
    retry: () => setRevision((n) => n + 1),
  };
}
