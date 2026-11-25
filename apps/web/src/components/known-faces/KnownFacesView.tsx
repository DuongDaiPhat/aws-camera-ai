'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Images,
  Pencil,
  Plus,
  RefreshCw,
  ScanFace,
  Trash2,
} from 'lucide-react';
import { deleteKnownFace, listKnownFaces, type KnownFace } from '@/lib/known-faces-client';
import { getHousehold, type HouseholdMember } from '@/lib/household-client';
import { AddKnownFaceForm } from './AddKnownFaceForm';
import { KnownFaceEditor } from './KnownFaceEditor';
import styles from './known-faces.module.css';

const MAX_PAGE_SIZE = 15;
const MAX_COLUMNS = 5;
const CARD_MIN_WIDTH = 205;
const CARD_HEIGHT = 130;
const GRID_GAP = 10;
const PAGINATION_SPACE = 46;

const dateFormat = new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' });

function useCardLayout() {
  const gridArea = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState({ columns: 1, pageSize: 1 });

  useEffect(() => {
    const node = gridArea.current;
    if (!node) return;

    const measure = () => {
      const columns = Math.max(
        1,
        Math.min(
          MAX_COLUMNS,
          Math.floor((node.clientWidth + GRID_GAP) / (CARD_MIN_WIDTH + GRID_GAP)),
        ),
      );
      const rows = Math.max(
        1,
        Math.floor((node.clientHeight - PAGINATION_SPACE + GRID_GAP) / (CARD_HEIGHT + GRID_GAP)),
      );
      const pageSize = Math.min(MAX_PAGE_SIZE, columns * rows);
      setLayout((current) =>
        current.columns === columns && current.pageSize === pageSize
          ? current
          : { columns, pageSize },
      );
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return { gridArea, ...layout };
}

function FaceCard({
  face,
  onEdit,
  onDelete,
}: {
  face: KnownFace;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const ready = face.recognitionStatus === 'READY';
  return (
    <li className={styles.card}>
      <div className={styles.person}>
        <span className={styles.avatar} aria-hidden="true">
          {face.personName.slice(0, 1).toLocaleUpperCase('vi-VN')}
        </span>
        <div className={styles.identity}>
          <h3 title={face.personName}>{face.personName}</h3>
          <p title={face.relationship || undefined}>{face.relationship || 'Chưa ghi quan hệ'}</p>
        </div>
      </div>
      <div className={styles.cardMeta}>
        <span className={styles.recognition} data-ready={ready}>
          {ready ? 'Sẵn sàng nhận diện' : 'Đang chờ đồng bộ'}
        </span>
        <span className={styles.images} title={face.provider}>
          <Images size={14} aria-hidden="true" /> {face.sourceImageCount ?? 0} ảnh
        </span>
      </div>
      <div className={styles.cardFooter}>
        <time dateTime={face.createdAt}>{dateFormat.format(new Date(face.createdAt))}</time>
        {onEdit && onDelete && (
          <div className={styles.cardActions}>
            <button
              type="button"
              onClick={onEdit}
              aria-label={`Sửa / Liên kết Viewer cho ${face.personName}`}
              title="Sửa / Liên kết Viewer"
            >
              <Pencil size={15} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={onDelete}
              aria-label={`Xóa ${face.personName}`}
              title="Xóa"
              className={styles.deleteButton}
            >
              <Trash2 size={15} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
    </li>
  );
}

function FacePageControls({
  page,
  pageCount,
  itemCount,
  onPageChange,
}: {
  page: number;
  pageCount: number;
  itemCount: number;
  onPageChange: (page: number) => void;
}) {
  return (
    <footer className={styles.pagination}>
      <span>{itemCount} hồ sơ</span>
      {pageCount > 1 && (
        <nav className={styles.pageControls} aria-label="Phân trang người quen">
          <button
            type="button"
            onClick={() => onPageChange(page - 1)}
            disabled={page === 1}
            aria-label="Trang trước"
          >
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <span aria-live="polite">
            Trang {page}/{pageCount}
          </span>
          <button
            type="button"
            onClick={() => onPageChange(page + 1)}
            disabled={page === pageCount}
            aria-label="Trang sau"
          >
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </nav>
      )}
    </footer>
  );
}

export function KnownFacesView({ isAdmin }: { isAdmin: boolean }) {
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [faces, setFaces] = useState<KnownFace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<KnownFace | null>(null);
  const [deleting, setDeleting] = useState<KnownFace | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [busy, setBusy] = useState(false);
  const [itemOffset, setItemOffset] = useState(0);
  const formDialog = useRef<HTMLDialogElement>(null);
  const deleteDialog = useRef<HTMLDialogElement>(null);
  const { gridArea, columns, pageSize } = useCardLayout();
  const pageCount = Math.max(1, Math.ceil(faces.length / pageSize));
  const page = Math.min(Math.floor(itemOffset / pageSize) + 1, pageCount);
  const visibleFaces = faces.slice((page - 1) * pageSize, page * pageSize);

  const reload = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError('');
    try {
      setFaces((await listKnownFaces(signal)).data);
    } catch (failure: unknown) {
      if (!signal?.aborted)
        setError(failure instanceof Error ? failure.message : 'Không tải được danh sách.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void reload(controller.signal);
    return () => controller.abort();
  }, [reload]);
  useEffect(() => {
    if (!isAdmin) return;
    const controller = new AbortController();
    void getHousehold(controller.signal)
      .then((data) => setMembers(data.members))
      .catch((failure: unknown) => {
        if (!controller.signal.aborted)
          setError(failure instanceof Error ? failure.message : 'Không tải được thành viên.');
      });
    return () => controller.abort();
  }, [isAdmin]);

  const formOpen = Boolean(isAdmin && (adding || editing));
  useEffect(() => {
    if (formOpen) formDialog.current?.showModal();
    else formDialog.current?.close();
  }, [formOpen]);
  useEffect(() => {
    if (deleting) deleteDialog.current?.showModal();
    else deleteDialog.current?.close();
  }, [deleting]);

  function closeForm() {
    setAdding(false);
    setEditing(null);
  }

  async function remove(): Promise<void> {
    if (!deleting) return;
    setBusy(true);
    setDeleteError('');
    try {
      const result = await deleteKnownFace(deleting.id);
      setNotice(
        result?.recognitionStatus === 'SYNC_PENDING'
          ? 'Đã xóa khỏi danh sách. Dữ liệu nhận diện đang chờ đồng bộ.'
          : 'Đã xóa vĩnh viễn dữ liệu khuôn mặt.',
      );
      setDeleting(null);
      await reload();
    } catch (failure: unknown) {
      setDeleteError(failure instanceof Error ? failure.message : 'Không xóa được.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.root} aria-labelledby="known-faces-title">
      <div className={styles.toolbar}>
        <h2 id="known-faces-title">
          <ScanFace size={20} aria-hidden="true" /> Danh sách người quen
        </h2>
        <div className={styles.actions}>
          <button type="button" disabled={loading} onClick={() => void reload()}>
            <RefreshCw size={16} aria-hidden="true" /> Tải lại
          </button>
          {isAdmin && (
            <button type="button" className={styles.primary} onClick={() => setAdding(true)}>
              <Plus size={16} aria-hidden="true" /> Thêm mới
            </button>
          )}
        </div>
      </div>
      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <div
        ref={gridArea}
        className={styles.gridArea}
        style={{ '--face-card-height': `${CARD_HEIGHT}px` } as CSSProperties}
      >
        {loading ? (
          <p className={styles.empty} role="status">
            Đang tải danh sách…
          </p>
        ) : faces.length === 0 ? (
          <p className={styles.empty}>{error ? 'Hãy tải lại để thử lại.' : 'Chưa có hồ sơ nào.'}</p>
        ) : (
          <ul
            className={styles.grid}
            style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: GRID_GAP }}
          >
            {visibleFaces.map((face) => (
              <FaceCard
                key={face.id}
                face={face}
                onEdit={isAdmin ? () => setEditing(face) : undefined}
                onDelete={
                  isAdmin
                    ? () => {
                        setDeleteError('');
                        setDeleting(face);
                      }
                    : undefined
                }
              />
            ))}
          </ul>
        )}

        <FacePageControls
          page={page}
          pageCount={pageCount}
          itemCount={faces.length}
          onPageChange={(next) => setItemOffset((next - 1) * pageSize)}
        />
      </div>

      <dialog
        ref={formDialog}
        className={`${styles.dialog} ${styles.formDialog}`}
        aria-labelledby="known-face-form-title"
        onCancel={closeForm}
      >
        {isAdmin && adding && (
          <AddKnownFaceForm
            members={members}
            onCancel={closeForm}
            onCreated={(face) => {
              closeForm();
              setItemOffset(0);
              setNotice(
                face.recognitionStatus === 'READY'
                  ? 'Đã đăng ký, sẵn sàng nhận diện.'
                  : 'Đã đăng ký, đang chờ đồng bộ nhận diện.',
              );
              void reload();
            }}
          />
        )}
        {isAdmin && editing && (
          <KnownFaceEditor
            key={editing.id}
            face={editing}
            members={members}
            onCancel={closeForm}
            onSaved={() => {
              closeForm();
              setNotice('Đã cập nhật thông tin.');
              void reload();
            }}
          />
        )}
      </dialog>

      <dialog
        ref={deleteDialog}
        className={styles.dialog}
        aria-labelledby="delete-face-title"
        onCancel={(event) => {
          if (busy) event.preventDefault();
          else setDeleting(null);
        }}
      >
        <h3 id="delete-face-title">Xóa “{deleting?.personName}”?</h3>
        <p>Dữ liệu khuôn mặt sẽ bị xóa vĩnh viễn và không thể khôi phục.</p>
        {deleteError && (
          <p className={styles.error} role="alert">
            {deleteError}
          </p>
        )}
        <div className={styles.actions}>
          <button type="button" disabled={busy} onClick={() => setDeleting(null)}>
            Hủy
          </button>
          <button
            type="button"
            disabled={busy}
            className={styles.destructive}
            onClick={() => void remove()}
          >
            Xóa vĩnh viễn
          </button>
        </div>
      </dialog>
    </section>
  );
}
