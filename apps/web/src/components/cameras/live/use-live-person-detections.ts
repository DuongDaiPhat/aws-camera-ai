'use client';

import { useEffect, useRef, useState } from 'react';
import type { CameraDebugStream } from '@/lib/cameras-client';
import type { CameraSourceType } from '@/types';
import type { DetectedPerson } from '../debug/PersonBoxLayer';
import { LivePersonTracker } from './live-person-tracker';

const VIDEO_FILE_BOX_FIT = { width: 0.78, height: 0.94 } as const;
const LIVE_BOX_FIT = { width: 1, height: 1 } as const;

export function personBoxFitForSource(
  sourceType: CameraSourceType | undefined,
): { width: number; height: number } {
  return sourceType === 'VIDEO_FILE' ? VIDEO_FILE_BOX_FIT : LIVE_BOX_FIT;
}

export function useLivePersonDetections(
  data: CameraDebugStream | null,
  cameraId: string,
  enabled: boolean,
  sourceType: CameraSourceType | undefined,
): DetectedPerson[] {
  const [people, setPeople] = useState<{ cameraId: string; detections: DetectedPerson[] }>({
    cameraId,
    detections: [],
  });
  const [tracker] = useState(() => new LivePersonTracker());
  const clockRef = useRef<{ serverTime: number; receivedAt: number } | null>(null);
  useEffect(() => {
    tracker.clear();
    clockRef.current = null;
    setPeople({ cameraId, detections: [] });
    if (!enabled) return;
    const boxFit = personBoxFitForSource(sourceType);
    let animation: number;
    let lastTime = -Infinity;
    const draw = () => {
      const clock = clockRef.current;
      if (clock) {
        lastTime = Math.max(lastTime, clock.serverTime + performance.now() - clock.receivedAt);
        const detections = tracker.get(lastTime, boxFit);
        setPeople((previous) => {
          const unchanged =
            previous.cameraId === cameraId &&
            previous.detections.length === detections.length &&
            previous.detections.every((item, i) => {
              const next = detections[i];
              return (
                item.id === next.id &&
                item.x === next.x &&
                item.y === next.y &&
                item.width === next.width &&
                item.height === next.height &&
                item.confidence === next.confidence &&
                item.label === next.label
              );
            });
          return unchanged ? previous : { cameraId, detections };
        });
      }
      animation = requestAnimationFrame(draw);
    };
    animation = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animation);
  }, [cameraId, enabled, sourceType, tracker]);

  useEffect(() => {
    if (!enabled || data?.cameraId !== cameraId || !data.detectionFrames || !data.serverTime)
      return;
    // Keep the tracker and render loop across HTTP responses. A duplicate poll
    // must not reset boxes, filtering history, or their expiry timestamps.
    tracker.update(data.detectionFrames);
    clockRef.current = { serverTime: data.serverTime, receivedAt: performance.now() };
  }, [data, cameraId, enabled, tracker]);
  return enabled && people.cameraId === cameraId && data?.cameraId === cameraId
    ? people.detections
    : [];
}
