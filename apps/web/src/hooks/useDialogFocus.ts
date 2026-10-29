'use client';

import { useEffect, useRef } from 'react';

const scrollOwners = new Set<symbol>();
let originalOverflow = { body: '', root: '' };

function lockScroll(): () => boolean {
  const owner = Symbol('dialog');
  if (!scrollOwners.size) {
    originalOverflow = {
      body: document.body.style.overflow,
      root: document.documentElement.style.overflow,
    };
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
  }
  scrollOwners.add(owner);
  return () => {
    scrollOwners.delete(owner);
    if (scrollOwners.size) return false;
    document.body.style.overflow = originalOverflow.body;
    document.documentElement.style.overflow = originalOverflow.root;
    return true;
  };
}

function trapTab(event: KeyboardEvent, dialog: HTMLDivElement): void {
  const elements = Array.from(
    dialog.querySelectorAll<HTMLElement>(
      'a[href],button:not(:disabled),input:not(:disabled),video[controls],[tabindex="0"]',
    ),
  ).filter((item) => item.getClientRects().length > 0);
  const first = elements[0];
  const last = elements[elements.length - 1];
  if (!first || !last) {
    event.preventDefault();
    dialog.focus();
    return;
  }
  const target = event.shiftKey ? last : first;
  const boundary = event.shiftKey ? first : last;
  if (document.activeElement === boundary || document.activeElement === dialog) {
    event.preventDefault();
    target.focus();
  }
}

export function useDialogFocus(active: boolean, dismiss?: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const dismissRef = useRef(dismiss);
  dismissRef.current = dismiss;
  useEffect(() => {
    if (!active) return;
    const dialog = ref.current;
    if (!dialog) return;
    const previous = document.activeElement;
    const unlock = lockScroll();
    dialog.focus();
    const keydown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        dismissRef.current?.();
      }
      if (event.key === 'Tab') trapTab(event, dialog);
    };
    dialog.addEventListener('keydown', keydown);
    return () => {
      dialog.removeEventListener('keydown', keydown);
      if (unlock() && previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [active]);
  return ref;
}
