'use client';

import { useCallback, useEffect, useState } from 'react';
import { fetchAdminOverview, type AdminOverviewData } from '@/lib/admin-client';
import styles from './admin.module.css';

export function AdminStatusStrip() {
  const [data, setData] = useState<AdminOverviewData | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await fetchAdminOverview());
    } catch {
      // Giữ trạng thái gần nhất nếu lỗi mạng tạm thời
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 30_000);
    return () => clearInterval(timer);
  }, [load]);

  if (!data) {
    return (
      <div className={styles.statusStrip} role="status">
        <span>Đang đồng bộ trạng thái hạ tầng…</span>
      </div>
    );
  }

  const findStatus = (key: string) => data.services.find((s) => s.key === key)?.status === 'ok';
  const errors24h =
    data.counts.recordingErrors24h + data.counts.aiErrors24h + data.counts.notificationErrors24h;

  return (
    <div className={styles.statusStrip} role="status" aria-label="Trạng thái hệ thống">
      <div className={styles.statusStripItems}>
        <span className={findStatus('orchestrator') ? styles.statusDotOk : styles.statusDotErr}>
          API: {findStatus('orchestrator') ? 'OK' : 'ERR'}
        </span>
        <span className={findStatus('database') ? styles.statusDotOk : styles.statusDotErr}>
          DB: {findStatus('database') ? 'OK' : 'ERR'}
        </span>
        <span className={findStatus('ai') ? styles.statusDotOk : styles.statusDotErr}>
          AI: {findStatus('ai') ? 'OK' : 'ERR'}
        </span>
        <span className={findStatus('storage') ? styles.statusDotOk : styles.statusDotErr}>
          Storage: {findStatus('storage') ? 'OK' : 'ERR'}
        </span>
        <span className={errors24h === 0 ? styles.statusDotOk : styles.statusDotErr}>
          Lỗi 24h: {errors24h}
        </span>
      </div>
      <span className={styles.mono}>
        Đồng bộ: {new Date(data.generatedAt).toLocaleTimeString('vi-VN')}
      </span>
    </div>
  );
}
