'use client';

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import styles from './select-menu.module.css';

const useClientLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export interface SelectOption {
  value: string;
  label: string;
}
export function SelectMenu({
  label,
  value,
  options,
  onChange,
  disabled,
  icon,
  tone = 'dark',
  visibleOptions,
}: {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  visibleOptions?: number;
  icon?: ReactNode;
  tone?: 'dark' | 'light' | 'violet';
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 180, maxHeight: 260 });
  const chosen = options.find((option) => option.value === value);
  const selected = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const enabled = open && !disabled;
  useClientLayoutEffect(() => {
    if (!enabled) return;
    const locate = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(Math.max(rect.width, 180), innerWidth - 24);
      const desired = visibleOptions
        ? Math.min(options.length, visibleOptions) * 38 + 12
        : Math.min(options.length * (tone === 'violet' ? 38 : 36) + 12, 260);
      const below = innerHeight - rect.bottom - 16;
      const above = rect.top - 16;
      const up = below < desired && above > below;
      const maxHeight = Math.max(50, Math.min(desired, up ? above : below));
      setPosition({
        left: Math.max(12, Math.min(rect.left, innerWidth - width - 12)),
        top: up ? rect.top - maxHeight - 6 : rect.bottom + 6,
        width,
        maxHeight,
      });
    };
    locate();
    window.addEventListener('resize', locate);
    window.addEventListener('scroll', locate, true);
    return () => {
      window.removeEventListener('resize', locate);
      window.removeEventListener('scroll', locate, true);
    };
  }, [enabled, options.length, tone, visibleOptions]);
  useEffect(() => {
    if (!enabled) return;
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !trigger.current?.contains(event.target) &&
        !menu.current?.contains(event.target)
      )
        setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [enabled]);
  useEffect(() => {
    if (enabled)
      menu.current
        ?.querySelector(`[data-index="${active}"]`)
        ?.scrollIntoView?.({ block: 'nearest' });
  }, [active, enabled]);
  function choose(index: number) {
    const option = options[index];
    if (option) onChange(option.value);
    setOpen(false);
    trigger.current?.focus();
  }
  function keyboard(event: KeyboardEvent<HTMLButtonElement>) {
    if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) {
      event.preventDefault();
      if (!enabled) {
        setActive(event.key === 'ArrowUp' ? options.length - 1 : selected);
        setOpen(true);
        return;
      }
      if (event.key === 'Enter' || event.key === ' ') {
        choose(active);
        return;
      }
      setActive((index) =>
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? options.length - 1
            : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length,
      );
    } else if (event.key === 'Escape' && enabled) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    } else if (event.key === 'Tab') setOpen(false);
    else if (event.key.length === 1) {
      const index = options.findIndex((option) =>
        option.label.toLocaleLowerCase('vi').startsWith(event.key.toLocaleLowerCase('vi')),
      );
      if (index >= 0) {
        setActive(index);
        setOpen(true);
      }
    }
  }
  return (
    <span className={styles.root}>
      <button
        ref={trigger}
        type="button"
        role="combobox"
        data-tone={tone}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={enabled}
        aria-controls={enabled ? id : undefined}
        aria-activedescendant={enabled ? `${id}-${active}` : undefined}
        disabled={disabled || !options.length}
        className={styles.trigger}
        onKeyDown={keyboard}
        onClick={() => {
          setActive(selected);
          setOpen(!enabled);
        }}
        onBlur={(event) => {
          if (!menu.current?.contains(event.relatedTarget)) setOpen(false);
        }}
      >
        {icon}
        <span>{chosen?.label ?? 'Chọn'}</span>
        <ChevronDown size={14} className={styles.chevron} />
      </button>
      {enabled &&
        createPortal(
          <div
            className={styles.menu}
            data-limited={Boolean(visibleOptions)}
            data-tone={tone}
            id={id}
            role="listbox"
            aria-label={label}
            ref={menu}
            style={position}
          >
            {options.map((option, index) => (
              <div
                key={option.value}
                id={`${id}-${index}`}
                role="option"
                aria-selected={option.value === value}
                data-active={index === active}
                data-index={index}
                className={styles.option}
                onPointerMove={() => setActive(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(index)}
              >
                <span>{option.label}</span>
                {option.value === value && <Check size={14} />}
              </div>
            ))}
          </div>,
          trigger.current?.closest('[data-floating-surface]') ??
            document.fullscreenElement ??
            document.body,
        )}
    </span>
  );
}
