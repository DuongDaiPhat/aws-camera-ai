'use client';

import { useState, useEffect, useRef } from 'react';
import styles from './top-header.module.css';

interface TopHeaderProps {
  userName?: string;
  selectedZone: string;
  onSelectZone: (zone: string) => void;
  onSimulateNewEvent: () => void;
}

const ZONE_OPTIONS = [
  { id: 'ALL', name: 'Tất cả khu vực' },
  { id: 'bep', name: 'Khu vực bếp nấu' },
  { id: 'phong-khach', name: 'Khu vực ghế sofa' },
  { id: 'cua-chinh', name: 'Lối vào sảnh' },
  { id: 'tang-1', name: 'Tầng 1' },
  { id: 'phong-ngu', name: 'Phòng ngủ' },
];

function ZoneDropdownMenu({
  isOpen,
  selectedZone,
  onSelect,
}: {
  isOpen: boolean;
  selectedZone: string;
  onSelect: (id: string) => void;
}) {
  if (!isOpen) return null;

  return (
    <div className={styles.zoneDropdown} role="listbox">
      {ZONE_OPTIONS.map((z) => (
        <button
          key={z.id}
          type="button"
          className={`${styles.zoneOption} ${selectedZone === z.id ? styles.zoneOptionActive : ''}`}
          onClick={() => onSelect(z.id)}
          role="option"
          aria-selected={selectedZone === z.id}
        >
          <span>{z.name}</span>
          {selectedZone === z.id && <span>✓</span>}
        </button>
      ))}
    </div>
  );
}

export function TopHeader({
  userName = 'Đức Anh',
  selectedZone,
  onSelectZone,
  onSimulateNewEvent,
}: TopHeaderProps) {
  const [timeText, setTimeText] = useState('12:32');
  const [greeting, setGreeting] = useState('Chào buổi tối');
  const [isZoneOpen, setZoneOpen] = useState(false);
  const zoneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function updateClock() {
      const now = new Date();
      const hours = now.getHours();
      const mins = now.getMinutes().toString().padStart(2, '0');
      setTimeText(`${hours}:${mins}`);
      setGreeting(hours < 12 ? 'Chào buổi sáng' : hours < 18 ? 'Chào buổi chiều' : 'Chào buổi tối');
    }
    updateClock();
    const timer = setInterval(updateClock, 30000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (zoneRef.current && !zoneRef.current.contains(event.target as Node)) {
        setZoneOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedZoneLabel =
    ZONE_OPTIONS.find((z) => z.id === selectedZone)?.name ?? 'Tất cả khu vực';

  return (
    <header className={styles.header}>
      <div className={styles.leftSection}>
        <h1 className={styles.greeting}>
          {greeting}, {userName}
        </h1>
        <span className={styles.divider} aria-hidden="true">
          /
        </span>
        <div className={styles.statusPill}>
          <span className={styles.greenDot} aria-hidden="true" />
          <span>Mọi thứ trong nhà đang an toàn và được theo dõi bình thường.</span>
        </div>
      </div>

      <div className={styles.rightSection}>
        <button
          type="button"
          className={styles.simulateBtn}
          onClick={onSimulateNewEvent}
          title="Mô phỏng sự kiện mới thời gian thực (Scenario 2)"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          <span>Thử sự kiện mới</span>
        </button>

        <div className={styles.liveBadge}>
          <span className={styles.pulseDot} aria-hidden="true" />
          <span>Cập nhật trực tiếp</span>
          <span className={styles.clockTime}>• {timeText}</span>
        </div>

        <span className={styles.vSeparator} aria-hidden="true" />

        <button
          type="button"
          className={styles.iconButton}
          aria-label="Xem thông báo"
          title="Thông báo hệ thống"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
          <span className={styles.bellBadge} aria-hidden="true" />
        </button>

        <div className={styles.zoneSelectWrapper} ref={zoneRef}>
          <button
            type="button"
            className={styles.zoneSelectButton}
            onClick={() => setZoneOpen((o) => !o)}
            aria-expanded={isZoneOpen}
            aria-haspopup="listbox"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
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
            <span>{selectedZoneLabel}</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          <ZoneDropdownMenu
            isOpen={isZoneOpen}
            selectedZone={selectedZone}
            onSelect={(id) => {
              onSelectZone(id);
              setZoneOpen(false);
            }}
          />
        </div>
      </div>
    </header>
  );
}
