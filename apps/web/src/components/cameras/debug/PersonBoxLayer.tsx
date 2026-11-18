'use client';

import React from 'react';

export interface DetectedPerson {
  id?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  label?: string;
}

interface PersonBoxLayerProps {
  person: DetectedPerson;
  showFootpoint: boolean;
  width?: number;
  height?: number;
  kind?: 'person' | 'fall' | 'fire' | 'smoke';
}

const detectionStyle = {
  person: { label: 'person', stroke: '#38bdf8', background: '#0284c7' },
  fall: { label: 'Té ngã', stroke: '#fbbf24', background: '#92400e' },
  fire: { label: 'Lửa', stroke: '#fb7185', background: '#be123c' },
  smoke: { label: 'Khói', stroke: '#d8b4fe', background: '#6d28d9' },
};

export function PersonBoxLayer({
  person,
  showFootpoint,
  width = 1000,
  height = 562.5,
  kind = 'person',
}: PersonBoxLayerProps) {
  const appearance = detectionStyle[kind];
  const label =
    kind === 'person' && person.label && person.label.toLowerCase() !== 'person'
      ? person.label
      : appearance.label;
  const targetX = person.x * width;
  const targetY = person.y * height;
  const targetW = person.width * width;
  const targetH = person.height * height;

  const footX = targetX + targetW / 2;
  const footY = targetY + targetH;
  const labelWidth = Math.max(100, label.length * 7 + 48);
  const labelX = Math.max(0, Math.min(targetX, width - labelWidth));

  return (
    <g className="person-box-layer">
      {/* Khung bao người (Bounding box) */}
      <rect
        x={targetX}
        y={targetY}
        width={targetW}
        height={targetH}
        fill={`${appearance.stroke}1f`}
        stroke={appearance.stroke}
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
        rx={4}
      />

      {/* Header nhãn nhận diện */}
      <rect
        x={labelX}
        y={Math.max(0, targetY - 22)}
        width={labelWidth}
        height={22}
        rx={3}
        fill={appearance.background}
      />
      <text
        x={labelX + 6}
        y={Math.max(15, targetY - 7)}
        fill="#ffffff"
        fontSize="11"
        fontWeight="bold"
      >
        {label} {(person.confidence * 100).toFixed(0)}%
      </text>

      {/* Điểm chân đế (Frigate Foot-point) */}
      {showFootpoint && (
        <g className="frigate-foot-point">
          {/* Vòng tròn lan tỏa */}
          <circle
            cx={footX}
            cy={footY}
            r={14}
            fill="none"
            stroke="#f43f5e"
            strokeWidth="1.5"
            strokeDasharray="4 2"
          />
          {/* Điểm chân đế chính giữa cạnh đáy */}
          <circle cx={footX} cy={footY} r={6} fill="#f43f5e" stroke="#ffffff" strokeWidth="2" />
          <text
            x={footX}
            y={footY + 16}
            textAnchor="middle"
            fill="#f43f5e"
            fontSize="10"
            fontWeight="bold"
            style={{ textShadow: '0 1px 3px rgba(0,0,0,0.9)' }}
          >
            ● foot-point
          </text>
        </g>
      )}
    </g>
  );
}
