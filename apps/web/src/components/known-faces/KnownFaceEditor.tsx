'use client';
import { useState } from 'react';
import { apiFetch } from '@/lib/api-client';
import type { KnownFace } from '@/lib/known-faces-client';
import type { HouseholdMember } from '@/lib/household-client';
import styles from './known-faces.module.css';
export function KnownFaceEditor({
  face,
  members,
  onSaved,
  onCancel,
}: {
  face: KnownFace;
  members: HouseholdMember[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <form
      className={styles.form}
      aria-label={`Sửa người quen ${face.personName}`}
      onSubmit={async (event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        setBusy(true);
        setError('');
        try {
          await apiFetch(`/known-faces/${face.id}`, {
            method: 'PATCH',
            body: JSON.stringify({
              personName: String(data.get('name')),
              relationship: String(data.get('relationship')),
              linkedUserId: String(data.get('linkedUserId')) || null,
            }),
          });
          onSaved();
        } catch (e: unknown) {
          setError(e instanceof Error ? e.message : 'Không lưu được người quen.');
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3>Sửa thông tin người quen</h3>
      <label>
        Tên
        <input
          name="name"
          required
          maxLength={120}
          defaultValue={face.personName}
          disabled={busy}
        />
      </label>
      <label>
        Quan hệ
        <input
          name="relationship"
          maxLength={60}
          defaultValue={face.relationship ?? ''}
          disabled={busy}
        />
      </label>
      <label>
        Tài khoản Viewer được chăm sóc
        <select name="linkedUserId" defaultValue={face.linkedUserId ?? ''} disabled={busy}>
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
      <p>Liên kết này cho phép chọn người trong lịch Kiểm tra an toàn.</p>
      {error && <p role="alert">{error}</p>}
      <div className={styles.actions}>
        <button type="submit" disabled={busy}>
          Lưu thông tin
        </button>
        <button type="button" disabled={busy} onClick={onCancel}>
          Hủy
        </button>
      </div>
    </form>
  );
}
