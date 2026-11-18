'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { SelectMenu } from '@/components/ui/SelectMenu';
import styles from './date-picker.module.css';

const key = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const dateLabel = (date: Date) =>
  date.toLocaleDateString('vi-VN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
function localDate(year: number, month: number, day: number) {
  const date = new Date(0);
  date.setHours(12, 0, 0, 0);
  date.setFullYear(year, month, day);
  return date;
}
export function DatePicker({
  value,
  onChange,
  label = 'Chọn ngày',
  showValue = false,
  maxDate,
}: {
  value: Date | null;
  onChange: (date: Date) => void;
  label?: string;
  showValue?: boolean;
  maxDate?: Date;
}) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(0);
  const [year, setYear] = useState(2026);
  const [yearText, setYearText] = useState('2026');
  const [position, setPosition] = useState({ top: 0, left: 0, maxHeight: 500 });
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const chosenKey = value ? key(value) : '';
  const today = new Date();
  const latest = maxDate && maxDate < today ? maxDate : today;
  const first = localDate(year, month, 1);
  const offset = (first.getDay() + 6) % 7;
  const count = localDate(year, month + 1, 0).getDate();
  const days = Array.from({ length: Math.ceil((offset + count) / 7) * 7 }, (_, i) =>
    localDate(year, month, i - offset + 1),
  );
  function close(restore = true) {
    setOpen(false);
    if (restore) trigger.current?.focus();
  }
  function choose(date: Date) {
    if (maxDate && date > maxDate) return;
    onChange(date);
    close();
  }
  function shift(delta: number) {
    const date = localDate(year, month + delta, 1);
    if (date.getFullYear() < 1 || date.getFullYear() > 9999) return;
    setMonth(date.getMonth());
    setYear(date.getFullYear());
    setYearText(String(date.getFullYear()));
  }
  useEffect(() => {
    if (!open) return;
    const locate = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(304, innerWidth - 24);
      const height = Math.min(390, innerHeight - 24);
      setPosition({
        left: Math.max(12, Math.min(rect.right - width, innerWidth - width - 12)),
        top: Math.max(12, Math.min(rect.bottom + 8, innerHeight - height - 12)),
        maxHeight: innerHeight - 24,
      });
    };
    locate();
    popup.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus();
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !popup.current?.contains(event.target) &&
        !trigger.current?.contains(event.target)
      )
        close(false);
    };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', locate);
    window.addEventListener('scroll', locate, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', locate);
      window.removeEventListener('scroll', locate, true);
    };
  }, [open]);
  return (
    <>
      <button
        type="button"
        ref={trigger}
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        disabled={!value}
        onClick={() => {
          if (!value) return;
          setMonth(value.getMonth());
          setYear(value.getFullYear());
          setYearText(String(value.getFullYear()));
          setOpen(!open);
        }}
      >
        {showValue && value && <span>{value.toLocaleDateString('vi-VN')}</span>}
        <CalendarDays size={16} aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <div
            ref={popup}
            data-floating-surface
            className={styles.popup}
            style={position}
            role="dialog"
            aria-modal="false"
            aria-label={
              label === 'Chọn ngày'
                ? 'Chọn ngày tháng năm'
                : `Chọn ${label.toLocaleLowerCase('vi')}`
            }
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                close();
              }
            }}
            onBlur={(event) => {
              if (
                event.relatedTarget instanceof Node &&
                !event.currentTarget.contains(event.relatedTarget) &&
                !trigger.current?.contains(event.relatedTarget)
              )
                close(false);
            }}
          >
            <header className={styles.heading}>
              <strong>Chọn ngày</strong>
              <button type="button" aria-label="Đóng chọn ngày" onClick={() => close()}>
                <X size={16} />
              </button>
            </header>
            <div className={styles.controls}>
              <SelectMenu
                label="Chọn tháng"
                tone="light"
                value={String(month)}
                options={Array.from({ length: 12 }, (_, i) => ({
                  value: String(i),
                  label: `Tháng ${i + 1}`,
                }))}
                onChange={(value) => setMonth(Number(value))}
              />
              <label className={styles.year}>
                Năm
                <input
                  type="number"
                  aria-label="Chọn năm"
                  min={1}
                  max={9999}
                  value={yearText}
                  onChange={(event) => {
                    const text = event.target.value;
                    setYearText(text);
                    const n = Number(text);
                    if (Number.isInteger(n) && n >= 1 && n <= 9999) setYear(n);
                  }}
                  onBlur={() => setYearText(String(year))}
                />
              </label>
              <button
                type="button"
                aria-label="Tháng trước"
                disabled={year === 1 && month === 0}
                onClick={() => shift(-1)}
              >
                <ChevronLeft size={15} />
              </button>
              <button
                type="button"
                aria-label="Tháng sau"
                disabled={year === 9999 && month === 11}
                onClick={() => shift(1)}
              >
                <ChevronRight size={15} />
              </button>
            </div>
            <div className={styles.weekdays} aria-hidden="true">
              {['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].map((d) => (
                <span key={d}>{d}</span>
              ))}
            </div>
            <div className={styles.days} aria-label="Các ngày trong tháng">
              {days.map((date) => (
                <button
                  type="button"
                  key={key(date)}
                  aria-label={dateLabel(date)}
                  aria-pressed={key(date) === chosenKey}
                  aria-current={key(date) === key(today) ? 'date' : undefined}
                  data-other={date.getMonth() !== month}
                  disabled={
                    date.getFullYear() < 1 ||
                    date.getFullYear() > 9999 ||
                    Boolean(maxDate && date > maxDate)
                  }
                  onClick={() => choose(date)}
                >
                  {date.getDate()}
                </button>
              ))}
            </div>
            <footer>
              <span>{value?.toLocaleDateString('vi-VN')}</span>
              <button type="button" onClick={() => choose(latest)}>
                {latest === today ? 'Hôm nay' : 'Ngày gần nhất'}
              </button>
            </footer>
          </div>,
          trigger.current?.closest('[data-floating-surface]') ?? document.body,
        )}
    </>
  );
}
