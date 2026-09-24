'use client';

import { useState } from 'react';
import type { CurrentUser } from '@/lib/auth-client';
import styles from './camera-view.module.css';

interface CameraViewProps {
  user: CurrentUser | null;
}

interface DemoCameraItem {
  id: string;
  name: string;
  slug: string;
  sourceType: 'RTSP' | 'BROWSER_WEBCAM' | 'VIDEO_FILE';
  isEnabled: boolean;
  runtimeStatus: 'ONLINE' | 'OFFLINE' | 'STARTING' | 'STOPPED' | 'FAILED';
  fps: number;
  resolution: string;
}

const INITIAL_CAMERAS: DemoCameraItem[] = [
  {
    id: '22222222-2222-2222-2222-222222222221',
    name: 'Phòng khách',
    slug: 'cam_living_room',
    sourceType: 'BROWSER_WEBCAM',
    isEnabled: true,
    runtimeStatus: 'ONLINE',
    fps: 5,
    resolution: '1280x720',
  },
  {
    id: '22222222-2222-2222-2222-222222222223',
    name: 'Camera thử nghiệm',
    slug: 'cam_test',
    sourceType: 'VIDEO_FILE',
    isEnabled: true,
    runtimeStatus: 'ONLINE',
    fps: 5,
    resolution: '1280x720',
  },
  {
    id: '22222222-2222-2222-2222-222222222222',
    name: 'Bếp',
    slug: 'cam_kitchen',
    sourceType: 'RTSP',
    isEnabled: false,
    runtimeStatus: 'OFFLINE',
    fps: 5,
    resolution: '1280x720',
  },
];

function CameraSummaryBanner({
  total,
  active,
  online,
}: {
  total: number;
  active: number;
  online: number;
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
        <span className={`${styles.summaryValue} ${styles.summaryValueErrors}`}>0</span>
      </div>
    </div>
  );
}

