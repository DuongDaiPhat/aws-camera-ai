'use client';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Icon, type IconName } from './Icon';
import styles from './sliding-tabs.module.css';

export interface SlidingTabItem {
  id: string;
  label: string;
  icon?: IconName;
  count?: number;
}
interface Props {
  items: SlidingTabItem[];
  value: string;
  onChange: (value: string) => void;
  label: string;
  variant?: 'navigation' | 'filter';
}
export function SlidingTabs({ items, value, onChange, label, variant = 'navigation' }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [pill, setPill] = useState({ x: 0, width: 0 });
  const reduce = useReducedMotion();
  const target = hovered ?? value;
  useEffect(() => {
    const container = root.current;
    if (!container) return;
    const update = () => {
      const button = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
        (item) => item.dataset.value === target,
      );
      if (button) setPill({ x: button.offsetLeft, width: button.offsetWidth });
    };
    update();
    const resize = new ResizeObserver(update);
    resize.observe(container);
    const fonts = document.fonts;
    void fonts.ready.then(update);
    return () => resize.disconnect();
  }, [target, items]);
  useEffect(() => {
    const container = root.current;
    const button = container?.querySelector<HTMLButtonElement>(
      '[aria-current="page"], [aria-selected="true"]',
    );
    if (!container || !button) return;
    const left = button.offsetLeft,
      right = left + button.offsetWidth;
    if (left < container.scrollLeft)
      container.scrollTo({ left: left - 8, behavior: reduce ? 'instant' : 'smooth' });
    else if (right > container.scrollLeft + container.clientWidth)
      container.scrollTo({
        left: right - container.clientWidth + 8,
        behavior: reduce ? 'instant' : 'smooth',
      });
  }, [value, reduce]);
  function keyboard(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (variant !== 'filter' || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key))
      return;
    event.preventDefault();
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : (index + (event.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length;
    root.current?.querySelectorAll<HTMLButtonElement>('button')[next]?.focus();
    onChange(items[next]!.id);
  }
  return (
    <div
      ref={root}
      className={`${styles.root} ${variant === 'filter' ? styles.filter : ''}`}
      role={variant === 'filter' ? 'tablist' : undefined}
      aria-label={label}
      onPointerLeave={() => setHovered(null)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setHovered(null);
      }}
    >
      <motion.span
        data-nav-indicator={variant}
        className={styles.pill}
        aria-hidden="true"
        initial={false}
        animate={{ x: pill.x, width: pill.width, opacity: pill.width ? 1 : 0 }}
        transition={
          reduce ? { duration: 0 } : { type: 'spring', stiffness: 430, damping: 36, mass: 0.8 }
        }
      />
      {items.map((item, index) => (
        <button
          type="button"
          key={item.id}
          data-value={item.id}
          className={`${styles.button} ${target === item.id ? styles.highlighted : ''}`}
          aria-current={variant === 'navigation' && value === item.id ? 'page' : undefined}
          role={variant === 'filter' ? 'tab' : undefined}
          aria-selected={variant === 'filter' ? value === item.id : undefined}
          tabIndex={variant === 'filter' && value !== item.id ? -1 : 0}
          onPointerEnter={() => setHovered(item.id)}
          onFocus={() => setHovered(item.id)}
          onKeyDown={(event) => keyboard(event, index)}
          onClick={() => onChange(item.id)}
        >
          {item.icon && <Icon name={item.icon} size={17} />}
          <span>{item.label}</span>
          {typeof item.count === 'number' && <span className={styles.count}>{item.count}</span>}
        </button>
      ))}
    </div>
  );
}
