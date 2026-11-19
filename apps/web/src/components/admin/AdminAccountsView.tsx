'use client';

import { useCallback, useEffect, useState } from 'react';
import { ErrorState } from '@/components/ui';
import { UsersView } from '@/components/users/UsersView';
import {
  fetchAdminHouseholds,
  formatBytes,
  updateAdminHouseholdQuota,
  updateAdminUserStatus,
  type AdminHouseholdItem,
} from '@/lib/admin-client';
import styles from './admin.module.css';

interface AdminAccountsViewProps {
  currentUserId: string;
}

const SERVICE_PLANS = ['BASIC', 'STANDARD', 'PREMIUM', 'ENTERPRISE'] as const;

export function AdminAccountsView({ currentUserId }: AdminAccountsViewProps) {
  const [tab, setTab] = useState<'households' | 'accounts'>('households');
  const [households, setHouseholds] = useState<AdminHouseholdItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{
    maxCameras: string;
    storageQuotaGb: string;
    retentionDays: string;
    servicePlan: (typeof SERVICE_PLANS)[number];
  }>({ maxCameras: '8', storageQuotaGb: '100', retentionDays: '30', servicePlan: 'STANDARD' });
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setHouseholds(await fetchAdminHouseholds());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không tải được danh sách hộ gia đình.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function startEdit(item: AdminHouseholdItem) {
    setEditingId(item.ownerId);
    setDraft({
      maxCameras: String(item.maxCameras),
      storageQuotaGb: String(item.storageQuotaGb),
      retentionDays: String(item.retentionDays),
      servicePlan: item.servicePlan,
    });
  }

  async function saveQuota(ownerId: string) {
    setBusyId(ownerId);
    setNotice(null);
    try {
      await updateAdminHouseholdQuota(ownerId, {
        maxCameras: Number(draft.maxCameras),
        storageQuotaGb: Number(draft.storageQuotaGb),
        retentionDays: Number(draft.retentionDays),
        servicePlan: draft.servicePlan,
      });
      setEditingId(null);
      setNotice({ ok: true, text: 'Đã cập nhật hạn mức hộ gia đình.' });
      await load();
    } catch (err) {
      setNotice({
        ok: false,
        text: err instanceof Error ? err.message : 'Không thể cập nhật hạn mức.',
      });
    } finally {
      setBusyId(null);
    }
  }

  async function toggleStatus(item: AdminHouseholdItem) {
    setBusyId(item.ownerId);
    setNotice(null);
    try {
      await updateAdminUserStatus(item.ownerId, !item.ownerActive);
      setNotice({
        ok: true,
        text: item.ownerActive
          ? `Đã tạm khóa tài khoản ${item.ownerEmail}.`
          : `Đã kích hoạt lại tài khoản ${item.ownerEmail}.`,
      });
      await load();
    } catch (err) {
      setNotice({
        ok: false,
        text: err instanceof Error ? err.message : 'Không thể đổi trạng thái tài khoản.',
      });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className={styles.stack}>
      <section className={styles.banner}>
        <div>
          <h2 className={styles.bannerTitle}>Tài khoản & Hộ gia đình</h2>
          <p className={styles.bannerSub}>
            Quản lý trạng thái tài khoản, thông tin dịch vụ và hạn mức từng hộ. Hệ thống không hỗ
            trợ đăng nhập thay khách hàng.
          </p>
        </div>

        <div className={styles.tabs} role="tablist" aria-label="Chế độ xem">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'households'}
            className={`${styles.tabBtn} ${tab === 'households' ? styles.tabBtnActive : ''}`}
            onClick={() => setTab('households')}
          >
            Hộ gia đình & Hạn mức
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'accounts'}
            className={`${styles.tabBtn} ${tab === 'accounts' ? styles.tabBtnActive : ''}`}
            onClick={() => setTab('accounts')}
          >
            Danh sách tài khoản & Vai trò
          </button>
        </div>
      </section>

      {tab === 'accounts' ? (
        <UsersView currentUserId={currentUserId} />
      ) : loading ? (
        <div className={styles.panel}>Đang tải danh sách hộ gia đình…</div>
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : (
        <section className={styles.panel}>
          {notice && (
            <div className={notice.ok ? styles.noticeOk : styles.noticeErr}>{notice.text}</div>
          )}

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Chủ hộ / Tài khoản</th>
                  <th>Trạng thái</th>
                  <th>Gói dịch vụ</th>
                  <th>Thành viên & Camera</th>
                  <th>Hạn mức lưu trữ</th>
                  <th>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {households.map((item) => {
                  const isEditing = editingId === item.ownerId;
                  const isSelf = item.ownerId.toLowerCase() === currentUserId.toLowerCase();
                  return (
                    <tr key={item.ownerId}>
                      <td>
                        <div className={styles.cellStack}>
                          <span className={styles.cellPrimary}>{item.ownerFullName}</span>
                          <span className={styles.cellSecondary}>
                            {item.ownerEmail} · {item.ownerRole}
                          </span>
                        </div>
                      </td>
                      <td>
                        <span className={item.ownerActive ? styles.badgeOk : styles.badgeErr}>
                          {item.ownerActive ? 'Đang hoạt động' : 'Đã khóa'}
                        </span>
                      </td>
                      <td>
                        {isEditing ? (
                          <select
                            className={styles.select}
                            value={draft.servicePlan}
                            onChange={(e) =>
                              setDraft((d) => ({
                                ...d,
                                servicePlan: e.target.value as (typeof SERVICE_PLANS)[number],
                              }))
                            }
                          >
                            {SERVICE_PLANS.map((plan) => (
                              <option key={plan} value={plan}>
                                {plan}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className={styles.badgeNeutral}>{item.servicePlan}</span>
                        )}
                      </td>
                      <td>
                        {isEditing ? (
                          <label className={styles.field}>
                            <span className={styles.fieldLabel}>Tối đa camera</span>
                            <input
                              type="number"
                              min={1}
                              max={256}
                              className={styles.input}
                              value={draft.maxCameras}
                              onChange={(e) =>
                                setDraft((d) => ({ ...d, maxCameras: e.target.value }))
                              }
                            />
                          </label>
                        ) : (
                          <div className={styles.cellStack}>
                            <span>{item.memberCount} thành viên</span>
                            <span className={`${styles.cellSecondary} ${styles.mono}`}>
                              {item.cameraCount}/{item.maxCameras} cam
                            </span>
                          </div>
                        )}
                      </td>
                      <td>
                        {isEditing ? (
                          <div className={styles.filterBar}>
                            <label className={styles.field}>
                              <span className={styles.fieldLabel}>GB</span>
                              <input
                                type="number"
                                min={1}
                                max={100000}
                                className={styles.input}
                                style={{ width: 90 }}
                                value={draft.storageQuotaGb}
                                onChange={(e) =>
                                  setDraft((d) => ({ ...d, storageQuotaGb: e.target.value }))
                                }
                              />
                            </label>
                            <label className={styles.field}>
                              <span className={styles.fieldLabel}>Ngày lưu</span>
                              <input
                                type="number"
                                min={1}
                                max={365}
                                className={styles.input}
                                style={{ width: 80 }}
                                value={draft.retentionDays}
                                onChange={(e) =>
                                  setDraft((d) => ({ ...d, retentionDays: e.target.value }))
                                }
                              />
                            </label>
                          </div>
                        ) : (
                          <div className={styles.cellStack}>
                            <span className={styles.mono}>
                              {formatBytes(item.storageUsedBytes)} / {item.storageQuotaGb} GB
                            </span>
                            <span className={`${styles.cellSecondary} ${styles.mono}`}>
                              TTL {item.retentionDays}d
                            </span>
                          </div>
                        )}
                      </td>
                      <td>
                        <div className={styles.filterBar}>
                          {isEditing ? (
                            <>
                              <button
                                type="button"
                                className={styles.btnPrimary}
                                disabled={busyId === item.ownerId}
                                onClick={() => void saveQuota(item.ownerId)}
                              >
                                Lưu
                              </button>
                              <button
                                type="button"
                                className={styles.btnSecondary}
                                onClick={() => setEditingId(null)}
                              >
                                Hủy
                              </button>
                            </>
                          ) : (
                            <>
                              {item.ownerRole !== 'ADMIN' && (
                                <button
                                  type="button"
                                  className={styles.btnSecondary}
                                  onClick={() => startEdit(item)}
                                >
                                  Sửa hạn mức
                                </button>
                              )}
                              {!isSelf && (
                                <button
                                  type="button"
                                  className={
                                    item.ownerActive ? styles.btnDanger : styles.btnSecondary
                                  }
                                  disabled={busyId === item.ownerId}
                                  onClick={() => void toggleStatus(item)}
                                >
                                  {item.ownerActive ? 'Khóa' : 'Mở khóa'}
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
