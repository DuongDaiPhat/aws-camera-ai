'use client';

import React from 'react';
import type { CameraZone } from '@/lib/cameras-client';
import { formatPolygonPoints, getPolygonCenter } from './geometry-utils';

interface ZonePolygonLayerProps {
  zones: CameraZone[];
  activeZoneSlugs: Set<string>;
  width?: number;
  height?: number;
}

function getZoneColor(type: CameraZone['zoneType'], isActive: boolean) {
  if (isActive) {
    return {
      stroke: '#f43f5e',
      fill: 'rgba(244, 63, 94, 0.35)',
      strokeWidth: 3,
    };
  }
  switch (type) {
    case 'RESTRICTED':
      return { stroke: '#ef4444', fill: 'rgba(239, 68, 68, 0.18)', strokeWidth: 2 };
    case 'REST_AREA':
      return { stroke: '#06b6d4', fill: 'rgba(6, 182, 212, 0.18)', strokeWidth: 2 };
    default:
      return { stroke: '#10b981', fill: 'rgba(16, 185, 129, 0.15)', strokeWidth: 2 };
  }
}

export function ZonePolygonLayer({
  zones,
  activeZoneSlugs,
  width = 1000,
  height = 562.5,
}: ZonePolygonLayerProps) {
  return (
    <g className="zone-polygon-layer">
      {zones.map((zone) => {
        const isActive = activeZoneSlugs.has(zone.slug);
        const color = getZoneColor(zone.zoneType, isActive);
        const points = formatPolygonPoints(zone.polygon, width, height);
        const center = getPolygonCenter(zone.polygon, width, height);

        return (
          <g key={zone.id}>
            <polygon
              points={points}
              fill={color.fill}
              stroke={color.stroke}
              strokeWidth={color.strokeWidth}
              strokeDasharray={isActive ? 'none' : '6 3'}
            />
            <rect
              x={center.x - 55}
              y={center.y - 12}
              width={110}
              height={24}
              rx={4}
              fill="rgba(15, 23, 42, 0.85)"
              stroke={color.stroke}
              strokeWidth={1}
            />
            <text
              x={center.x}
              y={center.y + 4}
              textAnchor="middle"
              fill="#f8fafc"
              fontSize="11"
              fontWeight="600"
            >
              {isActive ? `🔥 ${zone.name}` : zone.name}
            </text>
          </g>
        );
      })}
    </g>
  );
}
