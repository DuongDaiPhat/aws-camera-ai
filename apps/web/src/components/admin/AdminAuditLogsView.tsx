'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ErrorState, Pagination } from '@/components/ui';
import { fetchAdminAuditLogs, type AdminAuditLogsPage } from '@/lib/admin-client';
import styles from './admin.module.css';

export function AdminAuditLogsView() {
  const [data, setData] = useState<AdminAuditLogsPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(
        await fetchAdminAuditLogs({
          page,
          pageSize,
          action: actionFilter || undefined,
          search: search || undefined,
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không tải được nhật ký quản trị.');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, actionFilter, search]);

  useEffect(() => {
    void load();
  }, [load]);

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className={styles.stack}>
      <section className={styles.banner}>
        <div>
          <h2 className={styles.bannerTitle}>Nhật ký quản trị</h2>
          <p className={styles.bannerSub}>
            Tra cứu người thực hiện thay đổi tài khoản, phân quyền hoặc cấu hình hệ thống, cùng thời
            điểm và kết quả thao tác.
          </p>
        </div>
        <button type="button" className={styles.btnSecondary} onClick={() => void load()}>
          Làm mới
        </button>
      </section>

      <section className={styles.panel}>
        <form onSubmit={handleSearch} className={styles.filterBar}>
          <input
            type="text"
            className={styles.input}
            style={{ maxWidth: 280 }}
            placeholder="Tìm theo email, hành động, đối tượng…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          <select
            className={styles.select}
            style={{ maxWidth: 240 }}
            value={actionFilter}
            onChange={(e) => {
              setPage(1);
              setActionFilter(e.target.value);
            }}
          >
            <option value="">Tất cả thao tác</option>
            <option value="USER_CREATED">Tạo tài khoản</option>
            <option value="USER_ROLE_CHANGED">Đổi vai trò</option>
            <option value="USER_SUSPENDED">Khóa tài khoản</option>
            <option value="USER_ACTIVATED">Mở khóa tài khoản</option>
            <option value="HOUSEHOLD_QUOTA_UPDATED">Cập nhật hạn mức hộ</option>
            <option value="RESOURCE_LIMITS_UPDATED">Cập nhật tài nguyên mặc định</option>
            <option value="SYSTEM_SETTINGS_UPDATED">Cập nhật cài đặt hệ thống</option>
          </select>
          <button type="submit" className={styles.btnPrimary}>
            Lọc nhật ký
          </button>
        </form>

        {loading ? (
          <p className={styles.cellSecondary}>Đang tải nhật ký quản trị…</p>
        ) : error || !data ? (
          <ErrorState message={error ?? 'Không có dữ liệu nhật ký.'} onRetry={load} />
        ) : data.items.length === 0 ? (
          <p className={styles.cellSecondary}>Không tìm thấy bản ghi nhật ký phù hợp.</p>
        ) : (
          <>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Thời điểm</th>
                    <th>Người thực hiện</th>
                    <th>Hành động</th>
                    <th>Đối tượng</th>
                    <th>Chi tiết / Kết quả</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((log) => (
                    <tr key={log.id}>
                      <td className={styles.mono}>
                        {new Date(log.createdAt).toLocaleString('vi-VN')}
                      </td>
                      <td>
                        <div className={styles.cellStack}>
                          <span className={styles.cellPrimary}>
                            {log.actorFullName || 'Hệ thống'}
                          </span>
                          <span className={styles.cellSecondary}>
                            {log.actorEmail || 'system'} {log.actorRole ? `(${log.actorRole})` : ''}
                          </span>
                        </div>
                      </td>
                      <td>
                        <span className={styles.badgeNeutral}>{log.action}</span>
                      </td>
                      <td className={styles.mono}>
                        {log.entityType}
                        {log.entityId ? `:${log.entityId.slice(0, 8)}` : ''}
                      </td>
                      <td className={styles.mono}>
                        {Object.keys(log.metadata).length > 0
                          ? JSON.stringify(log.metadata)
                          : 'Thành công'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Pagination
              currentPage={data.page}
              totalPages={totalPages}
              totalItems={data.total}
              pageSize={data.pageSize}
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPage(1);
                setPageSize(size);
              }}
            />
          </>
        )}
      </section>
    </div>
  );
}
