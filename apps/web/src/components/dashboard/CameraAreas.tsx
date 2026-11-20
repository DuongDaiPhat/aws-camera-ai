'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronLeft,
  ChevronRight,
  GripVertical,
  Pencil,
  Check,
  X,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import type { Camera } from '@/types';
import { LiveCameraViewport } from '@/components/cameras/LiveCameraViewport';
import type { LiveStreamStatus } from '@/components/cameras/live/camera-reader';
import { useDialogFocus } from '@/hooks/useDialogFocus';
import { Icon } from '@/components/ui/Icon';
import { reconcileCameraOrder, moveCamera } from '@/lib/camera-order';
import styles from './camera-areas.module.css';

const labels: Record<string, string> = {
  ONLINE: 'Đang kết nối',
  OFFLINE: 'Ngoại tuyến',
  STARTING: 'Đang kết nối',
  FAILED: 'Lỗi kết nối',
  DISABLED: 'Đã tắt',
};

function AreaCard({
  camera,
  selected,
  editing = false,
  paused = false,
  onSelect,
}: {
  camera: Camera;
  selected: boolean;
  editing?: boolean;
  paused?: boolean;
  onSelect: () => void;
}) {
  const [playback, setPlayback] = useState<LiveStreamStatus>('connecting');
  const online = camera.isEnabled && !paused && playback === 'live';
  const label = !camera.isEnabled
    ? labels.DISABLED
    : online
      ? 'Trực tuyến'
      : playback === 'unavailable'
        ? 'Chưa có tín hiệu'
        : playback === 'unsupported'
          ? 'Chưa hỗ trợ xem trực tiếp'
          : (labels[camera.runtimeStatus] ?? 'Đang kết nối');
  return (
    <button
      type="button"
      className={styles.camera}
      aria-label={`Xem ${camera.name}`}
      aria-pressed={selected}
      disabled={editing}
      onClick={onSelect}
    >
      <span className={styles.image}>
        <LiveCameraViewport camera={camera} compact paused={paused} onStatusChange={setPlayback} />
        <span className={styles.dot} data-online={online} />
      </span>
      <strong title={camera.name}>{camera.name}</strong>
      <small>{label}</small>
    </button>
  );
}

interface Props {
  cameras: Camera[];
  selectedId?: string;
  onSelect: (id: string) => void;
  onSaveOrder: (ids: string[]) => string;
  isLoading: boolean;
  isAdmin: boolean;
  blocked?: boolean;
  toggleLoadingMap: Record<string, boolean>;
  onToggle: (id: string, enabled: boolean) => Promise<boolean>;
  error?: string | null;
}

