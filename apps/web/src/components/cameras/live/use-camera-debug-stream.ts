'use client';

import { useEffect, useState } from 'react';
import { fetchCameraDebugStream, type CameraDebugStream } from '@/lib/cameras-client';

const POLL_MS = 100;
const ERROR_RETRY_MS = 2000;
interface Snapshot {
  data: CameraDebugStream | null;
  error: boolean;
}
type Listener = (snapshot: Snapshot) => void;
interface Subscription {
  snapshot: Snapshot;
  listeners: Set<Listener>;
  timer?: ReturnType<typeof setTimeout>;
  stopped: boolean;
  controller: AbortController;
}
const subscriptions = new Map<string, Subscription>();
const EMPTY: Snapshot = { data: null, error: false };

/** A dashboard tile and its area card share one ordered polling loop. */
export function subscribeCameraDebug(cameraId: string, listener: Listener): () => void {
  let entry = subscriptions.get(cameraId);
  if (!entry) {
    entry = {
      snapshot: EMPTY,
      listeners: new Set(),
      stopped: false,
      controller: new AbortController(),
    };
    subscriptions.set(cameraId, entry);
  }
  const current = entry;
  current.listeners.add(listener);
  listener(current.snapshot);
  async function poll(): Promise<void> {
    try {
      const data = await fetchCameraDebugStream(cameraId, current.controller.signal);
      if (current.stopped) return;
      // A late response for another camera must never paint this viewport.
      if (data.cameraId && data.cameraId !== cameraId) throw new Error('Camera response mismatch');
      current.snapshot = { data, error: false };
    } catch {
      if (current.stopped) return;
      // Keep an established player on transient API failures. The tracker expires old boxes.
      current.snapshot = { data: current.snapshot.data, error: true };
    }
    for (const notify of current.listeners) notify(current.snapshot);
    if (!current.stopped) {
      current.timer = setTimeout(
        () => void poll(),
        current.snapshot.error ? ERROR_RETRY_MS : POLL_MS,
      );
    }
  }
  if (current.listeners.size === 1) void poll();
  return () => {
    current.listeners.delete(listener);
    if (current.listeners.size) return;
    current.stopped = true;
    current.controller.abort();
    clearTimeout(current.timer);
    if (subscriptions.get(cameraId) === current) subscriptions.delete(cameraId);
  };
}

export function useCameraDebugStream(cameraId: string, enabled: boolean): Snapshot {
  const [state, setState] = useState<{ id: string; snapshot: Snapshot }>({
    id: '',
    snapshot: EMPTY,
  });
  useEffect(() => {
    if (!enabled) return;
    return subscribeCameraDebug(cameraId, (snapshot) => setState({ id: cameraId, snapshot }));
  }, [cameraId, enabled]);
  return enabled && state.id === cameraId ? state.snapshot : EMPTY;
}
