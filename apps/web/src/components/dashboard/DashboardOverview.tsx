'use client';

import { memo, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDialogFocus } from '@/hooks/useDialogFocus';
import { Maximize2, Minimize2, ChevronLeft, ChevronRight, LayoutGrid } from 'lucide-react';
import type { Camera } from '@/types';
import { useCameras } from '@/hooks/useCameras';
import { useCameraLayout } from '@/hooks/useCameraLayout';
import { useCameraOrder } from '@/hooks/useCameraOrder';
import { LiveCameraViewport } from '@/components/cameras/LiveCameraViewport';
import { Icon } from '@/components/ui/Icon';
import { SelectMenu } from '@/components/ui/SelectMenu';
import { cameraGrid } from '@/lib/camera-grid';
import { CameraAreas } from './CameraAreas';
import styles from './dashboard-overview.module.css';

const LiveCamera = memo(function LiveCamera({ camera }: { camera: Camera }) {
  return (
    <div className={styles.liveFrame}>
      <LiveCameraViewport camera={camera} />
      <span className={styles.frameLabel}>
        <Icon name="camera" size={15} />
        {camera.name}
      </span>
    </div>
  );
});

export function DashboardOverview({
  userId,
  isAdmin,
  blocked,
  onNavigate,
  onReady,
}: {
  userId?: string;
  onReady?: () => void;
  isAdmin: boolean;
  blocked?: boolean;
  onNavigate: (page: string) => void;
}) {
  const {
    cameras,
    selectedCamera,
    selectCamera,
    isLoading,
    error,
    loadCameras,
    toggleCamera,
    toggleLoadingMap,
  } = useCameras();
  const { ordered, save } = useCameraOrder(cameras, userId);
  const {
    layout,
    custom,
    setLayout,
    setCustom,
    ready: layoutReady,
    saveError,
  } = useCameraLayout(userId);
  useEffect(() => {
    if (!isLoading && layoutReady) onReady?.();
  }, [isLoading, layoutReady, onReady]);
  const [page, setPage] = useState(0);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [fullscreenId, setFullscreenId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const expandedRef = useDialogFocus(Boolean(expandedId) && !blocked, () => setExpandedId(null));
  const screenId = fullscreenId ?? expandedId;
  const panelRef = useRef<HTMLElement>(null);
  const requested = layout === 'custom' ? custom : Number(layout);
  const available = ordered.filter((camera) => camera.isEnabled);
  const grid = cameraGrid(available, pinnedId, requested, page);
  const pages = grid.pages,
    currentPage = grid.currentPage;
  const visible =
    expandedId && expandedId !== 'camera-monitor'
      ? available.filter((camera) => 'live-' + camera.id === expandedId)
      : grid.visible;
  const columns = visible.length <= 2 ? visible.length : visible.length <= 4 ? 2 : 3;
  useEffect(() => {
    const changed = () => setFullscreenId(document.fullscreenElement?.id ?? null);
    document.addEventListener('fullscreenchange', changed);
    return () => {
      document.removeEventListener('fullscreenchange', changed);
    };
  }, []);
  useEffect(() => {
    if (blocked) setExpandedId(null);
    if (
      blocked &&
      document.fullscreenElement &&
      panelRef.current?.contains(document.fullscreenElement)
    )
      void document.exitFullscreen().catch(() => {});
  }, [blocked]);
  function choose(id: string) {
    selectCamera(id);
    setPinnedId(id);
    setPage(0);
  }
  async function fullscreen(element: HTMLElement | null) {
    if (expandedId) {
      setExpandedId(element?.id === expandedId ? null : (element?.id ?? null));
      return;
    }
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (element?.requestFullscreen) await element.requestFullscreen();
      else setExpandedId(element?.id ?? 'camera-monitor');
    } catch {
      setExpandedId(element?.id ?? 'camera-monitor');
    }
  }
  const monitor = (
    <section
      className={styles.cameraPanel}
      id="camera-monitor"
      data-entry-part="camera"
      data-expanded={Boolean(expandedId)}
      ref={panelRef}
      aria-labelledby="live-camera-title"
    >
      <div className={styles.sectionHeading}>
        <h2 id="live-camera-title">
          <Icon name="camera" size={20} />
          Camera
        </h2>
        <div className={styles.cameraChoice}>
          <SelectMenu
            label="Chọn camera"
            tone="violet"
            value={visible[0]?.id ?? selectedCamera?.id ?? ''}
            disabled={!available.length}
            options={
              available.length
                ? available.map((camera) => ({ value: camera.id, label: camera.name }))
                : [{ value: '', label: 'Chưa có camera' }]
            }
            onChange={choose}
          />
        </div>
        <div className={styles.layoutControls}>
          <SelectMenu
            label="Số camera hiển thị"
            disabled={!layoutReady}
            value={layout}
            icon={<LayoutGrid size={15} />}
            options={[
              ...[1, 2, 4, 6, 8].map((n) => ({ value: String(n), label: `${n} camera` })),
              { value: 'custom', label: 'Tùy chỉnh' },
            ]}
            onChange={(value) => {
              setLayout(value);
              setPage(0);
            }}
          />
          {layout === 'custom' && (
            <input
              className={styles.customCount}
              type="number"
              min={1}
              max={64}
              aria-label="Số camera tùy chỉnh"
              value={custom}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (Number.isInteger(value) && value > 0) {
                  setCustom(Math.min(value, 64));
                  setPage(0);
                }
              }}
            />
          )}
          <button
            type="button"
            className={styles.iconButton}
            aria-label={
              screenId === 'camera-monitor' ? 'Thu nhỏ lưới camera' : 'Phóng to lưới camera'
            }
            title="Toàn màn hình"
            onClick={() => void fullscreen(panelRef.current)}
          >
            {screenId === 'camera-monitor' ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
          </button>
        </div>
      </div>
      {error && (
        <div className={styles.error} role="alert">
          {error}
          <button type="button" onClick={() => void loadCameras()}>
            Thử lại
          </button>
        </div>
      )}
      {!isLoading && requested > available.length && available.length > 0 && (
        <p className={styles.preferenceNotice} role="alert">
          Hiện tại chỉ có tối đa {available.length} camera đang bật. Bố cục tối đa là{' '}
          {available.length}, thay vì {requested} khung.
        </p>
      )}
      {saveError && (
        <p className={styles.preferenceNotice} role="status">
          {saveError}
        </p>
      )}
      {isLoading || !layoutReady ? (
        <div className={styles.placeholder} role="status">
          Đang tải camera…
        </div>
      ) : !available.length ? (
        <div className={styles.placeholder}>
          <Icon name="camera" size={32} />
          <strong>
            {ordered.length ? 'Chưa có camera đang bật' : 'Chưa có camera được cấp quyền'}
          </strong>
          <button type="button" onClick={() => onNavigate('cameras')}>
            Mở trang Camera
          </button>
        </div>
      ) : (
        <>
          <div
            className={styles.monitorGrid}
            style={{
              gridTemplateColumns: `repeat(${columns || 1}, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${Math.ceil(visible.length / (columns || 1))}, minmax(0, 1fr))`,
            }}
            aria-label="Lưới camera trực tiếp"
            data-count={visible.length}
          >
            {visible.map((camera) => (
              <article
                key={camera.id}
                id={`live-${camera.id}`}
                className={styles.tile}
                data-selected={camera.id === (visible[0]?.id ?? selectedCamera?.id)}
              >
                <LiveCamera camera={camera} />
                <button
                  type="button"
                  className={styles.tileExpand}
                  aria-label={`${screenId === `live-${camera.id}` ? 'Thu nhỏ' : 'Phóng to'} ${camera.name}`}
                  onClick={(event) => void fullscreen(event.currentTarget.parentElement)}
                >
                  {screenId === `live-${camera.id}` ? (
                    <Minimize2 size={15} />
                  ) : (
                    <Maximize2 size={15} />
                  )}
                </button>
              </article>
            ))}
          </div>
          <footer className={styles.monitorFooter}>
            <span>
              {visible.length} / {available.length} camera{' '}
              <span className={styles.priorityHint}>· Theo ưu tiên khu vực</span>
            </span>
            <div>
              <button
                type="button"
                aria-label="Lưới camera trước"
                disabled={currentPage === 0}
                onClick={() => setPage(currentPage - 1)}
              >
                <ChevronLeft size={15} />
              </button>
              <span>
                {currentPage + 1} / {pages}
              </span>
              <button
                type="button"
                aria-label="Lưới camera sau"
                disabled={currentPage === pages - 1}
                onClick={() => setPage(currentPage + 1)}
              >
                <ChevronRight size={15} />
              </button>
            </div>
          </footer>
        </>
      )}
    </section>
  );
  return (
    <div className={styles.grid}>
      {expandedId && !blocked
        ? createPortal(
            <div
              className={styles.expandedOverlay}
              role="dialog"
              aria-modal="true"
              aria-label="Camera toàn màn hình"
              tabIndex={-1}
              ref={expandedRef}
            >
              {monitor}
              <button
                type="button"
                className={styles.exitExpanded}
                aria-label="Đóng camera toàn màn hình"
                onClick={() => setExpandedId(null)}
              >
                <Minimize2 size={16} />
                Thoát toàn màn hình
              </button>
            </div>,
            document.body,
          )
        : monitor}
      <CameraAreas
        cameras={ordered}
        selectedId={visible[0]?.id ?? selectedCamera?.id}
        onSelect={choose}
        isLoading={isLoading}
        isAdmin={isAdmin}
        blocked={blocked}
        toggleLoadingMap={toggleLoadingMap}
        onToggle={toggleCamera}
        error={error}
        onSaveOrder={(ids) => {
          const message = save(ids);
          setPage(0);
          setPinnedId(null);
          const firstEnabled = ids.find((id) =>
            cameras.some((camera) => camera.id === id && camera.isEnabled),
          );
          if (firstEnabled) selectCamera(firstEnabled);
          return message;
        }}
      />
    </div>
  );
}
