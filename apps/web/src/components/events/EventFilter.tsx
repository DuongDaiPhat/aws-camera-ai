'use client';

import type { FilterTabKey, FilterTabCounts } from '@/types';
import { SlidingTabs } from '@/components/ui/SlidingTabs';

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
    <SlidingTabs
      variant="filter"
      value={activeTab}
      onChange={(value) => onSelectTab(value as FilterTabKey)}
      label="Bộ lọc sự kiện"
      items={TABS.map((tab) => ({ id: tab.key, label: tab.label, count: counts[tab.countKey] }))}
    />
  );
}
