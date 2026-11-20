'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ErrorState } from '@/components/ui';
import {
  fetchAdminResources,
  formatBytes,
  updateAdminResources,
  type AdminResourcesData,
} from '@/lib/admin-client';
import styles from './admin.module.css';

export function AdminResourcesView() {
  const [data, setData] = useState<AdminResourcesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const [maxCameras, setMaxCameras] = useState('8');
  const [storageQuotaGb, setStorageQuotaGb] = useState('100');
  const [defaultRetentionDays, setDefaultRetentionDays] = useState('30');
  const [retentionTiers, setRetentionTiers] = useState('7, 14, 30, 60, 90');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchAdminResources();
      setData(res);
      setMaxCameras(String(res.defaults.defaultMaxCameras));
      setStorageQuotaGb(String(res.defaults.defaultStorageQuotaGb));
      setDefaultRetentionDays(String(res.defaults.defaultRetentionDays));
      setRetentionTiers(res.defaults.allowedRetentionDays.join(', '));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không tải được tài nguyên & hạn mức.');
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
      const parsedTiers = retentionTiers
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= 365);

      if (parsedTiers.length === 0) {
        setNotice({ ok: false, text: 'Cần ít nhất 1 mức thời gian lưu hợp lệ (1–365 ngày).' });
        setSaving(false);
        return;
      }

      await updateAdminResources({
        defaultMaxCameras: Number(maxCameras),
        defaultStorageQuotaGb: Number(storageQuotaGb),
        defaultRetentionDays: Number(defaultRetentionDays),
        allowedRetentionDays: parsedTiers,
      });
      setNotice({ ok: true, text: 'Đã cập nhật giới hạn tài nguyên mặc định.' });
      await load();
    } catch (err) {
      setNotice({
        ok: false,
        text: err instanceof Error ? err.message : 'Cập nhật hạn mức thất bại.',
      });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className={styles.panel}>Đang tải thông tin tài nguyên & hạn mức…</div>;
  }

  if (error || !data) {
    return <ErrorState message={error ?? 'Không có dữ liệu tài nguyên.'} onRetry={load} />;
  }

  return (
    <div className={styles.stack}>
      <section className={styles.banner}>
        <div>
          <h2 className={styles.bannerTitle}>Tài nguyên & Hạn mức hệ thống</h2>
          <p className={styles.bannerSub}>
            Quản lý giới hạn số camera, dung lượng lưu trữ và các mức thời gian lưu được cung cấp.
            Không duyệt hay phát file video của hộ gia đình.
          </p>
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div>
            <h3 className={styles.panelTitle}>Giới hạn mặc định cho hộ gia đình mới</h3>
            <p className={styles.panelSubtitle}>
              Áp dụng làm chuẩn khi cấp phát tài nguyên và các gói thời gian lưu trữ.
            </p>
          </div>
        </div>

        {notice && (
          <div className={notice.ok ? styles.noticeOk : styles.noticeErr}>{notice.text}</div>
        )}

        <form onSubmit={handleSave} className={styles.stack}>
          <div className={styles.formGrid}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Số camera tối đa mặc định</span>
              <input
                type="number"
                min={1}
                max={256}
                className={styles.input}
                value={maxCameras}
                onChange={(e) => setMaxCameras(e.target.value)}
                required
              />
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Hạn mức dung lượng mặc định (GB)</span>
              <input
                type="number"
                min={1}
                max={100000}
                className={styles.input}
                value={storageQuotaGb}
                onChange={(e) => setStorageQuotaGb(e.target.value)}
                required
              />
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Thời gian lưu mặc định (ngày)</span>
              <input
                type="number"
                min={1}
                max={365}
                className={styles.input}
                value={defaultRetentionDays}
                onChange={(e) => setDefaultRetentionDays(e.target.value)}
                required
              />
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>
                Các mức lưu trữ cung cấp (ngày, cách nhau dấu phẩy)
              </span>
              <input
                type="text"
                className={styles.input}
                value={retentionTiers}
                onChange={(e) => setRetentionTiers(e.target.value)}
                placeholder="7, 14, 30, 60, 90"
                required
              />
            </label>
          </div>

          <div>
            <button type="submit" className={styles.btnPrimary} disabled={saving}>
              {saving ? 'Đang lưu…' : 'Lưu cấu hình hạn mức'}
            </button>
          </div>
        </form>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div>
            <h3 className={styles.panelTitle}>Mức sử dụng tài nguyên theo hộ gia đình</h3>
            <p className={styles.panelSubtitle}>
              Chỉ hiển thị thống kê dung lượng và số lượng camera, không hiển thị danh sách tệp
              video.
            </p>
          </div>
        </div>

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Hộ gia đình</th>
                <th>Gói</th>
                <th>Camera (đã dùng / tối đa)</th>
                <th>Dung lượng lưu trữ</th>
                <th>Thời gian lưu</th>
              </tr>
            </thead>
            <tbody>
              {data.households.map((h) => {
                const quotaBytes = h.storageQuotaGb * 1024 * 1024 * 1024;
                const pct =
                  quotaBytes > 0 ? Math.min(100, (h.storageUsedBytes / quotaBytes) * 100) : 0;
                return (
                  <tr key={h.ownerId}>
                    <td>
                      <div className={styles.cellStack}>
                        <span className={styles.cellPrimary}>{h.ownerFullName}</span>
                        <span className={styles.cellSecondary}>{h.ownerEmail}</span>
                      </div>
                    </td>
                    <td>
                      <span className={styles.badgeNeutral}>{h.servicePlan}</span>
                    </td>
                    <td className={styles.mono}>
                      {h.cameraCount}/{h.maxCameras} cam
                    </td>
                    <td style={{ minWidth: 180 }}>
                      <div className={styles.mono}>
                        {formatBytes(h.storageUsedBytes)} / {h.storageQuotaGb} GB
                      </div>
                      <div className={styles.progressTrack}>
                        <div className={styles.progressFill} style={{ width: `${pct}%` }} />
                      </div>
                    </td>
                    <td className={styles.mono}>{h.retentionDays}d</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
