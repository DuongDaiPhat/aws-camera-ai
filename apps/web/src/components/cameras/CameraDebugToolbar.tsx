'use client';

import React from 'react';
import styles from './styles/camera-preview.module.css';

interface CameraDebugToolbarProps {
  debugEnabled: boolean;
  showPerson: boolean;
  showZone: boolean;
  onToggleDebug: () => void;
  onTogglePerson: () => void;
  onToggleZone: () => void;
}

export function CameraDebugToolbar({
  debugEnabled,
  showPerson,
  showZone,
  onToggleDebug,
  onTogglePerson,
  onToggleZone,
}: CameraDebugToolbarProps) {
  return (
    <div className={styles.controlsBar}>
      <div className={styles.toggleGroup}>
        <button
          type="button"
          className={`${styles.toggleBtn} ${debugEnabled ? styles.toggleBtnActive : ''}`}
          onClick={onToggleDebug}
          title="Bật/tắt lớp hiển thị Debug View"
        >
          <span
            className={`${styles.statusIndicator} ${debugEnabled ? styles.statusIndicatorActive : ''}`}
          />
          Debug View: {debugEnabled ? 'BẬT' : 'TẮT'}
        </button>

        {debugEnabled && (
          <>
            <button
              type="button"
              className={`${styles.toggleBtn} ${showPerson ? styles.toggleBtnActive : ''}`}
              onClick={onTogglePerson}
              title="Bật/tắt hiển thị khung bao người (Bounding box)"
            >
              👤 Person boundary: {showPerson ? 'ON' : 'OFF'}
            </button>

            <button
              type="button"
              className={`${styles.toggleBtn} ${showZone ? styles.toggleBtnZoneActive : ''}`}
              onClick={onToggleZone}
              title="Bật/tắt hiển thị đa giác vùng giám sát (Zones)"
            >
              📍 Zone boundary: {showZone ? 'ON' : 'OFF'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
