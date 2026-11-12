'use client';
import { useEffect, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import styles from './top-header.module.css';
interface Props {
  userName?: string;
  zones?: { id: string; name: string }[];
  selectedZone: string;
  onSelectZone: (zone: string) => void;
  onSimulateNewEvent?: () => void;
  pendingCount?: number | null;
  pageTitle?: string;
  showZoneFilter?: boolean;
  onViewEvents?: () => void;
}
export function TopHeader({
  userName = 'bạn',
  zones = [],
  selectedZone,
  onSelectZone,
  pendingCount = null,
  pageTitle = 'Tổng quan',
  showZoneFilter = true,
  onViewEvents,
}: Props) {
  const [date, setDate] = useState('Hôm nay');
  useEffect(() => {
    const update = () =>
      setDate(
        new Date().toLocaleDateString('vi-VN', {
          weekday: 'short',
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
        }),
      );
    update();
    const timer = setInterval(update, 60000);
    return () => clearInterval(timer);
  }, []);
  const options = [{ id: 'ALL', name: 'Tất cả khu vực' }, ...zones];
  if (!options.some((zone) => zone.id === selectedZone))
    options.push({ id: selectedZone, name: 'Khu vực đã chọn' });
  const status =
    pendingCount === null
      ? 'Đang đồng bộ trạng thái cảnh báo.'
      : pendingCount > 0
        ? `${pendingCount} cảnh báo đang chờ xử lý.`
        : 'Không có cảnh báo đang chờ xử lý.';
  return (
    <header className={styles.header}>
      <div className={styles.titles}>
        <div className={styles.breadcrumb}>
          <span>Không gian của bạn</span>
          <Icon name="chevron" size={12} />
          <span>{pageTitle}</span>
        </div>
        <h1>{pageTitle}</h1>
        <p>Chào {userName}. Mọi góc nhìn, trong một không gian.</p>
      </div>
      <div className={styles.controls}>
        <span className={styles.date}>
          <Icon name="activity" size={14} />
          {date}
        </span>
        {showZoneFilter && (
          <label className={styles.zoneLabel}>
            <select
              aria-label="Lọc theo khu vực"
              value={selectedZone}
              onChange={(event) => onSelectZone(event.target.value)}
            >
              {options.map((zone) => (
                <option key={zone.id} value={zone.id}>
                  {zone.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          type="button"
          className={`${styles.notice} ${pendingCount ? styles.pending : ''}`}
          onClick={onViewEvents}
          disabled={!onViewEvents}
          aria-label={status}
          title={status}
        >
          <Icon name="bell" size={18} />
          {pendingCount !== null && pendingCount > 0 && <span>{pendingCount}</span>}
        </button>
        <p className={`${styles.status} ${pendingCount ? styles.warning : ''}`} role="status">
          <span />
          {status}
        </p>
      </div>
    </header>
  );
}
