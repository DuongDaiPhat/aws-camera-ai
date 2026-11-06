'use client';

import { useEffect, useState } from 'react';
import type { components, operations } from '@cam/contracts';
import { ApiError, apiFetch } from '@/lib/api-client';
import { CreateUserView } from './CreateUserView';
import styles from './users-view.module.css';

type User = components['schemas']['User'];
type UserRole = User['role'];
type UsersPage = operations['listUsers']['responses'][200]['content']['application/json'];
type RoleChange = operations['changeUserRole']['requestBody']['content']['application/json'];
type RoleDraft = { id: string; role: UserRole };

const ROLES: Record<UserRole, string> = {
  VIEWER: 'Người xem',
  CAREGIVER: 'Người giám sát',
  ADMIN: 'Quản trị viên',
};

interface AccountRowProps {
  user: User;
  isCurrent: boolean;
  draftRole?: UserRole;
  saving: boolean;
  onEdit: (role: UserRole) => void;
  onSave: () => void;
  onCancel: () => void;
}

function AccountRow({
  user,
  isCurrent,
  draftRole,
  saving,
  onEdit,
  onSave,
  onCancel,
}: AccountRowProps) {
  const loginEmail = user.cognitoEmail ?? user.email;
  const hasDifferentEmails = loginEmail !== user.email;
  return (
    <tr className={draftRole ? styles.editingRow : undefined}>
      <th scope="row">
        <span className={styles.fullName}>{user.fullName}</span>
        {hasDifferentEmails ? (
          <>
            <small>
              <strong>Cognito</strong> {loginEmail}
            </small>
            <small>
              <strong>CameraAI</strong> {user.email}
            </small>
          </>
        ) : (
          <small>{loginEmail}</small>
        )}
      </th>
      <td className={styles.statusCell}>
        <span className={user.isActive ? styles.active : styles.inactive}>
          {user.isActive ? 'Đang hoạt động' : 'Đã vô hiệu hóa'}
        </span>
        <small>{user.isCognitoLinked ? 'Đã liên kết Cognito' : 'Chưa liên kết Cognito'}</small>
      </td>
      <td>
        {draftRole ? (
          <select
            aria-label={`Vai trò của ${loginEmail}`}
            value={draftRole}
            disabled={saving}
            autoFocus
            onChange={(event) => onEdit(event.target.value as UserRole)}
          >
            {Object.entries(ROLES).map(([role, label]) => (
              <option key={role} value={role}>
                {label}
              </option>
            ))}
          </select>
        ) : (
          <span className={styles.roleBadge} data-role={user.role}>
            {ROLES[user.role]}
          </span>
        )}
      </td>
      <td className={styles.actionCell}>
        {draftRole ? (
          <div className={styles.actions}>
            <button
              className={styles.primary}
              type="button"
              disabled={saving || draftRole === user.role}
              onClick={onSave}
            >
              {saving ? 'Đang lưu…' : 'Lưu vai trò'}
            </button>
            <button type="button" disabled={saving} onClick={onCancel}>
              Hủy
            </button>
          </div>
        ) : isCurrent ? (
          <small>Tài khoản của bạn</small>
        ) : (
          <button
            type="button"
            disabled={saving}
            aria-label={`Đổi quyền của ${loginEmail}`}
            onClick={() => onEdit(user.role)}
          >
            Đổi quyền
          </button>
        )}
      </td>
    </tr>
  );
}

interface AccountsTableProps {
  result: UsersPage;
  currentUserId: string;
  draft: RoleDraft | null;
  saving: boolean;
  onEdit: (draft: RoleDraft) => void;
  onSave: (user: User) => void;
  onCancel: () => void;
  onPageChange: (page: number) => void;
}

