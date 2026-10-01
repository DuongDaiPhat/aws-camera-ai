'use client';

import React from 'react';
import type { CurrentUser } from '@/lib/auth-client';
import { EscalationRulesSection } from './EscalationRulesSection';
import styles from './settings-view.module.css';

interface SettingsViewProps {
  user: CurrentUser | null;
}

export function SettingsView({ user }: SettingsViewProps) {
  const isAdmin = user?.role === 'ADMIN';

  return (
    <section className={styles.settingsContainer} aria-labelledby="settings-title">
      <div className={styles.headerSection}>
        <h2 id="settings-title" className={styles.pageTitle}>
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <line x1="4" y1="21" x2="4" y2="14" />
            <line x1="4" y1="10" x2="4" y2="3" />
            <line x1="12" y1="21" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12" y2="3" />
            <line x1="20" y1="21" x2="20" y2="16" />
            <line x1="20" y1="12" x2="20" y2="3" />
            <line x1="1" y1="14" x2="7" y2="14" />
            <line x1="9" y1="8" x2="15" y2="8" />
            <line x1="17" y1="16" x2="23" y2="16" />
          </svg>
          <span>Cấu hình cảnh báo &amp; Quy tắc leo thang</span>
        </h2>
        <p className={styles.pageSubtitle}>
          Điều chỉnh thời gian chờ xác nhận và ngưỡng tin cậy AI cho từng loại sự kiện. Hết thời
          gian chờ sẽ leo thang trong hệ thống; tích hợp gọi điện khẩn cấp được triển khai riêng.
        </p>
      </div>

      <EscalationRulesSection isAdmin={isAdmin} />
    </section>
  );
}
