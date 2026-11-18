'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { EventDetail, UIEventItem, components } from '@/types';
import { fetchEventDetail } from '@/lib/events-client';

type Box = components['schemas']['PlaybackBox'];
const RECENT_EVENT_MS = 10000;
const LIVE_GEOMETRY_MS = 1500;
interface Signal {
  id: string;
  kind: 'fire' | 'fall' | 'stranger';
  title: string;
}
const empty = { events: [] as UIEventItem[], details: {} as Record<string, EventDetail>, now: 0 };
const Signals = createContext(empty);

export function cameraSignals(events: UIEventItem[], cameraId: string, now: number): Signal[] {
  return events.flatMap((event) => {
    if (
      event.camera?.id !== cameraId ||
      event.isFalseAlarm ||
      event.status === 'AI_FAILED' ||
      event.status === 'RESOLVED' ||
      event.status === 'CLOSED'
    )
      return [];
    const kind =
      event.eventType === 'FIRE_SMOKE_DETECTED'
        ? 'fire'
        : event.eventType === 'FALL_DETECTED'
          ? 'fall'
          : event.eventType === 'UNKNOWN_PERSON'
            ? 'stranger'
            : null;
    if (!kind) return [];
    const age = now - Date.parse(event.detectedAt);
    if (!Number.isFinite(age) || age < -1000 || age > RECENT_EVENT_MS) return [];
    return [
      {
        id: event.id,
        kind,
        title:
          kind === 'fire' ? 'Phát hiện lửa' : kind === 'fall' ? 'Phát hiện té ngã' : 'Người lạ',
      },
    ];
  });
}

/** Live geometry and its label expire together; pending history belongs in notifications. */
export function liveIncidentBoxes(detail: EventDetail | undefined, now: number): Box[] {
  if (!detail || detail.isFalseAlarm || detail.status === 'CLOSED' || detail.status === 'RESOLVED')
    return [];
  return (detail.aiResults ?? []).flatMap((item) => {
    const label =
      item.label === 'FALL_DETECTED'
        ? 'fall'
        : item.label === 'FIRE_SMOKE_DETECTED'
          ? 'fire'
          : null;
    const at = item.metadata?.confirmedAt;
    if (
      !label ||
      item.status !== 'SUCCESS' ||
      typeof at !== 'string' ||
      (label === 'fall' && item.module !== 'M2A_FALL') ||
      (label === 'fire' && item.module !== 'M3_FIRE')
    )
      return [];
    const age = now - Date.parse(at),
      box = item.boundingBox,
      confidence = item.confidence;
    if (
      !Number.isFinite(age) ||
      age < -1000 ||
      age > LIVE_GEOMETRY_MS ||
      !box ||
      typeof confidence !== 'number' ||
      !Number.isFinite(confidence) ||
      confidence < 0 ||
      confidence > 1
    )
      return [];
    const { x, y, width, height } = box;
    if (
      ![x, y, width, height].every(
        (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1,
      ) ||
      !width ||
      !height ||
      x! + width > 1 ||
      y! + height > 1
    )
      return [];
    return [{ label, x: x!, y: y!, width, height, confidence }];
  });
}

export function CameraSignalsProvider({
  events,
  children,
}: {
  events: UIEventItem[];
  children: ReactNode;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [details, setDetails] = useState<Record<string, EventDetail>>({});
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);
  const relevant = events.filter(
    (event) => cameraSignals([event], event.camera?.id ?? '', now).length > 0,
  );
  const key = relevant.map((event) => event.id + ':' + event.status).join('|');
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const missing = relevant
      .filter((event) => !details[event.id] || details[event.id].status !== event.status)
      .slice(0, 12);
    if (!missing.length) return;
    Promise.allSettled(missing.map((event) => fetchEventDetail(event.id))).then((results) => {
      if (!active) return;
      setDetails((old) => {
        const next = Object.fromEntries(
          Object.entries(old).filter(([id]) => events.some((event) => event.id === id)),
        );
        results.forEach((result) => {
          if (result.status === 'fulfilled') next[result.value.id] = result.value;
        });
        return next;
      });
      if (results.some((result) => result.status === 'rejected'))
        timer = setTimeout(() => setRetry((value) => value + 1), 3000);
    });
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [key, retry]);
  return <Signals.Provider value={{ events, details, now }}>{children}</Signals.Provider>;
}

export function useCameraSignals(cameraId: string) {
  const { events, details, now } = useContext(Signals);
  const candidates = cameraSignals(events, cameraId, now);
  const matches = candidates.map((alert) => {
    const detail = details[alert.id];
    const boxes =
      detail?.camera?.id === cameraId && detail.id === alert.id
        ? liveIncidentBoxes(detail, now)
        : [];
    return { alert, boxes: boxes.filter((box) => box.label === alert.kind) };
  });
  const live = matches.filter(({ alert, boxes }) => alert.kind === 'stranger' || boxes.length > 0);
  return { alerts: live.map((item) => item.alert), boxes: live.flatMap((item) => item.boxes) };
}
