'use client';

import { useCallback, useEffect, useState } from 'react';
import { ErrorState } from '@/components/ui';
import { fetchAdminOverview, formatBytes, type AdminOverviewData } from '@/lib/admin-client';
import styles from './admin.module.css';

interface AdminOverviewViewProps {
  onNavigate: (nav: string) => void;
}

export function AdminOverviewView({ onNavigate }: AdminOverviewViewProps) {
  const [data, setData] = useState<AdminOverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchAdminOverview());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không tải được tổng quan hệ thống.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return <div className={styles.panel}>Đang tải tổng quan hệ thống…</div>;
  }

  if (error || !data) {
    return <ErrorState message={error ?? 'Không có dữ liệu tổng quan.'} onRetry={load} />;
  }

  const totalErrors24h =
    data.counts.recordingErrors24h + data.counts.aiErrors24h + data.counts.notificationErrors24h;

  return (
    <div className={styles.stack}>
      <section className={styles.banner}>
        <div>
          <h2 className={styles.bannerTitle}>Tổng quan vận hành hệ thống</h2>
          <p className={styles.bannerSub}>
            Giám sát sức khỏe dịch vụ, số lượng hộ gia đình, lỗi kỹ thuật và dung lượng lưu trữ.
            Không hiển thị hình ảnh camera khách hàng.
          </p>
        </div>
        <div className={styles.bannerActions}>
          <span className={data.overallStatus === 'ok' ? styles.badgeOk : styles.badgeWarn}>
            {data.overallStatus === 'ok' ? 'Hệ thống ổn định' : 'Có dịch vụ suy giảm'}
          </span>
          <button type="button" className={styles.btnSecondary} onClick={() => void load()}>
            Làm mới
          </button>
        </div>
      </section>

      <section className={styles.kpiGrid} aria-label="Chỉ số tổng quan">
        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Hộ gia đình</span>
          <strong className={styles.kpiValue}>{data.counts.householdCount}</strong>
          <span className={styles.kpiHint}>
            {data.counts.activeAccounts}/{data.counts.totalAccounts} tài khoản đang hoạt động
          </span>
        </div>

        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Camera đăng ký</span>
          <strong className={styles.kpiValue}>{data.counts.totalCameras}</strong>
          <span className={styles.kpiHint}>
            {data.counts.enabledCameras} đang bật · {data.counts.disabledCameras} đang tắt (chỉ số
            kỹ thuật)
          </span>
        </div>

        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Dung lượng đã dùng</span>
          <strong className={styles.kpiValue}>{formatBytes(data.counts.storageUsedBytes)}</strong>
          <span className={styles.kpiHint}>
            Tổng hạn mức cấp: {data.counts.allocatedStorageQuotaGb} GB
          </span>
        </div>

        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Lỗi 24 giờ qua</span>
          <strong className={styles.kpiValue}>{totalErrors24h}</strong>
          <span className={styles.kpiHint}>
            Ghi hình {data.counts.recordingErrors24h} · AI {data.counts.aiErrors24h} · Thông báo{' '}
            {data.counts.notificationErrors24h}
          </span>
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div>
            <h3 className={styles.panelTitle}>Tình trạng các dịch vụ</h3>
            <p className={styles.panelSubtitle}>
              Cập nhật lúc {new Date(data.generatedAt).toLocaleString('vi-VN')}
            </p>
          </div>
          <button
            type="button"
            className={styles.btnSecondary}
            onClick={() => onNavigate('admin-services')}
          >
            Xem chi tiết kỹ thuật
          </button>
        </div>

        <div className={styles.serviceGrid}>
          {data.services.map((svc) => (
            <div key={svc.key} className={styles.serviceCard}>
              <div>
                <div className={styles.serviceName}>{svc.name}</div>
                <div className={styles.serviceDetail}>{svc.detail || 'Đang hoạt động'}</div>
              </div>
              <span className={svc.status === 'ok' ? styles.badgeOk : styles.badgeErr}>
                {svc.status === 'ok' ? 'Sẵn sàng' : 'Lỗi'}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
