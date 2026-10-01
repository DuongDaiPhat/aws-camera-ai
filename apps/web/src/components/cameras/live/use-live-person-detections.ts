'use client';

import { useEffect, useRef, useState } from 'react';
import type { CameraDebugStream } from '@/lib/cameras-client';
import type { CameraSourceType } from '@/types';
import type { DetectedPerson } from '../debug/PersonBoxLayer';
import { LivePersonTracker } from './live-person-tracker';

const LIVE_BOX_FIT = { width: 1, height: 1 } as const;

export function personBoxFitForSource(_sourceType: CameraSourceType | undefined): {
  width: number;
  height: number;
} {
  return LIVE_BOX_FIT;
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
  const clockRef = useRef<{ frameTime: number; receivedAt: number } | null>(null);
  const renderLogRef = useRef<{ count: number; ids: string } | null>(null);

  useEffect(() => {
    tracker.clear();
    clockRef.current = null;
    renderLogRef.current = null;
    setPeople({ cameraId, detections: [] });
    if (!enabled) return;
    const boxFit = personBoxFitForSource(sourceType);
    let animation: number;
    let lastTime = -Infinity;
    const draw = () => {
      const clock = clockRef.current;
      if (clock) {
        const streamNow = clock.frameTime + performance.now() - clock.receivedAt;
        if (streamNow < lastTime - 2000) {
          lastTime = streamNow;
        } else {
          lastTime = Math.max(lastTime, streamNow);
        }
        const detections = tracker.get(lastTime, boxFit);

        const currentIds = detections
          .map((d) => d.id ?? '')
          .sort()
          .join(',');
        const prev = renderLogRef.current;
        if (!prev || prev.count !== detections.length || prev.ids !== currentIds) {
          if (detections.length === 0 && prev && prev.count > 0) {
            console.warn(`[PERSON_DEBUG][RENDER] camera=${cameraId} action=HIDE count=0`);
          } else if (detections.length === 1) {
            console.warn(
              `[PERSON_DEBUG][RENDER] camera=${cameraId} action=SHOW count=1 objectId=${detections[0].id}`,
            );
          } else if (detections.length > 1) {
            console.warn(
              `[PERSON_DEBUG][RENDER] camera=${cameraId} action=MULTIPLE_BOXES count=${detections.length} ids=${currentIds}`,
            );
          }
          renderLogRef.current = { count: detections.length, ids: currentIds };
        }

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
    if (!enabled || data?.cameraId !== cameraId || !data.detectionFrames) return;

    for (const frame of data.detectionFrames) {
      for (const detection of frame.detections) {
        console.warn(
          `[PERSON_DEBUG][FRONTEND_RECEIVE] camera=${cameraId} frameTime=${frame.frameTime} observedAt=${detection.observedAt} receivedAt=${data.serverTime} objectId=${detection.id}`,
        );
      }
    }

    // Keep the tracker and render loop across HTTP responses. A duplicate poll
    // must not reset boxes, filtering history, or their expiry timestamps.
    tracker.update(data.detectionFrames);

    const latestFrame =
      data.detectionFrames.length > 0
        ? data.detectionFrames[data.detectionFrames.length - 1]
        : null;

    if (latestFrame) {
      if (
        !clockRef.current ||
        latestFrame.frameTime > clockRef.current.frameTime ||
        latestFrame.frameTime < clockRef.current.frameTime - 2000
      ) {
        clockRef.current = { frameTime: latestFrame.frameTime, receivedAt: performance.now() };
      }
    }
  }, [data, cameraId, enabled, tracker]);
  return enabled && people.cameraId === cameraId && data?.cameraId === cameraId
    ? people.detections
    : [];
}
