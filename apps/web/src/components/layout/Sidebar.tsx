'use client';
import type { CurrentUser } from '@/lib/auth-client';
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
}
const navigation: SlidingTabItem[] = [
  { id: 'dashboard', label: 'Tổng quan', icon: 'grid' },
  { id: 'cameras', label: 'Camera', icon: 'camera' },
  { id: 'events', label: 'Sự kiện', icon: 'bell' },
  { id: 'known-faces', label: 'Người quen', icon: 'face' },
  { id: 'zones', label: 'Khu vực', icon: 'zone' },
  { id: 'wellness', label: 'Sức khỏe', icon: 'heart' },
  { id: 'settings', label: 'Cài đặt', icon: 'settings' },
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
}: SidebarProps) {
  const items = navigation.map((item) => ({
    ...item,
    count:
      item.id === 'events' && unresolvedEventCount
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
    <header className={styles.topbar}>
      <button
        type="button"
        className={styles.brand}
        onClick={() => onSelectNav('dashboard')}
        aria-label="CameraAI — về Tổng quan"
      >
        <span className={styles.brandMark}>
          <Icon name="aperture" size={25} />
        </span>
        <span>
          Camera<span className={styles.brandAi}>AI</span>
          <small>Giám sát thông minh</small>
        </span>
      </button>
      <nav className={styles.navigation} aria-label="Các trang quản lý">
        <SlidingTabs
          items={items}
          value={activeNav}
          onChange={onSelectNav}
          label="Điều hướng chính"
        />
      </nav>
      <div className={styles.account}>
        <span className={styles.avatar}>{initials}</span>
        <div>
          <strong>{user?.fullName || 'Tài khoản'}</strong>
          <small>{user ? roles[user.role] || 'Thành viên' : 'Đang tải…'}</small>
        </div>
        <button
          type="button"
          className={styles.logout}
          onClick={onLogout}
          aria-label="Đăng xuất"
          title="Đăng xuất"
        >
          <Icon name="logout" size={18} />
        </button>
      </div>
    </header>
  );
}
