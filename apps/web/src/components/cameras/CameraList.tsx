'use client';

import { useMemo, useState } from 'react';
import type { Camera } from '@/types';
import { CameraCard } from './CameraCard';
import styles from './styles/camera-view.module.css';

export type FilterTab = 'ALL' | 'ACTIVE' | 'INACTIVE' | 'ERROR';

interface CameraListProps {
  cameras: Camera[];
  selectedId: string | null;
  isAdmin: boolean;
  toggleLoadingMap?: Record<string, boolean>;
  onSelectCamera: (id: string) => void;
  onToggleState: (id: string, isEnabled: boolean) => void;
}

export function CameraList({
  cameras,
  selectedId,
  isAdmin,
  toggleLoadingMap = {},
  onSelectCamera,
  onToggleState,
}: CameraListProps) {
  const [filterTab, setFilterTab] = useState<FilterTab>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredCameras = useMemo(() => {
    return cameras.filter((cam) => {
      // 1. Lọc theo tab
      if (filterTab === 'ACTIVE' && !cam.isEnabled) return false;
      if (filterTab === 'INACTIVE' && cam.isEnabled) return false;
      if (filterTab === 'ERROR' && cam.runtimeStatus !== 'FAILED' && cam.syncStatus !== 'FAILED') {
        return false;
      }

      // 2. Tìm kiếm theo keyword
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const matchesName = cam.name.toLowerCase().includes(query);
        const matchesSlug = cam.slug.toLowerCase().includes(query);
        return matchesName || matchesSlug;
      }

      return true;
    });
  }, [cameras, filterTab, searchQuery]);

  return (
    <div className={styles.listColumn}>
      <div className={styles.listHeader}>
        <h2 className={styles.listTitle}>Danh sách camera ({cameras.length})</h2>
        <div className={styles.filterTabs} role="tablist">
          {(['ALL', 'ACTIVE', 'INACTIVE', 'ERROR'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              className={`${styles.filterTab} ${filterTab === tab ? styles.filterTabActive : ''}`}
              onClick={() => setFilterTab(tab)}
            >
              {tab === 'ALL'
                ? 'Tất cả'
                : tab === 'ACTIVE'
                  ? 'Bật'
                  : tab === 'INACTIVE'
                    ? 'Tắt'
                    : 'Lỗi'}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.searchInputWrapper}>
        <svg
          className={styles.searchIcon}
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="text"
          className={styles.searchInput}
          placeholder="Tìm theo tên hoặc slug camera..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      <div className={styles.cameraCardsList}>
        {filteredCameras.length === 0 ? (
          <div className={styles.emptyState}>
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="8" y1="12" x2="16" y2="12" />
            </svg>
            <span>Không tìm thấy camera nào phù hợp.</span>
          </div>
        ) : (
          filteredCameras.map((cam) => (
            <CameraCard
              key={cam.id}
              camera={cam}
              isSelected={cam.id === selectedId}
              isAdmin={isAdmin}
              isToggling={Boolean(toggleLoadingMap[cam.id])}
              onSelect={onSelectCamera}
              onToggleState={onToggleState}
            />
          ))
        )}
      </div>
    </div>
  );
}
