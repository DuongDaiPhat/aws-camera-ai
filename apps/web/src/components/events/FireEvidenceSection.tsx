'use client';

import { useEffect, useRef, useState } from 'react';
import type { EventDetail } from '@/types';
import { fireEvidence } from '@/lib/fire-evidence';
import styles from './event-detail-modal.module.css';

export function FireEvidenceSection({ detail }: { detail: EventDetail | null }) {
  const evidence = fireEvidence(detail);
  if (!evidence) return null;
  return (
    <section className={styles.aiSection} aria-label="Bằng chứng lửa">
      <h3 className={styles.sectionTitle}>Dấu hiệu lửa</h3>
      <p>
        Đã xác nhận từ {evidence.count} khung hình liên tiếp trong tối đa {evidence.window} giây.
      </p>
      <ul>
        {evidence.detections.map((item, index) => (
          <li key={`${item.label}-${index}`}>
            Lửa — độ tin cậy {Math.round(item.confidence * 100)}%
          </li>
        ))}
      </ul>
    </section>
  );
}

export function FireBoxes({
  detail,
  width,
  height,
}: {
  detail: EventDetail | null;
  width: number;
  height: number;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const [labelScale, setLabelScale] = useState(1);
  const evidence = fireEvidence(detail);
  const hasEvidence = Boolean(evidence);
  useEffect(() => {
    const element = ref.current;
    if (!element || !width || !height) return;
    const resize = () => {
      const size = element.getBoundingClientRect();
      if (size.width && size.height)
        setLabelScale(Math.max(width / size.width, height / size.height));
    };
    resize();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
    observer?.observe(element);
    return () => observer?.disconnect();
  }, [width, height, hasEvidence]);
  if (!evidence || !width || !height) return null;
  return (
    <svg
      ref={ref}
      className={styles.fireBoxes}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Vị trí lửa trên ảnh bằng chứng"
    >
      {evidence.detections.map((item, index) => {
        const box = item.boundingBox;
        const x = box.x * width;
        const y = box.y * height;
        return (
          <g key={`${item.label}-${index}`} stroke="#ff654f">
            <rect
              x={x}
              y={y}
              width={box.width * width}
              height={box.height * height}
              fill="none"
              strokeWidth={3}
              vectorEffect="non-scaling-stroke"
            />
            <text
              x={Math.max(0, Math.min(x + 4 * labelScale, width - 100 * labelScale))}
              y={Math.max(20 * labelScale, y - 7 * labelScale)}
              fontSize={14 * labelScale}
              fill="white"
              stroke="#111827"
              strokeWidth="3"
              vectorEffect="non-scaling-stroke"
              paintOrder="stroke"
            >
              Lửa {Math.round(item.confidence * 100)}%
            </text>
          </g>
        );
      })}
    </svg>
  );
}
