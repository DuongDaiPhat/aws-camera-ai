import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, ChevronDown, Clock3, ListFilter, SlidersHorizontal } from 'lucide-react';
import { DatePicker } from '@/components/layout/DatePicker';
import { SelectMenu, type SelectOption } from '@/components/ui/SelectMenu';
import { TimeField } from '@/components/ui/TimeField';
import {
  archiveWindow,
  manualWindow,
  notificationClock,
  NOTIFICATION_STATES,
  todayWindow,
  type Bounds,
  type ClockRange,
  type NotificationState,
} from '@/lib/notification-periods';
import styles from './notification-inbox.module.css';

const HOURS = [
  { value: 0, label: 'Cả ngày' },
  ...[1, 3, 7, 12].map((value) => ({ value, label: `${value} giờ trước` })),
];
const DAYS = [
  { value: 0, label: 'Toàn bộ lịch sử' },
  { value: 1, label: 'Ngày hôm qua' },
  ...[3, 7, 12].map((value) => ({ value, label: `${value} ngày gần nhất` })),
];
const STATES = [
  { value: 'all', label: 'Tất cả trạng thái' },
  ...NOTIFICATION_STATES.map(({ value, label }) => ({
    value,
    label: value === 'pending' ? 'Cần xử lý' : label,
  })),
];
const dayLabel = new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

function FilterSelect({
  label,
  icon,
  value,
  options,
  onChange,
}: {
  label: string;
  icon: ReactNode;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
}) {
  return (
    <div className={styles.filterField}>
      <span>{label}</span>
      <SelectMenu
        label={label}
        tone="light"
        icon={icon}
        value={value}
        options={options}
        onChange={onChange}
      />
    </div>
  );
}

export function NotificationTypeFilter(props: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
}) {
  return <FilterSelect label="Loại thông báo" icon={<ListFilter size={16} />} {...props} />;
}

export function NotificationStateFilter({
  value,
  onChange,
}: {
  value: NotificationState;
  onChange: (value: NotificationState) => void;
}) {
  return (
    <FilterSelect
      label="Trạng thái xử lý"
      icon={<SlidersHorizontal size={16} />}
      options={STATES}
      value={value}
      onChange={(next) => onChange(next as NotificationState)}
    />
  );
}

