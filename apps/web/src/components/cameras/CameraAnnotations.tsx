'use client';

import type { ReactNode } from 'react';
import { PersonBoxLayer, type DetectedPerson } from './debug/PersonBoxLayer';
import { useCameraSignals } from './live/CameraSignals';
import styles from './styles/camera-annotations.module.css';

export function CameraAnnotations({
  cameraId,
  people,
  height,
  children,
  showFootpoint = false,
}: {
  cameraId: string;
  people: DetectedPerson[];
  height: number;
  children?: ReactNode;
  showFootpoint?: boolean;
}) {
  const { alerts, boxes } = useCameraSignals(cameraId);
  const urgent = alerts.some((alert) => alert.kind !== 'stranger');
  return (
    <>
      <svg
        viewBox={`0 0 1000 ${height}`}
        preserveAspectRatio="xMidYMid meet"
        aria-label="Nhận diện trực tiếp"
      >
        {children}
        {people.map((person, index) => (
          <PersonBoxLayer
            key={person.id ?? index}
            person={person}
            height={height}
            showFootpoint={showFootpoint}
          />
        ))}
        {boxes.map((box, index) => (
          <PersonBoxLayer
            key={'incident-' + index}
            person={box}
            kind={box.label}
            height={height}
            showFootpoint={false}
          />
        ))}
      </svg>
      {(people.length > 0 || alerts.length > 0) && (
        <div
          className={styles.signals}
          role={urgent ? 'alert' : 'status'}
          aria-label="Cảnh báo camera"
        >
          {people.length > 0 && <span data-signal="person">person · {people.length}</span>}
          {Array.from(new Map(alerts.map((alert) => [alert.kind, alert])).values()).map((alert) => (
            <span key={alert.kind} data-signal={alert.kind}>
              {alert.title}
            </span>
          ))}
        </div>
      )}
    </>
  );
}
