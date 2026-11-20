'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  registerKnownFace,
  selectionDetails,
  type SelectionDetails,
  type KnownFace,
} from '@/lib/known-faces-client';
import type { HouseholdMember } from '@/lib/household-client';
import { FaceImagePreview } from './FaceImagePicker';
import { ImagePlus } from 'lucide-react';
import { Icon } from '@/components/ui/Icon';
import styles from './known-faces.module.css';

export function AddKnownFaceForm({
  onCreated,
  onCancel,
  members = [],
}: {
  members?: HouseholdMember[];
  onCreated: (face: KnownFace) => void;
  onCancel: () => void;
}) {
  const [linkedUserId, setLinkedUserId] = useState('');
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
        linkedUserId || undefined,
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
      <header className={styles.formHeader}>
        <h3 id="known-face-form-title">Thêm hồ sơ nhận diện</h3>
        <button type="button" className={styles.closeButton} aria-label="Đóng" onClick={onCancel}>
          <Icon name="close" size={18} />
        </button>
      </header>
      <div className={styles.formFields}>
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
      </div>
      <label>
        Liên kết tài khoản Viewer
        <select
          value={linkedUserId}
          disabled={busy}
          onChange={(event) => setLinkedUserId(event.target.value)}
        >
          <option value="">Chưa liên kết</option>
          {members
            .filter((member) => member.role === 'VIEWER')
            .map((member) => (
              <option key={member.id} value={member.id}>
                {member.fullName} · {member.email}
              </option>
            ))}
        </select>
      </label>
      <label>
        Ảnh nhận diện ({files.length}/5)
        <span className={styles.uploadControl}>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            disabled={busy || files.length >= 5}
            onChange={(event) => {
              appendFiles(Array.from(event.target.files ?? []));
              event.target.value = '';
            }}
          />
          <ImagePlus size={17} aria-hidden="true" />
          <span>{files.length === 5 ? 'Đã chọn đủ 5 ảnh' : 'Chọn ảnh từ thiết bị'}</span>
        </span>
      </label>
      <p className={styles.hint}>
        Chọn 1–5 ảnh JPEG, PNG hoặc WebP. Hệ thống không lưu ảnh gốc dài hạn.
      </p>
      <div className={styles.previews}>
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
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {busy && <p role="status">Đang phân tích ảnh và đăng ký…</p>}
      <div className={styles.actions}>
        <button
          className={styles.primary}
          disabled={busy || !name.trim() || !files.length || files.length > 5}
          type="submit"
        >
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
