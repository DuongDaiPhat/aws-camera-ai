'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { deleteKnownFace, listKnownFaces, type KnownFace } from '@/lib/known-faces-client';
import { AddKnownFaceForm } from './AddKnownFaceForm';
import styles from './known-faces.module.css';

export function KnownFacesView({ isAdmin }: { isAdmin: boolean }) {
  const [faces, setFaces] = useState<KnownFace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<KnownFace | null>(null);
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
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
    if (deleting) dialog.current?.showModal();
    else dialog.current?.close();
  }, [deleting]);

  async function remove(): Promise<void> {
    if (!deleting) return;
    setBusy(true);
    setError('');
    try {
      const result = await deleteKnownFace(deleting.id);
      setNotice(
        result?.recognitionStatus === 'SYNC_PENDING'
          ? 'Đã xóa khỏi cơ sở dữ liệu. Collection nhận diện đang chờ đồng bộ; thao tác chưa hoàn tất.'
          : 'Đã xóa vĩnh viễn dữ liệu khuôn mặt và cập nhật collection.',
      );
      setDeleting(null);
      await reload();
    } catch (failure: unknown) {
      setError(failure instanceof Error ? failure.message : 'Không xóa được.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.root} aria-labelledby="known-faces-title">
      <div className={styles.actions}>
        <h2 id="known-faces-title">Người quen</h2>
        <button
          onClick={() => {
            void reload();
          }}
        >
          Tải lại
        </button>
        {isAdmin && !adding && <button onClick={() => setAdding(true)}>Thêm người quen</button>}
      </div>
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
      {adding && isAdmin && (
        <AddKnownFaceForm
          onCancel={() => setAdding(false)}
          onCreated={(face) => {
            setAdding(false);
            setNotice(
              face.recognitionStatus === 'READY'
                ? 'Đã đăng ký, sẵn sàng nhận diện.'
                : 'Đã đăng ký, đang chờ đồng bộ nhận diện.',
            );
            void reload();
          }}
        />
      )}
      {loading ? (
        <p role="status">Đang tải người quen…</p>
      ) : faces.length === 0 ? (
        <p>
          Chưa có người quen nào. Thêm thành viên để hệ thống nhận diện và giảm cảnh báo không cần
          thiết.
        </p>
      ) : (
        <ul className={styles.grid}>
          {faces.map((face) => (
            <li key={face.id} className={styles.card}>
              <span className={styles.avatar} aria-hidden="true">
                {face.personName.slice(0, 1).toUpperCase()}
              </span>
              <h3>{face.personName}</h3>
              <p>{face.relationship || 'Chưa ghi quan hệ'}</p>
              <p>
                {face.provider} · {face.sourceImageCount} ảnh
              </p>
              <p>
                {face.recognitionStatus === 'READY' ? 'Sẵn sàng nhận diện' : 'Đang chờ đồng bộ'}
              </p>
              <time dateTime={face.createdAt}>
                {new Date(face.createdAt).toLocaleString('vi-VN')}
              </time>
              {isAdmin && <button onClick={() => setDeleting(face)}>Xóa</button>}
            </li>
          ))}
        </ul>
      )}
      <dialog
        ref={dialog}
        className={styles.dialog}
        aria-labelledby="delete-face-title"
        onCancel={(event) => {
          if (busy) event.preventDefault();
          else setDeleting(null);
        }}
      >
        <h3 id="delete-face-title">Xóa người quen “{deleting?.personName}”?</h3>
        <p>Dữ liệu khuôn mặt sẽ bị xóa vĩnh viễn và không thể khôi phục.</p>
        {error && <p role="alert">{error}</p>}
        <div className={styles.actions}>
          <button
            disabled={busy}
            className={styles.destructive}
            onClick={() => {
              void remove();
            }}
          >
            Xóa vĩnh viễn
          </button>
          <button disabled={busy} onClick={() => setDeleting(null)}>
            Hủy
          </button>
        </div>
      </dialog>
    </section>
  );
}
