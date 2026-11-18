// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { useNotificationReadState } from './useNotificationReadState';

function Receipt({ user }: { user: string }) {
  const { read, markRead } = useNotificationReadState(user);
  return (
    <button type="button" onClick={() => markRead('event-1')}>
      {read.has('event-1') ? 'Đã đọc' : 'Chưa đọc'}
    </button>
  );
}

it('only marks explicit reads and isolates persisted receipts per account', async () => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    value: true,
    configurable: true,
  });
  localStorage.clear();
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () => root.render(<Receipt user="a" />));
    expect(container.textContent).toBe('Chưa đọc');
    await act(async () => container.querySelector('button')!.click());
    expect(container.textContent).toBe('Đã đọc');
    await act(async () => root.render(<Receipt user="b" />));
    expect(container.textContent).toBe('Chưa đọc');
    await act(async () => root.render(<Receipt user="a" />));
    expect(container.textContent).toBe('Đã đọc');
  } finally {
    await act(async () => root.unmount());
  }
});
