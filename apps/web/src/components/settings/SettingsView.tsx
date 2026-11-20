'use client';

import { CaregiverSettingsView } from '@/components/household/CaregiverSettingsView';
import React, { useEffect, useState } from 'react';
import type { CurrentUser } from '@/lib/auth-client';
import { EscalationRulesSection } from './EscalationRulesSection';
import styles from './settings-view.module.css';

interface SettingsViewProps {
  user: CurrentUser | null;
}

interface ViewerPreferences {
  inAppAlerts: boolean;
  soundAlerts: boolean;
  compactView: boolean;
}

const DEFAULT_VIEWER_PREFS: ViewerPreferences = {
  inAppAlerts: true,
  soundAlerts: true,
  compactView: false,
};

function ViewerPersonalSettings({ user }: { user: CurrentUser }) {
  const storageKey = `camerai_viewer_prefs_${user.id}`;
  const [prefs, setPrefs] = useState<ViewerPreferences>(DEFAULT_VIEWER_PREFS);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        setPrefs({ ...DEFAULT_VIEWER_PREFS, ...(JSON.parse(raw) as Partial<ViewerPreferences>) });
      }
    } catch {
      // Ignore storage errors and keep defaults
    }
  }, [storageKey]);

  const updatePref = (key: keyof ViewerPreferences, value: boolean) => {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(next));
      setSavedMessage('Đã lưu tùy chọn cá nhân.');
    } catch {
      setSavedMessage('Không thể lưu vào trình duyệt.');
    }
  };

  return (
    <section className={styles.settingsContainer} aria-labelledby="settings-title">
      <div className={styles.headerSection}>
        <h2 id="settings-title" className={styles.pageTitle}>
          <span>Cài đặt cá nhân</span>
        </h2>
        <p className={styles.pageSubtitle}>
          Quản lý hồ sơ, bảo mật, kênh nhận thông báo và tùy chọn giao diện của bạn.
        </p>
      </div>

      <div className={styles.viewerGrid}>
        <article className={styles.ruleCard}>
          <div className={styles.cardHeader}>
            <h3 className={styles.viewerCardTitle}>Hồ sơ &amp; Tài khoản</h3>
          </div>
          <div className={styles.viewerCardBody}>
            <div className={styles.viewerFieldRow}>
              <span className={styles.viewerFieldLabel}>Họ và tên</span>
              <strong className={styles.viewerFieldValue}>{user.fullName}</strong>
            </div>
            <div className={styles.viewerFieldRow}>
              <span className={styles.viewerFieldLabel}>Email đăng nhập</span>
              <strong className={styles.viewerFieldValue}>{user.email}</strong>
            </div>
            <div className={styles.viewerFieldRow}>
              <span className={styles.viewerFieldLabel}>Vai trò</span>
              <strong className={styles.viewerFieldValue}>Người xem (Viewer)</strong>
            </div>
          </div>
        </article>

        <article className={styles.ruleCard}>
          <div className={styles.cardHeader}>
            <h3 className={styles.viewerCardTitle}>Mật khẩu &amp; Bảo mật</h3>
          </div>
          <div className={styles.viewerCardBody}>
            <p className={styles.viewerHint}>
              Tài khoản Viewer sử dụng mật khẩu do quản trị viên hoặc chủ hộ cấp. Nếu cần đổi mật
              khẩu hoặc khôi phục truy cập, vui lòng liên hệ quản trị viên hộ gia đình.
            </p>
          </div>
        </article>

        <article className={styles.ruleCard}>
          <div className={styles.cardHeader}>
            <h3 className={styles.viewerCardTitle}>Kênh nhận thông báo &amp; Giao diện</h3>
          </div>
          <div className={styles.viewerCardBody}>
            <label className={styles.viewerToggleRow}>
              <span>Hiển thị thông báo thông thường trong ứng dụng</span>
              <input
                type="checkbox"
                checked={prefs.inAppAlerts}
                onChange={(e) => updatePref('inAppAlerts', e.target.checked)}
              />
            </label>
            <label className={styles.viewerToggleRow}>
              <span>Âm báo khi có yêu cầu xác nhận mới</span>
              <input
                type="checkbox"
                checked={prefs.soundAlerts}
                onChange={(e) => updatePref('soundAlerts', e.target.checked)}
              />
            </label>
            <label className={styles.viewerToggleRow}>
              <span>Chế độ hiển thị gọn (Compact)</span>
              <input
                type="checkbox"
                checked={prefs.compactView}
                onChange={(e) => updatePref('compactView', e.target.checked)}
              />
            </label>
            {savedMessage && (
              <p className={styles.viewerSavedNotice} role="status">
                {savedMessage}
              </p>
            )}
          </div>
        </article>
      </div>
    </section>
  );
}

export function SettingsView({ user }: SettingsViewProps) {
  if (user?.role === 'CAREGIVER') return <CaregiverSettingsView />;
  if (user?.role === 'VIEWER') {
    return <ViewerPersonalSettings user={user} />;
  }

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