export function CameraAreas({
  cameras,
  selectedId,
  onSelect,
  onSaveOrder,
  isLoading,
  isAdmin,
  blocked,
  toggleLoadingMap,
  onToggle,
  error,
}: Props) {
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[] | null>(null);
  const [dragged, setDragged] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const editing = draft !== null;
  const close = () => {
    setOpen(false);
    setDraft(null);
    setDragged(null);
  };
  const dialogRef = useDialogFocus(open && !blocked, close);
  useEffect(() => {
    if (blocked) close();
  }, [blocked]);
  const ids = reconcileCameraOrder(
    cameras.map((camera) => camera.id),
    draft ?? cameras.map((camera) => camera.id),
  );
  const byId = new Map(cameras.map((camera) => [camera.id, camera]));
  const ordered = ids.map((id) => byId.get(id)!);
  const pages = Math.max(1, Math.ceil(cameras.length / 4));
  const current = Math.min(page, pages - 1);
  const enabled = cameras.filter((camera) => camera.isEnabled).length;
  function move(source: string, target: string) {
    setDraft(moveCamera(ids, source, target));
  }
  function priority(camera: Camera, input: HTMLInputElement) {
    const n = Number(input.value);
    if (Number.isInteger(n) && n >= 1 && n <= ids.length) {
      move(camera.id, ids[n - 1]!);
      setMessage('Bấm Lưu thứ tự để áp dụng.');
    } else setMessage(`Nhập thứ tự từ 1 đến ${ids.length}.`);
    input.value = String(
      Number.isInteger(n) && n >= 1 && n <= ids.length ? n : ids.indexOf(camera.id) + 1,
    );
  }
  return (
    <>
      <section
        data-entry-part="areas"
        className={styles.panel}
        aria-labelledby="area-cameras-title"
      >
        <div className={styles.heading}>
          <h2 id="area-cameras-title">
            <Icon name="camera" size={19} />
            Camera khu vực
          </h2>
          <span className={styles.count}>
            {enabled}/{cameras.length} <small>đang bật</small>
          </span>
        </div>
        <p className={styles.description}>Ưu tiên hiển thị từ trái sang phải, từ trên xuống.</p>
        <div className={styles.areaScroll}>
          <div className={styles.grid} aria-label="Các camera khu vực">
            {cameras.slice(current * 4, current * 4 + 4).map((camera, index) => (
              <div key={camera.id} className={styles.card}>
                <span className={styles.order}>{current * 4 + index + 1}</span>
                <AreaCard
                  camera={camera}
                  selected={camera.id === selectedId}
                  paused={open}
                  onSelect={() => onSelect(camera.id)}
                />
              </div>
            ))}
          </div>
          {!cameras.length && (
            <p className={styles.empty}>
              {isLoading ? 'Đang tải camera…' : 'Chưa có camera khu vực.'}
            </p>
          )}
        </div>
        <div className={styles.pagination} aria-label="Phân trang camera khu vực">
          <button
            type="button"
            aria-label="Trang camera trước"
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
          >
            <ChevronLeft size={17} />
          </button>
          <span>
            {current + 1} / {pages}
          </span>
          <button
            type="button"
            aria-label="Trang camera sau"
            disabled={current === pages - 1}
            onClick={() => setPage(current + 1)}
          >
            <ChevronRight size={17} />
          </button>
        </div>
        <button
          type="button"
          className={styles.showAll}
          onClick={() => {
            setOpen(true);
            setMessage('');
          }}
          disabled={!cameras.length}
        >
          <Icon name="grid" size={16} />
          Xem tất cả
        </button>
      </section>
      {open &&
        !blocked &&
        createPortal(
          <div
            className={styles.backdrop}
            onClick={(event) => {
              if (event.target === event.currentTarget) close();
            }}
          >
            <div
              className={styles.dialog}
              role="dialog"
              aria-modal="true"
              aria-labelledby="all-cameras-title"
              tabIndex={-1}
              ref={dialogRef}
            >
              <header className={styles.modalHeader}>
                <div>
                  <h2 id="all-cameras-title">
                    <Icon name="camera" />
                    Tất cả camera <span>{cameras.length}</span>
                  </h2>
                  <p>
                    {editing
                      ? 'Kéo thả, dùng mũi tên hoặc nhập số ưu tiên 1, 2, 3…'
                      : 'Chọn camera để xem. Bật / tắt nguồn phát ngay tại đây.'}
                  </p>
                </div>
                <button type="button" aria-label="Đóng tất cả camera" onClick={close}>
                  <X size={19} />
                </button>
              </header>
              <div className={styles.modalTools}>
                {editing ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setDraft(null);
                        setDragged(null);
                        setMessage('Đã hủy thay đổi.');
                      }}
                    >
                      Hủy
                    </button>
                    <button
                      type="button"
                      className={styles.primary}
                      onClick={() => {
                        setMessage(onSaveOrder(ids));
                        setDraft(null);
                        setPage(0);
                      }}
                    >
                      <Check size={15} />
                      Lưu thứ tự
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className={styles.editOrder}
                    onClick={() => {
                      setDraft(ids);
                      setMessage('');
                    }}
                    disabled={cameras.length < 2}
                  >
                    <Pencil size={15} />
                    Chỉnh sửa thứ tự
                  </button>
                )}
                <span>Ưu tiên được lưu riêng cho tài khoản trên trình duyệt này.</span>
              </div>
              {error && (
                <p className={styles.error} role="alert">
                  {error}
                </p>
              )}
              <div className={styles.modalScroll}>
                <div className={styles.modalGrid} aria-label="Toàn bộ camera">
                  {ordered.map((camera, index) => (
                    <div
                      key={camera.id}
                      className={styles.card}
                      data-dragging={dragged === camera.id}
                      draggable={editing}
                      onDragStart={(event) => {
                        setDragged(camera.id);
                        event.dataTransfer.effectAllowed = 'move';
                        event.dataTransfer.setData('text/plain', camera.id);
                      }}
                      onDragOver={(event) => {
                        if (editing && dragged) {
                          event.preventDefault();
                          event.dataTransfer.dropEffect = 'move';
                        }
                      }}
                      onDragEnd={() => setDragged(null)}
                      onDrop={(event) => {
                        event.preventDefault();
                        if (
                          editing &&
                          dragged &&
                          event.dataTransfer.getData('text/plain') === dragged
                        )
                          move(dragged, camera.id);
                        setDragged(null);
                      }}
                    >
                      <span className={styles.order}>{index + 1}</span>
                      <AreaCard
                        camera={camera}
                        selected={camera.id === selectedId}
                        editing={editing}
                        onSelect={() => {
                          onSelect(camera.id);
                          close();
                        }}
                      />
                      <div className={styles.cardControls}>
                        <span>
                          {toggleLoadingMap[camera.id]
                            ? 'Đang cập nhật…'
                            : camera.isEnabled
                              ? 'Đang bật'
                              : 'Đã tắt'}
                        </span>
                        <button
                          type="button"
                          role="switch"
                          aria-label={`Bật tắt ${camera.name}`}
                          aria-checked={camera.isEnabled}
                          className={styles.switch}
                          disabled={!isAdmin || Boolean(toggleLoadingMap[camera.id])}
                          title={!isAdmin ? 'Chỉ quản trị viên có quyền bật tắt camera' : undefined}
                          onClick={() => void onToggle(camera.id, !camera.isEnabled)}
                        >
                          <span />
                        </button>
                      </div>
                      {editing && (
                        <div className={styles.priority}>
                          <GripVertical size={16} />
                          <label>
                            Ưu tiên
                            <input
                              key={`${camera.id}:${index}`}
                              type="number"
                              min={1}
                              max={ids.length}
                              step={1}
                              defaultValue={index + 1}
                              aria-label={`Ưu tiên ${camera.name}`}
                              onBlur={(event) => priority(camera, event.currentTarget)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                  event.preventDefault();
                                  event.currentTarget.blur();
                                }
                              }}
                            />
                          </label>
                          <button
                            type="button"
                            aria-label={`Đưa ${camera.name} lên trước`}
                            disabled={index === 0}
                            onClick={() => move(camera.id, ids[index - 1]!)}
                          >
                            <ArrowUp size={14} />
                          </button>
                          <button
                            type="button"
                            aria-label={`Đưa ${camera.name} ra sau`}
                            disabled={index === ids.length - 1}
                            onClick={() => move(camera.id, ids[index + 1]!)}
                          >
                            <ArrowDown size={14} />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              <footer className={styles.modalFooter}>
                <p role="status">{message || `${enabled} / ${cameras.length} camera đang bật`}</p>
                <button type="button" onClick={close}>
                  Đóng
                </button>
              </footer>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
