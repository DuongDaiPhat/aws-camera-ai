// @vitest-environment jsdom
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { useDialogFocus } from './useDialogFocus';

function Detail() {
  const ref = useDialogFocus(true);
  return (
    <div ref={ref} tabIndex={-1}>
      Detail
    </div>
  );
}
function Flow() {
  const [opened, setOpened] = useState(false);
  const ref = useDialogFocus(!opened);
  return opened ? (
    <Detail />
  ) : (
    <div ref={ref} tabIndex={-1}>
      <button onClick={() => setOpened(true)}>Open</button>
    </div>
  );
}
describe('dialog handoff', () => {
  it('keeps the document locked when attention is replaced by details and restores it on exit', async () => {
    Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
      value: true,
      configurable: true,
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(<Flow />));
      await act(async () => container.querySelector('button')?.click());
      expect(document.body.style.overflow).toBe('hidden');
      expect(document.documentElement.style.overflow).toBe('hidden');
      expect(document.activeElement?.textContent).toBe('Detail');
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
    expect(document.body.style.overflow).toBe('');
    expect(document.documentElement.style.overflow).toBe('');
  });
});
