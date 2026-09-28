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
}

export function PersonBoxLayer({
  person,
  showFootpoint,
  width = 1000,
  height = 562.5,
}: PersonBoxLayerProps) {
  const targetX = person.x * width;
  const targetY = person.y * height;
  const targetW = person.width * width;
  const targetH = person.height * height;

  const footX = targetX + targetW / 2;
  const footY = targetY + targetH;

  return (
    <g className="person-box-layer">
      {/* Khung bao người (Bounding box) */}
      <rect
        x={targetX}
        y={targetY}
        width={targetW}
        height={targetH}
        fill="rgba(56, 189, 248, 0.12)"
        stroke="#38bdf8"
        strokeWidth="2"
        rx={4}
      />

      {/* Header nhãn nhận diện */}
      <rect
        x={targetX}
        y={Math.max(0, targetY - 22)}
        width={100}
        height={22}
        rx={3}
        fill="#0284c7"
      />
      <text
        x={targetX + 6}
        y={Math.max(15, targetY - 7)}
        fill="#ffffff"
        fontSize="11"
        fontWeight="bold"
      >
        👤 {person.label ?? 'person'} {(person.confidence * 100).toFixed(0)}%
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
