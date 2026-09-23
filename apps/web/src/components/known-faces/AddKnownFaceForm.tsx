'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  registerKnownFace,
  selectionDetails,
  type SelectionDetails,
  type KnownFace,
} from '@/lib/known-faces-client';
import { FaceImagePreview } from './FaceImagePicker';
import styles from './known-faces.module.css';

export function AddKnownFaceForm({
  onCreated,
  onCancel,
}: {
  onCreated: (face: KnownFace) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [relationship, setRelationship] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [selected, setSelected] = useState<(number | null)[]>([]);
  const [details, setDetails] = useState<SelectionDetails | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  function choose(next: File[]): void {
    setDetails(null);
    setError('');
    setFiles(next);
    setSelected(next.map(() => null));
  }

  function appendFiles(newFiles: File[]): void {
    setDetails(null);
    setError('');
    setFiles((current) => {
      const combined = [...current, ...newFiles].slice(0, 5);
      setSelected((prevSelected) => {
        const nextSelected = [...prevSelected];
        while (nextSelected.length < combined.length) nextSelected.push(null);
        return nextSelected.slice(0, 5);
      });
      return combined;
    });
  }

  function removeFile(indexToRemove: number): void {
    setDetails(null);
    setError('');
    setFiles((current) => current.filter((_, i) => i !== indexToRemove));
    setSelected((current) => current.filter((_, i) => i !== indexToRemove));
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!files.length || files.length > 5) {
      setError('Hãy chọn từ 1 đến 5 ảnh.');
      return;
    }
    setBusy(true);
    setError('');
    controller.current = new AbortController();
    try {
      const face = await registerKnownFace(
        name,
        relationship,
        files,
        selected,
        controller.current.signal,
      );
      choose([]);
      onCreated(face);
    } catch (failure: unknown) {
      if (controller.current.signal.aborted) return;
      setError(failure instanceof Error ? failure.message : 'Không đăng ký được. Hãy thử lại.');
      setDetails(selectionDetails(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        void submit(event);
      }}
      aria-label="Đăng ký người quen"
    >
      <h3>Thêm người quen</h3>
      <label>
        Tên
        <input
          required
          maxLength={120}
          value={name}
          disabled={busy}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label>
        Quan hệ
        <input
          maxLength={60}
          value={relationship}
          disabled={busy}
          onChange={(event) => setRelationship(event.target.value)}
        />
      </label>
      <label>
        Chọn 1–5 ảnh JPEG, PNG hoặc WebP (Đã chọn {files.length}/5)
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          disabled={busy}
          onChange={(event) => {
            appendFiles(Array.from(event.target.files ?? []));
            event.target.value = '';
          }}
        />
      </label>
      <p>
        Ảnh chỉ dùng để tạo dữ liệu nhận diện trong lúc đăng ký. Hệ thống không lưu ảnh gốc dài hạn.
      </p>
      <div className={styles.grid}>
        {files.map((file, index) => (
          <FaceImagePreview
            key={`${index}-${file.name}`}
            file={file}
            selected={selected[index] ?? null}
            disabled={busy}
            details={details?.images.find((image) => image.imageIndex === index)}
            onSelect={(faceIndex) =>
              setSelected((current) =>
                current.map((value, position) => (position === index ? faceIndex : value)),
              )
            }
            onRemove={() => removeFile(index)}
          />
        ))}
      </div>
      {error && <p role="alert">{error}</p>}
      {busy && <p role="status">Đang phân tích ảnh và đăng ký…</p>}
      <div className={styles.actions}>
        <button disabled={busy || !name.trim() || !files.length || files.length > 5} type="submit">
          {details ? 'Đăng ký với lựa chọn này' : 'Đăng ký'}
        </button>
        <button
          type="button"
          onClick={() => {
            controller.current?.abort();
            choose([]);
            onCancel();
          }}
        >
          Hủy
        </button>
      </div>
    </form>
  );
}
