'use client';

import type { CurrentUser } from '@/types';
import { Icon } from '@/components/ui/Icon';
import { SlidingTabs, type SlidingTabItem } from '@/components/ui/SlidingTabs';
import styles from './sidebar.module.css';

interface SidebarProps {
  user: CurrentUser | null;
  activeNav: string;
  onSelectNav: (nav: string) => void;
  onLogout: () => void;
  unresolvedEventCount?: number;
  onlineCameraCount?: number;
  expanded: boolean;
  onToggle: () => void;
}

const navigation: SlidingTabItem[] = [
  { id: 'dashboard', label: 'Tổng quan', icon: 'grid' },
  { id: 'cameras', label: 'Camera', icon: 'camera' },
  { id: 'playback', label: 'Xem lại thời gian', icon: 'history' },
  { id: 'events', label: 'Thông báo', icon: 'bell' },
  { id: 'known-faces', label: 'Người quen', icon: 'face' },
  { id: 'zones', label: 'Khu vực', icon: 'zone' },
  { id: 'wellness', label: 'Sức khỏe', icon: 'heart' },
  { id: 'settings', label: 'Cài đặt', icon: 'settings' },
  { id: 'users', label: 'Quản lý tài khoản', icon: 'users' },
];
const viewerNavigation: SlidingTabItem[] = [
  { id: 'dashboard', label: 'Trang của tôi', icon: 'grid' },
  { id: 'cameras', label: 'Camera trực tiếp', icon: 'camera' },
  { id: 'playback', label: 'Xem lại', icon: 'history' },
  { id: 'events', label: 'Thông báo của tôi', icon: 'bell' },
  { id: 'settings', label: 'Cài đặt cá nhân', icon: 'settings' },
];
const roles: Record<string, string> = {
  ADMIN: 'Quản trị viên',
  CAREGIVER: 'Người giám sát',
  VIEWER: 'Người xem',
  RESIDENT: 'Thành viên',
};

export function Sidebar({
  user,
  activeNav,
  onSelectNav,
  onLogout,
  unresolvedEventCount,
  onlineCameraCount,
  expanded,
  onToggle,
}: SidebarProps) {
  const isViewer = user?.role === 'VIEWER';
  const baseNavigation = isViewer
    ? viewerNavigation
    : navigation.filter((item) => item.id !== 'users' || user?.role === 'ADMIN');
  const items = baseNavigation.map((item) => ({
    ...item,
    count:
      item.id === 'events'
        ? unresolvedEventCount
        : item.id === 'cameras'
          ? onlineCameraCount
          : undefined,
  }));
  const initials =
    user?.fullName
      ?.trim()
      .split(/\s+/)
      .slice(-2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || 'CA';

  return (
    <aside className={styles.sidebar} data-expanded={expanded} aria-label="Thanh điều hướng">
      <button
        type="button"
        className={styles.brand}
        onClick={() => onSelectNav('dashboard')}
        aria-label="CameraAI — về Tổng quan"
        title="CameraAI"
      >
        <span className={styles.brandMark}>
          <Icon name="aperture" size={30} />
        </span>
        <span className={styles.reveal}>
          <strong>CameraAI</strong>
          <small>Giám sát tại nhà</small>
        </span>
      </button>
      <button
        type="button"
        className={styles.toggle}
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls="main-navigation"
        aria-label={expanded ? 'Thu gọn menu' : 'Mở rộng menu'}
        title={expanded ? 'Thu gọn menu' : 'Mở rộng menu'}
      >
        <Icon name="chevron" size={17} />
      </button>
      <nav
        id="main-navigation"
        className={styles.navigation}
        data-entry-navigation
        aria-label="Các trang quản lý"
      >
        <SlidingTabs
          items={items}
          value={activeNav}
          onChange={onSelectNav}
          label="Điều hướng chính"
          orientation="vertical"
          collapsed={!expanded}
        />
      </nav>
      <div className={styles.account}>
        <div className={styles.profile} title={user?.fullName || 'Tài khoản'}>
          <span className={styles.avatar} aria-hidden="true">
            {initials}
          </span>
          <span className={styles.reveal}>
            <strong>{user?.fullName || 'Tài khoản'}</strong>
            <small>{user ? roles[user.role] || 'Thành viên' : 'Đang tải…'}</small>
          </span>
        </div>
        <button
          type="button"
          className={styles.logout}
          onClick={onLogout}
          aria-label="Đăng xuất"
          title="Đăng xuất"
        >
          <Icon name="logout" size={20} />
          <span className={styles.reveal}>Đăng xuất</span>
        </button>
      </div>
    </aside>
  );
}
