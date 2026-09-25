'use client';

import { useMemo, useState } from 'react';
import type { Camera, CurrentUser } from '@/types';
import { useCameras } from '@/hooks/useCameras';
import { CameraList } from './CameraList';
import { CameraSourceForm } from './CameraSourceForm';
import { CameraPreview } from './CameraPreview';
import { CameraSettingsPanel } from './CameraSettingsPanel';
import styles from './styles/camera-view.module.css';

interface CameraViewProps {
  user: CurrentUser | null;
}

function CameraSummaryBanner({
  total,
  active,
  online,
  errors,
}: {
  total: number;
  active: number;
  online: number;
  errors: number;
}) {
  return (
    <div className={styles.summaryBanner}>
      <div className={styles.summaryCard}>
        <span className={styles.summaryLabel}>Tổng số camera</span>
        <span className={styles.summaryValue}>{total}</span>
      </div>
      <div className={styles.summaryCard}>
        <span className={styles.summaryLabel}>Đang kích hoạt (Config)</span>
        <span className={styles.summaryValue}>{active}</span>
      </div>
      <div className={styles.summaryCard}>
        <span className={styles.summaryLabel}>Đang online (Runtime)</span>
        <span className={`${styles.summaryValue} ${styles.summaryValueOnline}`}>{online}</span>
      </div>
      <div className={styles.summaryCard}>
        <span className={styles.summaryLabel}>Lỗi kết nối</span>
        <span className={`${styles.summaryValue} ${errors > 0 ? styles.summaryValueErrors : ''}`}>
          {errors}
        </span>
      </div>
    </div>
  );
}

function CameraDetailPanel({
  camera,
  isAdmin,
  isToggling,
  onToggleState,
  onRefreshCameras,
}: {
  camera: Camera | null;
  isAdmin: boolean;
  isToggling: boolean;
  onToggleState: (id: string, isEnabled: boolean) => void;
  onRefreshCameras?: () => void;
}) {
  const [activeTab, setActiveTab] = useState<'preview' | 'source' | 'frigate'>('preview');

  if (!camera) {
    return (
      <div className={styles.detailColumn}>
        <div className={styles.emptyState}>
          <span>Vui lòng chọn một camera để xem chi tiết.</span>
        </div>
      </div>
    );
  }

  const resolution =
    camera.detectWidth && camera.detectHeight
      ? `${camera.detectWidth}x${camera.detectHeight}`
      : '1280x720';

  return (
    <div className={styles.detailColumn}>
      <div className={styles.detailHeader}>
        <div className={styles.titles}>
          <h2 className={styles.detailTitle}>{camera.name}</h2>
          <span className={styles.subtitle}>
            Độ phân giải: {resolution} · {camera.fps} FPS · Nguồn: {camera.sourceType}
          </span>
        </div>

        {isAdmin && (
          <button
            type="button"
            className={camera.isEnabled ? styles.refreshBtn : styles.addBtn}
            disabled={isToggling}
            onClick={() => onToggleState(camera.id, !camera.isEnabled)}
          >
            {isToggling && <span className={styles.spinner} style={{ marginRight: '6px' }} />}
            {camera.isEnabled ? 'Tắt camera' : 'Bật camera'}
          </button>
        )}
      </div>

      <div className={styles.tabControls}>
        <button
          type="button"
          className={`${styles.tabBtn} ${activeTab === 'preview' ? styles.tabBtnActive : ''}`}
          onClick={() => setActiveTab('preview')}
        >
          Luồng xem trực tiếp & Debug View
        </button>
        <button
          type="button"
          className={`${styles.tabBtn} ${activeTab === 'source' ? styles.tabBtnActive : ''}`}
          onClick={() => setActiveTab('source')}
        >
          Cấu hình nguồn phát ({camera.sourceType})
        </button>
        <button
          type="button"
          className={`${styles.tabBtn} ${activeTab === 'frigate' ? styles.tabBtnActive : ''}`}
          onClick={() => setActiveTab('frigate')}
        >
          Cài đặt Frigate & Đồng bộ
        </button>
      </div>

      {activeTab === 'preview' && <CameraPreview camera={camera} />}

      {activeTab === 'source' && (
        <CameraSourceForm
          cameraId={camera.id}
          slug={camera.slug}
          initialSourceType={camera.sourceType}
          initialRtspUrl={camera.rtspUrl}
          isAdmin={isAdmin}
          onSourceUpdated={onRefreshCameras}
        />
      )}

      {activeTab === 'frigate' && (
        <CameraSettingsPanel camera={camera} isAdmin={isAdmin} onSynced={onRefreshCameras} />
      )}
    </div>
  );
}

export function CameraView({ user }: CameraViewProps) {
  const {
    cameras,
    selectedCameraId,
    selectedCamera,
    isLoading,
    error,
    toggleLoadingMap,
    loadCameras,
    selectCamera,
    toggleCamera,
  } = useCameras();

  const isAdmin = user?.role === 'ADMIN';

  const stats = useMemo(() => {
    const total = cameras.length;
    const active = cameras.filter((c) => c.isEnabled).length;
    const online = cameras.filter((c) => c.runtimeStatus === 'ONLINE').length;
    const errors = cameras.filter(
      (c) => c.runtimeStatus === 'FAILED' || c.syncStatus === 'FAILED',
    ).length;
    return { total, active, online, errors };
  }, [cameras]);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.titles}>
          <h1 className={styles.title}>Quản lý Camera & Nguồn phát</h1>
          <p className={styles.subtitle}>
            Giám sát trạng thái hoạt động, cấu hình nguồn cấp (RTSP, Webcam, Video) và kiểm thử
            Debug View.
          </p>
        </div>

        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.refreshBtn}
            onClick={() => void loadCameras()}
            title="Làm mới trạng thái"
            disabled={isLoading}
          >
            {isLoading ? (
              <span className={styles.spinner} />
            ) : (
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M23 4v6h-6" />
                <path d="M1 20v-6h6" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
            )}
            Làm mới
          </button>
        </div>
      </div>

      {error && (
        <div className={styles.errorBanner}>
          <span>{error}</span>
          <button type="button" className={styles.refreshBtn} onClick={() => void loadCameras()}>
            Thử lại
          </button>
        </div>
      )}

      <CameraSummaryBanner
        total={stats.total}
        active={stats.active}
        online={stats.online}
        errors={stats.errors}
      />

      <div className={styles.contentGrid}>
        <CameraList
          cameras={cameras}
          selectedId={selectedCameraId}
          isAdmin={isAdmin}
          toggleLoadingMap={toggleLoadingMap}
          onSelectCamera={selectCamera}
          onToggleState={(id, isEnabled) => void toggleCamera(id, isEnabled)}
        />

        <CameraDetailPanel
          camera={selectedCamera}
          isAdmin={isAdmin}
          isToggling={Boolean(selectedCamera && toggleLoadingMap[selectedCamera.id])}
          onToggleState={(id, isEnabled) => void toggleCamera(id, isEnabled)}
          onRefreshCameras={() => void loadCameras()}
        />
      </div>
    </div>
  );
}