function CameraSidebarList({
  cameras,
  selectedId,
  filterTab,
  onSelectTab,
  onSelectCamera,
}: {
  cameras: DemoCameraItem[];
  selectedId: string;
  filterTab: 'ALL' | 'ACTIVE' | 'INACTIVE';
  onSelectTab: (tab: 'ALL' | 'ACTIVE' | 'INACTIVE') => void;
  onSelectCamera: (id: string) => void;
}) {
  return (
    <div className={styles.listColumn}>
      <div className={styles.listHeader}>
        <h2 className={styles.listTitle}>Danh sách camera</h2>
        <div className={styles.filterTabs} role="tablist">
          {(['ALL', 'ACTIVE', 'INACTIVE'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              className={`${styles.filterTab} ${filterTab === tab ? styles.filterTabActive : ''}`}
              onClick={() => onSelectTab(tab)}
            >
              {tab === 'ALL' ? 'Tất cả' : tab === 'ACTIVE' ? 'Bật' : 'Tắt'}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.cameraCardsList}>
        {cameras.map((cam) => {
          const isSelected = cam.id === selectedId;
          const isOnline = cam.runtimeStatus === 'ONLINE';

          return (
            <div
              key={cam.id}
              className={`${styles.cameraCardItem} ${isSelected ? styles.cameraCardActive : ''}`}
              onClick={() => onSelectCamera(cam.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') onSelectCamera(cam.id);
              }}
            >
              <div className={styles.cardTopRow}>
                <h3 className={styles.cardName}>{cam.name}</h3>
                <span
                  className={`${styles.badge} ${
                    isOnline
                      ? styles.badgeOnline
                      : cam.runtimeStatus === 'STARTING'
                        ? styles.badgeStarting
                        : styles.badgeOffline
                  }`}
                >
                  <span className={styles.badgeDot} />
                  {cam.runtimeStatus}
                </span>
              </div>

              <div className={styles.cardMetaRow}>
                <span>Slug: <code>{cam.slug}</code></span>
                <span>Nguồn: <strong>{cam.sourceType}</strong></span>
                <span>{cam.fps} FPS</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CameraDetailPanel({
  camera,
  isAdmin,
  onToggleState,
}: {
  camera: DemoCameraItem;
  isAdmin: boolean;
  onToggleState: (id: string) => void;
}) {
  const [activeTab, setActiveTab] = useState<'preview' | 'source' | 'frigate'>('preview');

  return (
    <div className={styles.detailColumn}>
      <div className={styles.detailHeader}>
        <div className={styles.titles}>
          <h2 className={styles.detailTitle}>{camera.name}</h2>
          <span className={styles.subtitle}>
            Độ phân giải: {camera.resolution} · {camera.fps} FPS · Nguồn: {camera.sourceType}
          </span>
        </div>

        {isAdmin && (
          <button
            type="button"
            className={camera.isEnabled ? styles.refreshBtn : styles.addBtn}
            onClick={() => onToggleState(camera.id)}
          >
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

      {activeTab === 'preview' && (
        <div className={styles.previewPlaceholder}>
          <div className={styles.previewOverlayBadges}>
            <span className={styles.overlayBadge}>Live · MediaMTX</span>
            <span className={styles.overlayBadge}>Debug View: Sẵn sàng</span>
          </div>
          <svg className={styles.previewPlaceholderIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M23 7l-7 5 7 5V7z" />
            <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
          </svg>
          <span className={styles.previewLabel}>
            Khung hiển thị luồng stream cho {camera.name}
          </span>
          <small style={{ color: '#64748b' }}>
            (Sẽ được tích hợp WebRTC player và 2 toggle Debug View ở Bước 4.2)
          </small>
        </div>
      )}

      {activeTab === 'source' && (
        <div className={styles.infoNotice}>
          <strong>Cấu hình nguồn phát:</strong> Camera này hiện đang cấu hình theo loại <code>{camera.sourceType}</code>. 
          Các form nhập RTSP an toàn, WebRTC publish cho Webcam và upload Video runner sẽ được tích hợp ở Bước 3.2.
        </div>
      )}

      {activeTab === 'frigate' && (
        <div className={styles.infoNotice}>
          <strong>Cài đặt đồng bộ Frigate:</strong> Độ phân giải {camera.resolution}, {camera.fps} FPS. 
          Cơ chế đồng bộ bảo toàn polygon zones của Thành viên C sẽ được tích hợp ở Bước 4.1.
        </div>
      )}
    </div>
  );
}

export function CameraView({ user }: CameraViewProps) {
  const [cameras, setCameras] = useState<DemoCameraItem[]>(INITIAL_CAMERAS);
  const [selectedCameraId, setSelectedCameraId] = useState<string>(INITIAL_CAMERAS[0].id);
  const [filterTab, setFilterTab] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');

  const isAdmin = user?.role === 'ADMIN';
  const selectedCamera = cameras.find((c) => c.id === selectedCameraId) ?? cameras[0];

  const filteredCameras = cameras.filter((cam) => {
    if (filterTab === 'ACTIVE') return cam.isEnabled;
    if (filterTab === 'INACTIVE') return !cam.isEnabled;
    return true;
  });

  const totalCameras = cameras.length;
  const activeCameras = cameras.filter((c) => c.isEnabled).length;
  const onlineCameras = cameras.filter((c) => c.runtimeStatus === 'ONLINE').length;

  const handleToggleState = (cameraId: string) => {
    if (!isAdmin) return;
    setCameras((prev) =>
      prev.map((c) =>
        c.id === cameraId
          ? {
              ...c,
              isEnabled: !c.isEnabled,
              runtimeStatus: !c.isEnabled ? 'ONLINE' : 'STOPPED',
            }
          : c,
      ),
    );
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.titles}>
          <h1 className={styles.title}>Quản lý Camera & Nguồn phát</h1>
          <p className={styles.subtitle}>
            Giám sát trạng thái hoạt động, cấu hình nguồn cấp (RTSP, Webcam, Video) và kiểm thử Debug View.
          </p>
        </div>

        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.refreshBtn}
            onClick={() => setCameras(INITIAL_CAMERAS)}
            title="Làm mới trạng thái"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M23 4v6h-6" />
              <path d="M1 20v-6h6" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
            Làm mới
          </button>

          {isAdmin && (
            <button
              type="button"
              className={styles.addBtn}
              onClick={() => alert('Chức năng thêm camera sẽ khả dụng ở Bước 2.1 cùng backend API!')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Thêm camera
            </button>
          )}
        </div>
      </div>

      <CameraSummaryBanner
        total={totalCameras}
        active={activeCameras}
        online={onlineCameras}
      />

      <div className={styles.contentGrid}>
        <CameraSidebarList
          cameras={filteredCameras}
          selectedId={selectedCameraId}
          filterTab={filterTab}
          onSelectTab={setFilterTab}
          onSelectCamera={setSelectedCameraId}
        />

        <CameraDetailPanel
          camera={selectedCamera}
          isAdmin={isAdmin}
          onToggleState={handleToggleState}
        />
      </div>
    </div>
  );
}
