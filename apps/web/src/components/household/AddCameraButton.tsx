'use client';
import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { createHouseholdCamera } from '@/lib/household-client';
import styles from './household.module.css';
export function AddCameraButton({ onCreated }: { onCreated: (id: string) => void }) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  return (
    <>
      <button
        className={styles.cameraTrigger}
        type="button"
        onClick={() => {
          setError('');
          setOpen(true);
        }}
      >
        <Plus size={16} />
        Thêm camera
      </button>
      <dialog
        ref={dialog}
        className={styles.cameraDialog}
        aria-labelledby="new-camera-title"
        onCancel={(event) => {
          if (busy) event.preventDefault();
          else setOpen(false);
        }}
      >
        <form
          className={styles.form}
          onSubmit={async (event) => {
            event.preventDefault();
            const node = event.currentTarget,
              form = new FormData(node);
            setBusy(true);
            setError('');
            try {
              const result = await createHouseholdCamera(String(form.get('name')));
              onCreated(result.id);
              node.reset();
              setOpen(false);
            } catch (e: unknown) {
              setError(e instanceof Error ? e.message : 'Không tạo được camera.');
            } finally {
              setBusy(false);
            }
          }}
        >
          <h3 id="new-camera-title">Thêm camera trong hộ</h3>
          <p>
            Camera mới ở trạng thái tắt. Sau khi tạo, chọn nguồn phát và cấu hình tại trang Camera.
          </p>
          <label>
            Tên camera
            <input name="name" required maxLength={120} autoFocus disabled={busy} />
          </label>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <div className={styles.actions}>
            <button disabled={busy}>{busy ? 'Đang tạo…' : 'Tạo camera'}</button>
            <button type="button" disabled={busy} onClick={() => setOpen(false)}>
              Hủy
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
