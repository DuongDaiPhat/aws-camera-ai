'use client';

import { useEffect, useState, type ReactNode } from 'react';
import {
  Bell,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ArrowUpRight,
  Sun,
  Moon,
} from 'lucide-react';
import { DatePicker } from './DatePicker';
import styles from './top-header.module.css';

interface TopHeaderProps {
  selectedDate?: Date | null;
  onSelectDate?: (date: Date | null) => void;
  onViewPlayback?: () => void;
  userName?: string;
  pendingCount?: number | null;
  pageTitle?: string;
  onViewEvents?: () => void;
  isDashboard?: boolean;
  leadingAction?: ReactNode;
  notificationControl?: ReactNode;
}
function dayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function addDays(date: Date, count: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + count);
  return next;
}

function WeekCalendar({
  selectedDate,
  onSelectDate,
  onViewPlayback,
}: Pick<TopHeaderProps, 'selectedDate' | 'onSelectDate' | 'onViewPlayback'>) {
  const [today, setToday] = useState<Date | null>(null);
  const [localDate, setLocalDate] = useState<Date | null>(null);
  const chosen = selectedDate === undefined ? localDate : selectedDate;
  const setChosen = (date: Date | null) => {
    setLocalDate(date);
    onSelectDate?.(date);
  };
  useEffect(() => {
    const update = () => setToday(new Date());
    update();
    const timer = setInterval(update, 60_000);
    return () => clearInterval(timer);
  }, []);
  const viewed = chosen ?? today;
  const monday = viewed ? addDays(viewed, -((viewed.getDay() + 6) % 7)) : null;
  const days = monday ? Array.from({ length: 7 }, (_, index) => addDays(monday, index)) : [];
  const isToday = viewed && today ? dayKey(viewed) === dayKey(today) : true;
  return (
    <section className={styles.calendarCard} data-entry-part="calendar" aria-label="Lịch tuần">
      <div className={styles.calendarHeader}>
        <span className={styles.month}>
          <CalendarDays size={17} aria-hidden="true" />
          {viewed ? `Tháng ${viewed.getMonth() + 1}, ${viewed.getFullYear()}` : 'Lịch của bạn'}
        </span>
        <div className={styles.calendarActions}>
          <DatePicker value={viewed} onChange={setChosen} />
          <button
            type="button"
            aria-label="Tuần trước"
            disabled={!viewed}
            onClick={() => viewed && setChosen(addDays(viewed, -7))}
          >
            <ChevronLeft size={15} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Tuần sau"
            disabled={!viewed}
            onClick={() => viewed && setChosen(addDays(viewed, 7))}
          >
            <ChevronRight size={15} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className={styles.week}>
        {days.length ? (
          days.map((day, index) => (
            <button
              type="button"
              key={dayKey(day)}
              className={styles.day}
              aria-label={day.toLocaleDateString('vi-VN', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
              aria-current={today && dayKey(day) === dayKey(today) ? 'date' : undefined}
              aria-pressed={viewed ? dayKey(day) === dayKey(viewed) : false}
              onClick={() => setChosen(day)}
            >
              <span>{['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'][index]}</span>
              <time dateTime={dayKey(day)}>{day.getDate()}</time>
            </button>
          ))
        ) : (
          <span className={styles.calendarLoading}>Đang tải lịch…</span>
        )}
      </div>
      <div className={styles.calendarFooter}>
        {viewed && (
          <time dateTime={dayKey(viewed)}>
            {viewed.toLocaleDateString('vi-VN', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
          </time>
        )}
        {onViewPlayback && (
          <button type="button" onClick={onViewPlayback}>
            Xem lại ngày này ↗
          </button>
        )}
        {!isToday && (
          <button type="button" aria-label="Về hôm nay" onClick={() => setChosen(null)}>
            Hôm nay
          </button>
        )}
      </div>
    </section>
  );
}

export function TopHeader({
  userName = 'bạn',
  pendingCount = null,
  pageTitle = 'Tổng quan',
  onViewEvents,
  isDashboard = true,
  leadingAction,
  notificationControl,
  selectedDate,
  onSelectDate,
  onViewPlayback,
}: TopHeaderProps) {
  const status =
    pendingCount === null
      ? 'Đang đồng bộ trạng thái cảnh báo.'
      : pendingCount > 0
        ? `${pendingCount} cảnh báo đang chờ xử lý.`
        : 'Không có cảnh báo đang chờ xử lý.';
  return (
    <header className={styles.header}>
      <div className={styles.greetingCard} data-entry-part="greeting">
        <div className={styles.greetingContent}>
          <div className={styles.copy}>
            <h1>{isDashboard ? `Xin chào, ${userName}!` : pageTitle}</h1>
            <p>
              {isDashboard
                ? 'Giám sát camera và cảnh báo thông minh cho ngôi nhà của bạn.'
                : `Xin chào, ${userName}. Quản lý không gian giám sát của bạn.`}
            </p>
            <span className={styles.alertStatus} role="status">
              {status}
            </span>
          </div>
          <div className={styles.greetingActions}>
            {leadingAction}
            {notificationControl ?? (
              <button
                type="button"
                disabled={!onViewEvents}
                aria-label={
                  pendingCount ? `Xem ${pendingCount} cảnh báo đang chờ xử lý` : 'Xem cảnh báo'
                }
                onClick={onViewEvents}
              >
                <Bell size={18} aria-hidden="true" />
                <ArrowUpRight size={12} aria-hidden="true" />
                {Boolean(pendingCount) && <span>{pendingCount! > 99 ? '99+' : pendingCount}</span>}
              </button>
            )}
            <button
              type="button"
              className={styles.themePreview}
              aria-label="Giao diện sáng / tối (sắp có)"
              aria-disabled="true"
              title="Chuyển giao diện sáng / tối — sắp có"
            >
              <Sun size={17} aria-hidden="true" />
              <Moon size={17} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
      <WeekCalendar
        selectedDate={selectedDate}
        onSelectDate={onSelectDate}
        onViewPlayback={onViewPlayback}
      />
    </header>
  );
}
