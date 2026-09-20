'use client';

import type { FilterTabKey, FilterTabCounts } from '@/types';
import styles from './event-filter.module.css';

export interface EventFilterProps {
  activeTab: FilterTabKey;
  onSelectTab: (tab: FilterTabKey) => void;
  counts: FilterTabCounts;
}

const TABS: Array<{ key: FilterTabKey; label: string; countKey: keyof FilterTabCounts }> = [
  { key: 'ALL', label: 'Tất cả', countKey: 'all' },
  { key: 'URGENT', label: 'Cần xử lý', countKey: 'urgent' },
  { key: 'SAFE', label: 'Đã an toàn', countKey: 'safe' },
  { key: 'INFO', label: 'Thông tin', countKey: 'info' },
];

export function EventFilter({ activeTab, onSelectTab, counts }: EventFilterProps) {
  return (
    <div className={styles.filterTabs} role="tablist" aria-label="Bộ lọc sự kiện">
      {TABS.map((tab) => {
        const isActive = activeTab === tab.key;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={`${styles.tabButton} ${isActive ? styles.tabButtonActive : ''}`}
            onClick={() => onSelectTab(tab.key)}
          >
            {tab.label} ({counts[tab.countKey]})
          </button>
        );
      })}
    </div>
  );
}
