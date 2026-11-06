'use client';

import { useState, type FormEvent } from 'react';
import type { components } from '@cam/contracts';
import { ApiError, apiFetch } from '@/lib/api-client';
import styles from './create-user-view.module.css';

type CreateUserRequest = components['schemas']['CreateUserRequest'];
type User = components['schemas']['User'];

export function CreateUserView({ onCreated }: { onCreated?: () => void }) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createdUser, setCreatedUser] = useState<User | null>(null);
  const [error, setError] = useState('');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    const input: CreateUserRequest = {
      email: String(fields.get('email')).trim(),
      fullName: String(fields.get('fullName')).trim(),
      cognitoSub: String(fields.get('cognitoSub')).trim(),
      role: fields.get('role') as CreateUserRequest['role'],
    };
    setIsSubmitting(true);
    setCreatedUser(null);
    setError('');
    try {
      const user = await apiFetch<User>('/users', { method: 'POST', body: JSON.stringify(input) });
      setCreatedUser(user);
      form.reset();
      onCreated?.();
    } catch (cause) {
      setError(
        cause instanceof ApiError ? cause.message : 'Không thể tạo tài khoản. Vui lòng thử lại.',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className={styles.section} aria-labelledby="create-user-title">
      <h2 id="create-user-title">Tạo tài khoản</h2>
      <p>
        Tạo người dùng trong Cognito trước. Sau đó nhập email và sao chép đúng User ID (Sub) từ cùng
        người dùng trong User Pool của CameraAI.
      </p>
      <form className={styles.form} onSubmit={handleSubmit}>
        <fieldset disabled={isSubmitting}>
          <label>
            Họ và tên
            <input name="fullName" autoComplete="off" required maxLength={120} />
          </label>
          <label>
            Email
            <input name="email" type="email" autoComplete="off" required maxLength={254} />
          </label>
          <label>
            User ID (Sub) từ Cognito
            <input
              name="cognitoSub"
              autoComplete="off"
              spellCheck={false}
              required
              maxLength={128}
            />
          </label>
          <label>
            Vai trò
            <select name="role" defaultValue="VIEWER">
              <option value="VIEWER">VIEWER · Người xem</option>
              <option value="CAREGIVER">CAREGIVER · Người giám sát</option>
              <option value="ADMIN">ADMIN · Quản trị viên</option>
            </select>
          </label>
          <p>
            Người xem và người giám sát chỉ truy cập camera được gán. Người giám sát có thể xác nhận
            cảnh báo. Quản trị viên có quyền toàn hệ thống, bao gồm tạo tài khoản.
          </p>
          <button type="submit">{isSubmitting ? 'Đang tạo…' : 'Tạo tài khoản'}</button>
        </fieldset>
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        {createdUser && (
          <p role="status" className={styles.success}>
            Đã tạo tài khoản {createdUser.email} với vai trò {createdUser.role}.
          </p>
        )}
      </form>
    </section>
  );
}
