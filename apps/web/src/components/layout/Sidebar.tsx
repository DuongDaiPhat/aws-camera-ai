'use client';

import type { CurrentUser } from '@/lib/auth-client';
import styles from './sidebar.module.css';

interface SidebarProps {
  user: CurrentUser | null;
  activeNav: string;
  onSelectNav: (nav: string) => void;
  onLogout: () => void;
  unresolvedEventCount?: number;
  onlineCameraCount?: number;
}

const ROLE_DISPLAY_NAMES: Record<string, string> = {
  ADMIN: 'Quản trị viên',
  CAREGIVER: 'Người giám sát',
  VIEWER: 'Người xem',
};

function SidebarBrand() {
  return (
    <div className={styles.brand}>
      <div className={styles.brandIconWrapper} aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 2.18l7 3.12v4.7c0 4.54-3.14 8.78-7 9.88-3.86-1.1-7-5.34-7-9.88V6.3l7-3.12z" />
          <path d="M12 6a3 3 0 100 6 3 3 0 000-6zm0 2a1 1 0 110 2 1 1 0 010-2zm-4 7c0-1.5 2-2.5 4-2.5s4 1 4 2.5V17H8v-2z" />
        </svg>
      </div>
      <div className={styles.brandTitles}>
        <div className={styles.brandHeaderRow}>
          <span className={styles.brandName}>CameraAI</span>
          <span className={styles.proBadge}>PRO</span>
        </div>
        <span className={styles.brandSubtitle}>SafeHome Security</span>
      </div>
    </div>
  );
}

function SidebarUserProfile({
  user,
  onLogout,
}: {
  user: CurrentUser | null;
  onLogout: () => void;
}) {
  const userInitials = user?.fullName
    ? user.fullName
        .trim()
        .split(/\s+/)
        .slice(-2)
        .map((p) => p[0]?.toUpperCase() ?? '')
        .join('')
    : 'DA';

  const userDisplayName = user?.fullName || 'Đức Anh';
  const userRoleLabel = user?.role
    ? (ROLE_DISPLAY_NAMES[user.role] ?? 'Người giám sát')
    : 'Người giám sát';

  return (
    <div className={styles.userFooter}>
      <div className={styles.userCard}>
        <div className={styles.userMain}>
          <div className={styles.avatar}>{userInitials}</div>
          <div className={styles.userInfo}>
            <span className={styles.userName}>{userDisplayName}</span>
            <span className={styles.userRole}>{userRoleLabel}</span>
          </div>
        </div>
        <button
          type="button"
          className={styles.logoutBtn}
          onClick={onLogout}
          title="Đăng xuất khỏi hệ thống"
          aria-label="Đăng xuất"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

interface NavItemProps {
  label: string;
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  badge?: React.ReactNode;
}

function NavItem({ label, active, onClick, icon, badge }: NavItemProps) {
  return (
    <button
      type="button"
      className={`${styles.navItem} ${active ? styles.navItemActive : ''}`}
      onClick={onClick}
    >
      <div className={styles.navItemContent}>
        {icon}
        <span>{label}</span>
      </div>
      {badge}
    </button>
  );
}

function DashboardIcon() {
  return (
    <svg className={styles.navIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}

function EventsIcon() {
  return (
    <svg className={styles.navIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

function CameraIcon() {
  return (
    <svg className={styles.navIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M23 7l-7 5 7 5V7z" />
      <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
    </svg>
  );
}

function ZonesIcon() {
  return (
    <svg className={styles.navIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M3 3h18v18H3z" strokeDasharray="3 3" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg className={styles.navIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
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
  );
}

function SidebarNavLinks({
  activeNav,
  onSelectNav,
  unresolvedEventCount,
  onlineCameraCount,
}: {
  activeNav: string;
  onSelectNav: (nav: string) => void;
  unresolvedEventCount: number;
  onlineCameraCount: number;
}) {
  return (
    <nav className={styles.nav}>
      <div className={styles.navGroup}>
        <NavItem
          label="Tổng quan"
          active={activeNav === 'dashboard'}
          onClick={() => onSelectNav('dashboard')}
          icon={<DashboardIcon />}
        />

        <NavItem
          label="Sự kiện"
          active={activeNav === 'events'}
          onClick={() => onSelectNav('events')}
          badge={
            unresolvedEventCount > 0 ? (
              <span className={`${styles.badge} ${styles.badgeRed}`}>{unresolvedEventCount}</span>
            ) : undefined
          }
          icon={<EventsIcon />}
        />

        <NavItem
          label="Camera"
          active={activeNav === 'cameras'}
          onClick={() => onSelectNav('cameras')}
          badge={
            <span className={`${styles.badge} ${styles.badgeNeutral}`}>{onlineCameraCount}</span>
          }
          icon={<CameraIcon />}
        />

        <NavItem
          label="Khu vực"
          active={activeNav === 'zones'}
          onClick={() => onSelectNav('zones')}
          icon={<ZonesIcon />}
        />
      </div>

      <div className={styles.navDivider} />

      <NavItem
        label="Cài đặt"
        active={activeNav === 'settings'}
        onClick={() => onSelectNav('settings')}
        icon={<SettingsIcon />}
      />
    </nav>
  );
}

export function Sidebar({
  user,
  activeNav,
  onSelectNav,
  onLogout,
  unresolvedEventCount = 2,
  onlineCameraCount = 4,
}: SidebarProps) {
  return (
    <aside className={styles.sidebar} aria-label="Điều hướng hệ thống">
      <div>
        <SidebarBrand />
        <SidebarNavLinks
          activeNav={activeNav}
          onSelectNav={onSelectNav}
          unresolvedEventCount={unresolvedEventCount}
          onlineCameraCount={onlineCameraCount}
        />
      </div>
      <SidebarUserProfile user={user} onLogout={onLogout} />
    </aside>
  );
}
