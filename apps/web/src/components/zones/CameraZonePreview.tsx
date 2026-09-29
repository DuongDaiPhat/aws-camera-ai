'use client';

import type { PointerEvent as ReactPointerEvent } from 'react';
import type { CameraPreview, Zone } from '@/types';
import type { ZonePoint } from '@/lib/zone-geometry';
import styles from './zones.module.css';

const COLORS: Record<Zone['zoneType'], string> = {
  RESTRICTED: '#dc2626',
  REST_AREA: '#2563eb',
  NORMAL: '#16a34a',
};

interface Props {
  preview: CameraPreview;
  zones: Zone[];
  selectedZoneId: string | null;
  draft: ZonePoint[] | null;
  canDraw: boolean;
  onSelectZone: (zoneId: string) => void;
  onAddPoint: (point: ZonePoint) => void;
  onMovePoint: (index: number, point: ZonePoint) => void;
}

function normalizedPoint(event: ReactPointerEvent<SVGElement>): ZonePoint {
  const svg = event.currentTarget.ownerSVGElement ?? event.currentTarget;
  const rectangle = svg.getBoundingClientRect();
  const x = Math.min(1, Math.max(0, (event.clientX - rectangle.left) / rectangle.width));
  const y = Math.min(1, Math.max(0, (event.clientY - rectangle.top) / rectangle.height));
  return [Number(x.toFixed(6)), Number(y.toFixed(6))];
}

function pointsValue(points: number[][]): string {
  return points.map(([x, y]) => `${x},${y}`).join(' ');
}

export function CameraZonePreview({
  preview,
  zones,
  selectedZoneId,
  draft,
  canDraw,
  onSelectZone,
  onAddPoint,
  onMovePoint,
}: Props) {
  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!canDraw || event.target !== event.currentTarget) return;
    onAddPoint(normalizedPoint(event));
  };

  return (
    <div
      className={styles.previewFrame}
      style={{ aspectRatio: `${preview.width ?? 16} / ${preview.height ?? 9}` }}
    >
      <img className={styles.previewImage} src={preview.url} alt="Ảnh xem trước camera" />
      <svg
        className={`${styles.overlay} ${canDraw ? styles.overlayDrawing : ''}`}
        viewBox="0 0 1 1"
        preserveAspectRatio="none"
        onPointerDown={handlePointerDown}
        aria-label="Các vùng được cấu hình trên camera"
      >
        {zones.map((zone) => {
          const isSelected = selectedZoneId === zone.id;
          const color = COLORS[zone.zoneType];
          const first = zone.polygon[0];
          return (
            <g
              key={zone.id}
              className={styles.zoneShape}
              opacity={zone.isEnabled ? 1 : 0.48}
              onPointerDown={(event) => {
                event.stopPropagation();
                onSelectZone(zone.id);
              }}
            >
              <polygon
                points={pointsValue(zone.polygon)}
                fill={color}
                fillOpacity={isSelected ? 0.28 : 0.15}
                stroke={color}
                strokeWidth={isSelected ? 0.008 : 0.005}
                vectorEffect="non-scaling-stroke"
              />
              {first && (
                <text
                  x={first[0]}
                  y={Math.max(0.035, first[1] - 0.015)}
                  className={styles.zoneLabel}
                >
                  {zone.name}
                  {zone.isEnabled ? '' : ' · Đã tắt'}
                </text>
              )}
            </g>
          );
        })}

        {draft && draft.length > 0 && (
          <g>
            {draft.length >= 3 ? (
              <polygon
                points={pointsValue(draft)}
                className={styles.draftPolygon}
                vectorEffect="non-scaling-stroke"
              />
            ) : (
              <polyline
                points={pointsValue(draft)}
                className={styles.draftPolygon}
                vectorEffect="non-scaling-stroke"
              />
            )}
            {draft.map(([x, y], index) => (
              <circle
                key={`${index}-${x}-${y}`}
                cx={x}
                cy={y}
                r={0.014}
                className={styles.vertex}
                vectorEffect="non-scaling-stroke"
                onPointerDown={(event) => {
                  event.stopPropagation();
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerMove={(event) => {
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                    onMovePoint(index, normalizedPoint(event));
                  }
                }}
                onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
              />
            ))}
          </g>
        )}
      </svg>
    </div>
  );
}
