'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ErrorState } from '@/components/ui';
import {
  fetchAdminSystemSettings,
  updateAdminSystemSettings,
  type AdminSystemSettingsData,
} from '@/lib/admin-client';
import styles from './admin.module.css';

export function AdminSettingsView() {
  const [data, setData] = useState<AdminSystemSettingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const [sessionTimeoutMinutes, setSessionTimeoutMinutes] = useState('60');
  const [requireMfaForAdmin, setRequireMfaForAdmin] = useState(false);
  const [allowSelfSignup, setAllowSelfSignup] = useState(false);
  const [maxLoginAttempts, setMaxLoginAttempts] = useState('5');
  const [aiConfidenceFloor, setAiConfidenceFloor] = useState('0.5');
  const [maxUploadMb, setMaxUploadMb] = useState('10');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchAdminSystemSettings();
      setData(res);
      setSessionTimeoutMinutes(String(res.loginPolicy.sessionTimeoutMinutes));
      setRequireMfaForAdmin(res.loginPolicy.requireMfaForAdmin);
      setAllowSelfSignup(res.loginPolicy.allowSelfSignup);
      setMaxLoginAttempts(String(res.loginPolicy.maxLoginAttempts));
      setAiConfidenceFloor(String(res.technicalLimits.aiConfidenceFloor));
      setMaxUploadMb(String(res.technicalLimits.maxUploadMb));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không tải được cài đặt hệ thống.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setNotice(null);
    try {
      await updateAdminSystemSettings({
        sessionTimeoutMinutes: Number(sessionTimeoutMinutes),
        requireMfaForAdmin,
        allowSelfSignup,
        maxLoginAttempts: Number(maxLoginAttempts),
        aiConfidenceFloor: Number(aiConfidenceFloor),
        maxUploadMb: Number(maxUploadMb),
      });
      setNotice({ ok: true, text: 'Đã lưu cấu hình chính sách và giới hạn kỹ thuật.' });
      await load();
    } catch (err) {
      setNotice({
        ok: false,
        text: err instanceof Error ? err.message : 'Không thể lưu cài đặt hệ thống.',
      });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className={styles.panel}>Đang tải cài đặt hệ thống…</div>;
  }

  if (error || !data) {
    return <ErrorState message={error ?? 'Không có dữ liệu cài đặt.'} onRetry={load} />;
  }

  return (
    <div className={styles.stack}>
      <section className={styles.banner}>
        <div>
          <h2 className={styles.bannerTitle}>Cài đặt hệ thống</h2>
          <p className={styles.bannerSub}>
            Cấu hình tích hợp, chính sách đăng nhập, giới hạn kỹ thuật và danh sách tài khoản quản
            trị.
          </p>
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div>
            <h3 className={styles.panelTitle}>Cấu hình tích hợp hiện tại</h3>
            <p className={styles.panelSubtitle}>
              Thông số kết nối hạ tầng đang áp dụng (ẩn thông tin khóa bí mật).
            </p>
          </div>
        </div>
        <div className={styles.serviceGrid}>
          <div className={styles.serviceCard}>
            <div>
              <div className={styles.serviceName}>Xác thực (Auth Provider)</div>
              <div className={styles.serviceDetail}>{data.integrations.authProvider}</div>
            </div>
            <span className={styles.badgeOk}>Đang dùng</span>
          </div>
          <div className={styles.serviceCard}>
            <div>
              <div className={styles.serviceName}>Kho lưu trữ (Storage)</div>
              <div className={styles.serviceDetail}>{data.integrations.storageProvider}</div>
            </div>
            <span className={styles.badgeOk}>Đang dùng</span>
          </div>
          <div className={styles.serviceCard}>
            <div>
              <div className={styles.serviceName}>Nhận diện khuôn mặt (Face AI)</div>
              <div className={styles.serviceDetail}>{data.integrations.faceProvider}</div>
            </div>
            <span className={styles.badgeNeutral}>Sẵn sàng</span>
          </div>
          <div className={styles.serviceCard}>
            <div>
              <div className={styles.serviceName}>Telegram Bot</div>
              <div className={styles.serviceDetail}>
                {data.integrations.telegramEnabled ? 'Đã cấu hình token' : 'Chưa bật token'}
              </div>
            </div>
            <span className={data.integrations.telegramEnabled ? styles.badgeOk : styles.badgeWarn}>
              {data.integrations.telegramEnabled ? 'Bật' : 'Tắt'}
            </span>
          </div>
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div>
            <h3 className={styles.panelTitle}>Chính sách đăng nhập & Giới hạn kỹ thuật</h3>
            <p className={styles.panelSubtitle}>
              Cập nhật lần cuối: {new Date(data.updatedAt).toLocaleString('vi-VN')}
            </p>
          </div>
        </div>

        {notice && (
          <div className={notice.ok ? styles.noticeOk : styles.noticeErr}>{notice.text}</div>
        )}

        <form onSubmit={handleSave} className={styles.stack}>
          <div className={styles.formGrid}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Thời hạn phiên đăng nhập (phút)</span>
              <input
                type="number"
                min={5}
                max={1440}
                className={styles.input}
                value={sessionTimeoutMinutes}
                onChange={(e) => setSessionTimeoutMinutes(e.target.value)}
                required
              />
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Số lần đăng nhập sai tối đa</span>
              <input
                type="number"
                min={1}
                max={20}
                className={styles.input}
                value={maxLoginAttempts}
                onChange={(e) => setMaxLoginAttempts(e.target.value)}
                required
              />
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Ngưỡng tin cậy AI tối thiểu (0.05 – 0.99)</span>
              <input
                type="number"
                step="0.01"
                min={0.05}
                max={0.99}
                className={styles.input}
                value={aiConfidenceFloor}
                onChange={(e) => setAiConfidenceFloor(e.target.value)}
                required
              />
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Dung lượng tệp tải lên tối đa (MB)</span>
              <input
                type="number"
                min={1}
                max={100}
                className={styles.input}
                value={maxUploadMb}
                onChange={(e) => setMaxUploadMb(e.target.value)}
                required
              />
            </label>
          </div>

          <div className={styles.formGrid}>
            <label className={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={requireMfaForAdmin}
                onChange={(e) => setRequireMfaForAdmin(e.target.checked)}
              />
              <span>Yêu cầu xác thực đa yếu tố (MFA) cho tài khoản Admin</span>
            </label>

            <label className={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={allowSelfSignup}
                onChange={(e) => setAllowSelfSignup(e.target.checked)}
              />
              <span>Cho phép người dùng tự đăng ký tài khoản mới</span>
            </label>
          </div>

          <div>
            <button type="submit" className={styles.btnPrimary} disabled={saving}>
              {saving ? 'Đang lưu…' : 'Lưu cài đặt hệ thống'}
            </button>
          </div>
        </form>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div>
            <h3 className={styles.panelTitle}>Tài khoản quản trị hệ thống</h3>
            <p className={styles.panelSubtitle}>
              Danh sách tài khoản có vai trò ADMIN trong hệ thống.
            </p>
          </div>
        </div>

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Họ tên</th>
                <th>Email</th>
                <th>Trạng thái</th>
                <th>Ngày tạo</th>
              </tr>
            </thead>
            <tbody>
              {data.adminAccounts.map((acc) => (
                <tr key={acc.id}>
                  <td className={styles.cellPrimary}>{acc.fullName}</td>
                  <td>{acc.email}</td>
                  <td>
                    <span className={acc.isActive ? styles.badgeOk : styles.badgeErr}>
                      {acc.isActive ? 'Đang hoạt động' : 'Đã khóa'}
                    </span>
                  </td>
                  <td>{new Date(acc.createdAt).toLocaleDateString('vi-VN')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
