'use client';

import { Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { EventDetail } from '@/types';
import { fireEvidence } from '@/lib/fire-evidence';
import { FlameFluentIcon } from './FireAlertIcons';
import styles from './event-detail-modal.module.css';

export function FireEvidenceSection({
  detail,
  isSyncing = false,
}: {
  detail: EventDetail | null;
  isSyncing?: boolean;
}) {
  const evidence = fireEvidence(detail);
  if (!evidence) {
    if (!isSyncing) return null;
    return (
      <section className={styles.fireEvidenceCard} aria-label="Bằng chứng lửa">
        <div className={styles.evidenceCardHeader}>
          <h3 className={styles.sectionTitle}>Phân tích dấu hiệu lửa</h3>
        </div>
        <p className={styles.evidenceSyncNote} role="status">
          <Loader2 size={15} className={styles.spinIcon} aria-hidden="true" />
          <span>Đang nhận khung hình xác nhận từ mô hình AI…</span>
        </p>
      </section>
    );
  }
  return (
    <section className={styles.fireEvidenceCard} aria-label="Bằng chứng lửa">
      <div className={styles.evidenceCardHeader}>
        <h3 className={styles.sectionTitle}>Phân tích dấu hiệu lửa</h3>
        <span className={styles.evidenceFrameBadge}>
          {evidence.count} khung hình / {evidence.window}s
        </span>
      </div>
      <p className={styles.evidenceSummaryText}>
        Đã xác nhận từ {evidence.count} khung hình liên tiếp trong tối đa {evidence.window} giây.
      </p>
      <ul className={styles.detectionChipList}>
        {evidence.detections.map((item, index) => (
          <li key={`${item.label}-${index}`} className={styles.detectionChip}>
            <FlameFluentIcon size={16} />
            <span>Lửa — độ tin cậy {Math.round(item.confidence * 100)}%</span>
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
          <g key={`${item.label}-${index}`} stroke="#ff6347">
            <rect
              x={x}
              y={y}
              width={box.width * width}
              height={box.height * height}
              rx={4 * labelScale}
              fill="rgba(255, 99, 71, 0.14)"
              strokeWidth={3}
              vectorEffect="non-scaling-stroke"
            />
            <text
              x={Math.max(0, Math.min(x + 4 * labelScale, width - 100 * labelScale))}
              y={Math.max(20 * labelScale, y - 7 * labelScale)}
              fontSize={14 * labelScale}
              fontWeight={700}
              fill="white"
              stroke="#140c21"
              strokeWidth="3.5"
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
