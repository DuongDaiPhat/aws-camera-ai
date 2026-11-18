'use client';

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { createPortal } from 'react-dom';
import { Clock3, X } from 'lucide-react';
import styles from './time-field.module.css';

const UNITS = [
  { label: 'Giờ', count: 24 },
  { label: 'Phút', count: 60 },
  { label: 'Giây', count: 60 },
] as const;
const pad = (value: number) => String(value).padStart(2, '0');
function parseTime(value: string): number[] | null {
  if (!/^\d{1,2}:\d{1,2}:\d{1,2}$/.test(value)) return null;
  const values = value.split(':').map(Number);
  return values.every((part, index) => part >= 0 && part < UNITS[index].count) ? values : null;
}

export function TimeField({
  label,
  value,
  onChange,
  hideLabel = false,
  tone = 'light',
  compact = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hideLabel?: boolean;
  tone?: 'light' | 'dark';
  compact?: boolean;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState([0, 0, 0]);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const invalid = parseTime(value) === null;
  function close() {
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  }
  usePopupPosition(open, root, trigger, popup, setPosition);
  useEffect(() => {
    if (!open) return;
    popup.current
      ?.querySelectorAll<HTMLElement>('[aria-selected="true"]')
      .forEach(centerTimeChoice);
  }, [open, draft]);
  useOutsideTimePopup(open, root, popup, setOpen);
  function changePart(index: number, part: number) {
    setDraft((old) => old.map((value, item) => (item === index ? part : value)));
  }
  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number, part: number) {
    const count = UNITS[index].count;
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? count - 1
          : event.key === 'ArrowDown'
            ? (part + 1) % count
            : event.key === 'ArrowUp'
              ? (part + count - 1) % count
              : null;
    if (next === null) return;
    event.preventDefault();
    changePart(index, next);
    popup.current
      ?.querySelector<HTMLButtonElement>(`[data-unit="${index}"][data-value="${next}"]`)
      ?.focus({ preventScroll: true });
  }
  return (
    <div className={styles.root} ref={root} data-tone={tone} data-compact={compact}>
      {!hideLabel && <label htmlFor={id}>{label}</label>}
      <div className={styles.field}>
        <input
          id={id}
          type="text"
          inputMode="numeric"
          aria-label={label}
          value={value}
          placeholder="HH:mm:ss"
          maxLength={8}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={invalid}
          aria-describedby={invalid ? `${id}-error` : undefined}
          onChange={(event) => onChange(event.target.value)}
          onBlur={() => {
            const parts = parseTime(value);
            if (parts) onChange(parts.map(pad).join(':'));
          }}
        />
        <button
          type="button"
          ref={trigger}
          aria-label={`Chọn giờ ${label.toLocaleLowerCase('vi')}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? `${id}-popup` : undefined}
          onClick={() => {
            setDraft(parseTime(value) ?? [0, 0, 0]);
            setOpen(!open);
          }}
        >
          <Clock3 size={16} aria-hidden="true" />
        </button>
      </div>
      {invalid && (
        <small className={styles.error} id={`${id}-error`}>
          Nhập giờ 24 giờ: HH:mm:ss.
        </small>
      )}
      {open &&
        createPortal(
          <TimeChoices
            id={id}
            label={label}
            popup={popup}
            position={position}
            draft={draft}
            navigate={navigate}
            changePart={changePart}
            close={close}
            onChange={onChange}
          />,
          root.current?.closest('[data-floating-surface]') ??
            document.fullscreenElement ??
            document.body,
        )}
    </div>
  );
}

function usePopupPosition(
  open: boolean,
  root: RefObject<HTMLDivElement>,
  trigger: RefObject<HTMLButtonElement>,
  popup: RefObject<HTMLDivElement>,
  setPosition: Dispatch<SetStateAction<{ left: number; top: number }>>,
) {
  useLayoutEffect(() => {
    if (!open) return;
    const locate = () => {
      const rect = trigger.current?.getBoundingClientRect();
      const height = popup.current?.offsetHeight ?? 310;
      const width = popup.current?.offsetWidth ?? 284;
      if (!rect) return;
      setPosition({
        left: Math.max(
          8,
          Math.min(root.current?.getBoundingClientRect().left ?? rect.left, innerWidth - width - 8),
        ),
        top: Math.max(8, Math.min(rect.bottom + 8, innerHeight - height - 8)),
      });
    };
    locate();
    popup.current
      ?.querySelector<HTMLButtonElement>('[aria-selected="true"]')
      ?.focus({ preventScroll: true });
    window.addEventListener('resize', locate);
    window.addEventListener('scroll', locate, true);
    return () => {
      window.removeEventListener('resize', locate);
      window.removeEventListener('scroll', locate, true);
    };
  }, [open, root, trigger, popup, setPosition]);
}
function TimeChoices({
  id,
  label,
  popup,
  position,
  draft,
  navigate,
  changePart,
  close,
  onChange,
}: {
  id: string;
  label: string;
  popup: RefObject<HTMLDivElement>;
  position: { left: number; top: number };
  draft: number[];
  navigate: (event: KeyboardEvent<HTMLButtonElement>, index: number, part: number) => void;
  changePart: (index: number, part: number) => void;
  close: () => void;
  onChange: (value: string) => void;
}) {
  return (
    <div
      className={styles.popup}
      id={`${id}-popup`}
      ref={popup}
      style={position}
      role="dialog"
      aria-label={`Chọn thời gian ${label.toLocaleLowerCase('vi')}`}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          event.preventDefault();
          close();
        }
      }}
    >
      <div className={styles.heading}>
        <strong>
          {label} <span>· 24 giờ</span>
        </strong>
        <button type="button" aria-label="Đóng bộ chọn giờ" onClick={close}>
          <X size={16} />
        </button>
      </div>
      <div className={styles.columns}>
        {UNITS.map((unit, index) => (
          <div key={unit.label}>
            <span className={styles.unitLabel}>{unit.label}</span>
            <div className={styles.list} role="listbox" aria-label={unit.label}>
              {Array.from({ length: unit.count }, (_, part) => (
                <button
                  key={part}
                  type="button"
                  role="option"
                  aria-selected={draft[index] === part}
                  tabIndex={draft[index] === part ? 0 : -1}
                  data-unit={index}
                  data-value={part}
                  onKeyDown={(event) => navigate(event, index, part)}
                  onClick={() => changePart(index, part)}
                >
                  {pad(part)}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className={styles.footer}>
        <output>{draft.map(pad).join(':')}</output>
        <button
          type="button"
          onClick={() => {
            onChange(draft.map(pad).join(':'));
            close();
          }}
        >
          Chọn giờ
        </button>
      </div>
    </div>
  );
}

function useOutsideTimePopup(
  open: boolean,
  root: RefObject<HTMLDivElement>,
  popup: RefObject<HTMLDivElement>,
  setOpen: Dispatch<SetStateAction<boolean>>,
) {
  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      if (
        event.target instanceof Node &&
        !root.current?.contains(event.target) &&
        !popup.current?.contains(event.target)
      )
        setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', outside);
    };
  }, [open, root, popup, setOpen]);
}

function centerTimeChoice(item: HTMLElement) {
  const list = item.parentElement;
  if (list)
    list.scrollTop +=
      item.getBoundingClientRect().top -
      list.getBoundingClientRect().top -
      (list.clientHeight - item.offsetHeight) / 2;
}
