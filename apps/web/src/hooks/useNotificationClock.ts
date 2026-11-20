'use client';

import { useEffect, useState } from 'react';
import type { UIEventItem } from '@/types';
import { dayStart } from '@/lib/notification-periods';
import { nextNotificationExpiry } from '@/lib/notification-state';

export function useNotificationClock(events: UIEventItem[]) {
  const [now, setNow] = useState(Date.now);
  const until = Math.min(nextNotificationExpiry(events, now), dayStart(now, -1));
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const interval = window.setInterval(tick, 15000);
    window.addEventListener('focus', tick);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', tick);
    };
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => setNow(Date.now()), Math.max(0, until - Date.now()));
    return () => window.clearTimeout(timer);
  }, [until]);
  // A newly received event can be newer than the most recent clock tick.
  return Math.max(now, Date.now());
}