function AccountsTable({
  result,
  currentUserId,
  draft,
  saving,
  onEdit,
  onSave,
  onCancel,
  onPageChange,
}: AccountsTableProps) {
  const { page, pageSize, total } = result.meta;
  const totalPages = Math.ceil(total / pageSize);
  return (
    <>
      <div className={styles.tableCard}>
        <div className={styles.listHeading}>
          <h3>Danh sách tài khoản</h3>
          <span>{total} tài khoản</span>
        </div>
        <table aria-label="Danh sách tài khoản">
          <thead>
            <tr>
              <th scope="col">Tài khoản</th>
              <th scope="col">Trạng thái</th>
              <th scope="col">Vai trò</th>
              <th scope="col">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {result.data.map((user) => (
              <AccountRow
                key={user.id}
                user={user}
                isCurrent={user.id === currentUserId}
                draftRole={draft?.id === user.id ? draft.role : undefined}
                saving={saving}
                onEdit={(role) => onEdit({ id: user.id, role })}
                onSave={() => onSave(user)}
                onCancel={onCancel}
              />
            ))}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <nav className={styles.actions} aria-label="Phân trang tài khoản">
          <button
            type="button"
            disabled={saving || page === 1}
            onClick={() => onPageChange(page - 1)}
          >
            Trước
          </button>
          <span>
            Trang {page}/{totalPages}
          </span>
          <button
            type="button"
            disabled={saving || page === totalPages}
            onClick={() => onPageChange(page + 1)}
          >
            Sau
          </button>
        </nav>
      )}
    </>
  );
}

export function UsersView({ currentUserId }: { currentUserId: string }) {
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<UsersPage | null>(null);
  const [loadError, setLoadError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<RoleDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [savedMessage, setSavedMessage] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    void apiFetch<UsersPage>(`/users?page=${page}`, { signal: controller.signal }).then(
      (data) => {
        if (controller.signal.aborted) return;
        setResult(data);
      },
      (cause: unknown) => {
        if (controller.signal.aborted) return;
        setLoadError(
          cause instanceof ApiError ? cause.message : 'Không tải được danh sách tài khoản.',
        );
      },
    );
    return () => controller.abort();
  }, [page, revision]);

  async function saveRole(user: User) {
    if (saving || !editing || editing.id !== user.id || editing.role === user.role) return;
    const change: RoleChange = { role: editing.role };
    setSaving(true);
    setSaveError('');
    try {
      const updated = await apiFetch<User>(`/users/${user.id}/role`, {
        method: 'PATCH',
        body: JSON.stringify(change),
      });
      setEditing(null);
      setRevision((current) => current + 1);
      setSavedMessage(`Đã lưu vai trò ${ROLES[updated.role]} cho ${user.fullName}.`);
    } catch (cause) {
      setSaveError(cause instanceof ApiError ? cause.message : 'Không lưu được vai trò.');
    } finally {
      setSaving(false);
    }
  }

  function goToPage(nextPage: number) {
    setEditing(null);
    setSaveError('');
    setSavedMessage('');
    setResult(null);
    setPage(nextPage);
  }

  return (
    <section className={styles.section} aria-labelledby="users-title">
      <header className={styles.header}>
        <div>
          <h2 id="users-title">Quản lý tài khoản</h2>
          <p>Chọn một tài khoản để đổi vai trò trong CameraAI.</p>
        </div>
        <button
          type="button"
          className={styles.primary}
          aria-expanded={showCreate}
          onClick={() => setShowCreate((visible) => !visible)}
        >
          {showCreate ? 'Đóng biểu mẫu' : '+ Tạo tài khoản'}
        </button>
      </header>
      {showCreate && <CreateUserView onCreated={() => setRevision((current) => current + 1)} />}
      {loadError ? (
        <div className={styles.notice}>
          <p role="alert">{loadError}</p>
          <button
            type="button"
            onClick={() => {
              setLoadError('');
              setRevision((current) => current + 1);
            }}
          >
            Tải lại
          </button>
        </div>
      ) : !result ? (
        <p className={styles.notice} role="status">
          Đang tải tài khoản…
        </p>
      ) : result.data.length === 0 ? (
        <p className={styles.notice}>Chưa có tài khoản. Bạn có thể tạo tài khoản từ Cognito.</p>
      ) : (
        <AccountsTable
          result={result}
          currentUserId={currentUserId}
          draft={editing}
          saving={saving}
          onEdit={(draft) => {
            setEditing(draft);
            setSaveError('');
            setSavedMessage('');
          }}
          onSave={(user) => void saveRole(user)}
          onCancel={() => {
            setEditing(null);
            setSaveError('');
          }}
          onPageChange={goToPage}
        />
      )}
      {saveError && (
        <p className={styles.error} role="alert">
          {saveError}
        </p>
      )}
      {savedMessage && (
        <p className={styles.success} role="status">
          {savedMessage}
        </p>
      )}
    </section>
  );
}
