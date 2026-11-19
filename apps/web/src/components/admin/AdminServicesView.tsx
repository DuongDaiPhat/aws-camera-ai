'use client';

import { useCallback, useEffect, useState } from 'react';
import { ErrorState } from '@/components/ui';
import { fetchAdminServices, type AdminServicesData } from '@/lib/admin-client';
import styles from './admin.module.css';

const SUBSYSTEM_LABEL: Record<'RECORDING' | 'AI' | 'NOTIFICATION', string> = {
  RECORDING: 'Ghi hình / Frigate',
  AI: 'Dịch vụ AI',
  NOTIFICATION: 'Gửi thông báo',
};

export function AdminServicesView() {
  const [data, setData] = useState<AdminServicesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchAdminServices());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không tải được tình trạng dịch vụ.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return <div className={styles.panel}>Đang kiểm tra kết nối và chẩn đoán dịch vụ…</div>;
  }

  if (error || !data) {
    return <ErrorState message={error ?? 'Không có dữ liệu dịch vụ.'} onRetry={load} />;
  }

  return (
    <div className={styles.stack}>
      <section className={styles.banner}>
        <div>
          <h2 className={styles.bannerTitle}>Tình trạng dịch vụ & Chẩn đoán kỹ thuật</h2>
          <p className={styles.bannerSub}>
            Theo dõi kết nối hạ tầng, lỗi ghi hình, AI và gửi thông báo bằng thông tin kỹ thuật đã
            loại bỏ dữ liệu nhạy cảm.
          </p>
        </div>
        <button type="button" className={styles.btnSecondary} onClick={() => void load()}>
          Kiểm tra lại
        </button>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <h3 className={styles.panelTitle}>Kết nối thành phần lõi</h3>
          <span className={styles.cellSecondary}>
            Lần kiểm tra: {new Date(data.checkedAt).toLocaleString('vi-VN')}
          </span>
        </div>
        <div className={styles.serviceGrid}>
          {data.connections.map((conn) => (
            <div key={conn.id} className={styles.serviceCard}>
              <div>
                <div className={styles.serviceName}>{conn.label}</div>
                <div className={styles.serviceDetail}>{conn.detail}</div>
              </div>
              <span className={conn.status === 'ok' ? styles.badgeOk : styles.badgeErr}>
                {conn.status === 'ok' ? 'Kết nối tốt' : 'Mất kết nối'}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.kpiGrid}>
        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Đồng bộ ghi hình (Frigate)</span>
          <strong className={styles.kpiValue}>{data.frigateSync.synced}</strong>
          <span className={styles.kpiHint}>
            Đang chờ: {data.frigateSync.pending} · Lỗi: {data.frigateSync.failed}
          </span>
        </div>

        {data.notificationChannels.length === 0 ? (
          <div className={styles.kpiCard}>
            <span className={styles.kpiLabel}>Gửi thông báo (24h)</span>
            <strong className={styles.kpiValue}>0</strong>
            <span className={styles.kpiHint}>Chưa có lượt gửi thông báo trong 24 giờ qua</span>
          </div>
        ) : (
          data.notificationChannels.map((ch) => (
            <div key={ch.channel} className={styles.kpiCard}>
              <span className={styles.kpiLabel}>Kênh {ch.channel} (24h)</span>
              <strong className={styles.kpiValue}>{ch.sent24h}</strong>
              <span className={styles.kpiHint}>
                Đang chờ: {ch.pending24h} · Thất bại: {ch.failed24h}
              </span>
            </div>
          ))
        )}
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div>
            <h3 className={styles.panelTitle}>Sự cố kỹ thuật gần đây (đã ẩn danh)</h3>
            <p className={styles.panelSubtitle}>
              Chỉ hiển thị mã lỗi và phân hệ phát sinh, không chứa nội dung tin nhắn hay dữ liệu cá
              nhân.
            </p>
          </div>
        </div>

        {data.incidents.length === 0 ? (
          <p className={styles.cellSecondary}>Không ghi nhận sự cố kỹ thuật nào.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Thời điểm</th>
                  <th>Phân hệ</th>
                  <th>Mã lỗi</th>
                  <th>Mô tả kỹ thuật</th>
                </tr>
              </thead>
              <tbody>
                {data.incidents.map((item) => (
                  <tr key={`${item.subsystem}-${item.id}`}>
                    <td>{new Date(item.occurredAt).toLocaleString('vi-VN')}</td>
                    <td>
                      <span className={styles.badgeNeutral}>{SUBSYSTEM_LABEL[item.subsystem]}</span>
                    </td>
                    <td className={styles.mono}>{item.code}</td>
                    <td>{item.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
