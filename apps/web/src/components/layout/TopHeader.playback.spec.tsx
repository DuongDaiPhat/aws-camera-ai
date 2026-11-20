// @vitest-environment jsdom
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi } from 'vitest';
import { TopHeader } from './TopHeader';
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
describe('Dashboard calendar to playback', () => {
  it('shares the picked date and only navigates on the explicit replay action', async () => {
    const onReplay = vi.fn();
    const selected: { date: Date | null } = { date: null };
    function Harness() {
      const [date, setDate] = useState<Date | null>(new Date(2026, 10, 16, 12));
      return (
        <TopHeader
          selectedDate={date}
          onSelectDate={(next) => {
            selected.date = next;
            setDate(next);
          }}
          onViewPlayback={onReplay}
        />
      );
    }
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => root.render(<Harness />));
    const day = Array.from(host.querySelectorAll('button')).find(
      (button) => button.querySelector('time')?.textContent === '18',
    );
    expect(day).toBeTruthy();
    await act(async () => day?.click());
    expect(selected.date?.getDate()).toBe(18);
    expect(onReplay).not.toHaveBeenCalled();
    const replay = Array.from(host.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Xem lại ngày này'),
    );
    await act(async () => replay?.click());
    expect(onReplay).toHaveBeenCalledTimes(1);
    expect(selected.date?.getMonth()).toBe(10);
    await act(async () => root.unmount());
    host.remove();
  });
});
