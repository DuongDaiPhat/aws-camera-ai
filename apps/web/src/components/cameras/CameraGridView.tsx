'use client';

import React, { useEffect, useMemo, useState } from 'react';
import type { Camera } from '@/types';
import { CameraGridTile } from './CameraGridTile';
import styles from './styles/camera-grid.module.css';

interface GridToolbarProps {
  onlineCount: number;
  totalCount: number;
  layout: 'auto' | '2' | '3';
  showOsd: boolean;
  showDetections: boolean;
  focusedId: string | null;
  onResetFocus: () => void;
  onLayoutChange: (layout: 'auto' | '2' | '3') => void;
  onToggleOsd: () => void;
  onToggleDetections: () => void;
  onSwitchToList: () => void;
}

function GridToolbar({
  onlineCount,
  totalCount,
  layout,
  showOsd,
  showDetections,
  focusedId,
  onResetFocus,
  onLayoutChange,
  onToggleOsd,
  onToggleDetections,
  onSwitchToList,
}: GridToolbarProps) {
  return (
    <div className={styles.gridToolbar}>
      <div className={styles.toolbarLeft}>
        <span className={styles.wallTitle}>
          <span className={styles.wallLiveDot} />
          Tường giám sát toàn bộ Camera
        </span>
        <span className={styles.cameraCountBadge}>
          {onlineCount}/{totalCount} Camera đang online
        </span>
      </div>

      <div className={styles.toolbarRight}>
        {focusedId && (
          <button
            type="button"
            className={styles.actionBtn}
            onClick={onResetFocus}
            title="Hiện lại toàn bộ camera"
          >
            Hiện tất cả ({totalCount})
          </button>
        )}

        <div className={styles.segmentedGroup}>
          <button
            type="button"
            className={`${styles.segBtn} ${layout === 'auto' ? styles.segBtnActive : ''}`}
            onClick={() => onLayoutChange('auto')}
            title="Tự động phân bổ lưới"
          >
            Tự động
          </button>
          <button
            type="button"
            className={`${styles.segBtn} ${layout === '2' ? styles.segBtnActive : ''}`}
            onClick={() => onLayoutChange('2')}
            title="Lưới 2 cột (2x2)"
          >
            Lưới 2x2
          </button>
          <button
            type="button"
            className={`${styles.segBtn} ${layout === '3' ? styles.segBtnActive : ''}`}
            onClick={() => onLayoutChange('3')}
            title="Lưới 3 cột (3x2)"
          >
            Lưới 3x2
          </button>
        </div>

        <button
          type="button"
          className={`${styles.actionBtn} ${showOsd ? styles.actionBtnActive : ''}`}
          onClick={onToggleOsd}
          title="Bật/Tắt hiển thị thông số camera trên màn hình"
        >
          OSD: {showOsd ? 'BẬT' : 'TẮT'}
        </button>

        <button
          type="button"
          className={`${styles.actionBtn} ${showDetections ? styles.actionBtnActive : ''}`}
          onClick={onToggleDetections}
          title="Bật/Tắt khung nhận diện người AI"
        >
          AI Box: {showDetections ? 'BẬT' : 'TẮT'}
        </button>

        <button
          type="button"
          className={styles.actionBtn}
          onClick={onSwitchToList}
          title="Chuyển sang chế độ danh sách & cấu hình"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <line x1="8" y1="6" x2="21" y2="6" />
            <line x1="8" y1="12" x2="21" y2="12" />
            <line x1="8" y1="18" x2="21" y2="18" />
            <line x1="3" y1="6" x2="3.01" y2="6" />
            <line x1="3" y1="12" x2="3.01" y2="12" />
            <line x1="3" y1="18" x2="3.01" y2="18" />
          </svg>
          Dạng danh sách
        </button>
      </div>
    </div>
  );
}

interface CameraGridViewProps {
  cameras: Camera[];
  selectedCameraId?: string | null;
  isAdmin?: boolean;
  onSelectCamera: (cameraId: string) => void;
  onSwitchToList: (cameraId?: string) => void;
  onToggleState: (cameraId: string, isEnabled: boolean) => void;
}

export function CameraGridView({
  cameras,
  selectedCameraId,
  onSelectCamera,
  onSwitchToList,
  onToggleState,
}: CameraGridViewProps) {
  const [layout, setLayout] = useState<'auto' | '2' | '3'>('auto');
  const [showOsd, setShowOsd] = useState(true);
  const [showDetections, setShowDetections] = useState(true);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [currentTimeString, setCurrentTimeString] = useState('');

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const d = pad(now.getDate());
      const m = pad(now.getMonth() + 1);
      const y = now.getFullYear();
      const h = pad(now.getHours());
      const min = pad(now.getMinutes());
      const s = pad(now.getSeconds());
      setCurrentTimeString(`${d}-${m}-${y} ${h}:${min}:${s}`);
    };

    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, []);

  const onlineCount = useMemo(
    () => cameras.filter((c) => c.isEnabled && c.runtimeStatus === 'ONLINE').length,
    [cameras],
  );

  const displayedCameras = useMemo(() => {
    if (focusedId) return cameras.filter((c) => c.id === focusedId);
    return cameras;
  }, [cameras, focusedId]);

  const gridClass = useMemo(() => {
    if (focusedId || cameras.length === 1) return styles.gridColsAuto;
    if (layout === '2') return styles.gridCols2;
    if (layout === '3') return styles.gridCols3;
    return cameras.length <= 4 ? styles.gridCols2 : styles.gridCols3;
  }, [layout, focusedId, cameras.length]);

  return (
    <div className={styles.gridContainer}>
      <GridToolbar
        onlineCount={onlineCount}
        totalCount={cameras.length}
        layout={layout}
        showOsd={showOsd}
        showDetections={showDetections}
        focusedId={focusedId}
        onResetFocus={() => setFocusedId(null)}
        onLayoutChange={setLayout}
        onToggleOsd={() => setShowOsd((prev) => !prev)}
        onToggleDetections={() => setShowDetections((prev) => !prev)}
        onSwitchToList={() => onSwitchToList(selectedCameraId ?? undefined)}
      />

      {displayedCameras.length === 0 ? (
        <div className={styles.emptyState}>
          <span className={styles.emptyStateTitle}>Chưa có camera nào trong hệ thống</span>
          <p style={{ margin: 0, fontSize: '13px' }}>
            Vui lòng chuyển sang chế độ danh sách để thêm hoặc cấu hình camera.
          </p>
          <button
            type="button"
            className={styles.actionBtn}
            onClick={() => onSwitchToList()}
            style={{ marginTop: '10px' }}
          >
            Quay lại danh sách
          </button>
        </div>
      ) : (
        <div className={`${styles.matrixGrid} ${gridClass}`}>
          {displayedCameras.map((cam) => (
            <CameraGridTile
              key={cam.id}
              camera={cam}
              showOsd={showOsd}
              showDetections={showDetections}
              isFocused={focusedId === cam.id}
              currentTimeString={currentTimeString}
              onSelect={() => onSelectCamera(cam.id)}
              onSwitchToList={() => onSwitchToList(cam.id)}
              onToggleState={(id, isEnabled) => onToggleState(id, isEnabled)}
              onToggleFocus={() => setFocusedId(focusedId === cam.id ? null : cam.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