function PeriodMenu({
  label,
  value,
  icon,
  children,
}: {
  label: string;
  value: string;
  icon: ReactNode;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0, maxHeight: 440 });
  const anchor = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  function close() {
    setOpen(false);
    anchor.current?.focus({ preventScroll: true });
  }
  useEffect(() => {
    if (!open) return;
    const locate = () => {
      const rect = anchor.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(390, innerWidth - 24);
      const height = Math.min(panel.current?.offsetHeight || 260, innerHeight - 24);
      setPosition({
        left: Math.max(12, Math.min(rect.left, innerWidth - width - 12)),
        top: Math.max(12, Math.min(rect.bottom + 8, innerHeight - height - 12)),
        maxHeight: innerHeight - 24,
      });
    };
    locate();
    const first =
      panel.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]') ??
      panel.current?.querySelector<HTMLButtonElement>('button');
    first?.focus({ preventScroll: true });
    const outside = (event: Event) => {
      if (
        event.target instanceof Node &&
        !anchor.current?.contains(event.target) &&
        !panel.current?.contains(event.target)
      )
        setOpen(false);
    };
    window.addEventListener('resize', locate);
    window.addEventListener('scroll', locate, true);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    return () => {
      window.removeEventListener('resize', locate);
      window.removeEventListener('scroll', locate, true);
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', outside);
    };
  }, [open]);

  return (
    <div className={styles.filterField}>
      <span>{label}</span>
      <button
        ref={anchor}
        type="button"
        className={styles.periodTrigger}
        aria-label={`${label}, ${value}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        {icon}
        <span>{value}</span>
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <div
            id={id}
            ref={panel}
            data-floating-surface
            role="dialog"
            aria-label={label}
            className={styles.periodPopup}
            style={position}
            onKeyDown={(event) => {
              if (event.key !== 'Escape' || event.defaultPrevented) return;
              event.stopPropagation();
              close();
            }}
          >
            {children(close)}
          </div>,
          document.body,
        )}
    </div>
  );
}

function PresetButtons({
  options,
  value,
  onChoose,
}: {
  options: typeof HOURS;
  value: number | null;
  onChoose: (value: number) => void;
}) {
  return (
    <div className={styles.presets} role="group" aria-label="Mốc có sẵn">
      {options.map((item) => (
        <button
          key={item.value}
          type="button"
          aria-pressed={value === item.value}
          onClick={() => onChoose(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export type Period = { preset: number; custom?: Required<Bounds> };
type PeriodProps = { period: Period; now: number; onChange: (period: Period) => void };

function TimeChoices({ period, now, onChange, close }: PeriodProps & { close: () => void }) {
  const [preset] = useState(() => todayWindow(now, period.preset));
  const times = period.custom ?? preset;
  const [draft, setDraft] = useState<ClockRange>(() => ({
    from: notificationClock.format(times.from),
    to: notificationClock.format(times.to),
  }));
  const [error, setError] = useState<string>();
  return (
    <>
      <PresetButtons
        options={HOURS}
        value={period.custom ? null : period.preset}
        onChoose={(value) => {
          onChange({ preset: value });
          close();
        }}
      />
      <form
        className={styles.periodForm}
        aria-label="Khoảng giờ tùy chọn"
        onSubmit={(event) => {
          event.preventDefault();
          const window = manualWindow(todayWindow(now).from, preset, draft);
          if ('error' in window) return setError(window.error);
          onChange({ preset: period.preset, custom: window.bounds });
          close();
        }}
      >
        <div className={styles.timeFields}>
          <TimeField
            label="Từ giờ"
            value={draft.from}
            onChange={(from) => {
              setDraft((current) => ({ ...current, from }));
              setError(undefined);
            }}
          />
          <TimeField
            label="Đến giờ"
            value={draft.to}
            onChange={(to) => {
              setDraft((current) => ({ ...current, to }));
              setError(undefined);
            }}
          />
        </div>
        {error && (
          <p role="alert" className={styles.validation}>
            {error}
          </p>
        )}
        <button type="submit" className={styles.apply}>
          Áp dụng giờ
        </button>
      </form>
    </>
  );
}

export function TodayTimeFilter(props: PeriodProps) {
  const { period } = props;
  const value = period.custom
    ? `${notificationClock.format(period.custom.from)} – ${notificationClock.format(period.custom.to)}`
    : (HOURS.find((item) => item.value === period.preset)?.label ?? 'Cả ngày');
  return (
    <PeriodMenu label="Khoảng giờ" icon={<Clock3 size={16} aria-hidden="true" />} value={value}>
      {(close) => <TimeChoices {...props} close={close} />}
    </PeriodMenu>
  );
}

function ArchiveChoices({ period, now, onChange, close }: PeriodProps & { close: () => void }) {
  const yesterday = archiveWindow(now, 1);
  const active = period.custom ?? archiveWindow(now, period.preset || 1);
  const [from, setFrom] = useState(new Date(active.from ?? yesterday.from!));
  const [to, setTo] = useState(new Date(active.to));
  const [error, setError] = useState<string>();
  return (
    <>
      <PresetButtons
        options={DAYS}
        value={period.custom ? null : period.preset}
        onChoose={(value) => {
          onChange({ preset: value });
          close();
        }}
      />
      <form
        className={styles.periodForm}
        aria-label="Khoảng ngày tùy chọn"
        onSubmit={(event) => {
          event.preventDefault();
          const start = new Date(from.getTime()).setHours(0, 0, 0, 0);
          const end = new Date(to.getFullYear(), to.getMonth(), to.getDate() + 1).getTime() - 1;
          if (start > end) return setError('Ngày kết thúc phải cùng ngày hoặc sau ngày bắt đầu.');
          if (end > yesterday.to) return setError('Lịch sử chỉ gồm các ngày trước hôm nay.');
          onChange({ preset: period.preset, custom: { from: start, to: end } });
          close();
        }}
      >
        <div className={styles.timeFields}>
          <div className={styles.archiveDate}>
            <span>Từ ngày</span>
            <DatePicker
              label="Từ ngày"
              value={from}
              maxDate={new Date(yesterday.to)}
              showValue
              onChange={(date) => {
                setFrom(date);
                setError(undefined);
              }}
            />
          </div>
          <div className={styles.archiveDate}>
            <span>Đến ngày</span>
            <DatePicker
              label="Đến ngày"
              value={to}
              maxDate={new Date(yesterday.to)}
              showValue
              onChange={(date) => {
                setTo(date);
                setError(undefined);
              }}
            />
          </div>
        </div>
        {error && (
          <p role="alert" className={styles.validation}>
            {error}
          </p>
        )}
        <button type="submit" className={styles.apply}>
          Áp dụng ngày
        </button>
      </form>
    </>
  );
}

export function ArchiveDateFilter(props: PeriodProps) {
  const { period } = props;
  const value = period.custom
    ? `${dayLabel.format(period.custom.from)} – ${dayLabel.format(period.custom.to)}`
    : (DAYS.find((item) => item.value === period.preset)?.label ?? 'Toàn bộ lịch sử');
  return (
    <PeriodMenu
      label="Khoảng ngày"
      icon={<CalendarDays size={16} aria-hidden="true" />}
      value={value}
    >
      {(close) => <ArchiveChoices {...props} close={close} />}
    </PeriodMenu>
  );
}
