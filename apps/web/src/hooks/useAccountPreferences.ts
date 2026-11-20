'use client';
import { useEffect, useRef, useState } from 'react';
import { getAccountSettings, type NotificationPreferences } from '@/lib/household-client';
import type { UIEventItem } from '@/types';
const defaults: NotificationPreferences = {
  inAppAlerts: true,
  soundAlerts: true,
  telegramAlerts: true,
};
export function useAccountPreferences(userId?: string) {
  const [state, setState] = useState<{ id: string; value: NotificationPreferences } | null>(null);
  useEffect(() => {
    if (!userId) return;
    const owner = userId,
      abort = new AbortController();
    const load = () => {
      void getAccountSettings(abort.signal)
        .then((value) => {
          if (!abort.signal.aborted) setState({ id: owner, value });
        })
        .catch(() => {});
    };
    load();
    window.addEventListener('camerai-preferences-updated', load);
    return () => {
      abort.abort();
      window.removeEventListener('camerai-preferences-updated', load);
    };
  }, [userId]);
  return state && state.id === userId ? state.value : defaults;
}
export function useNewAlertSound(events: UIEventItem[], enabled: boolean, userId?: string) {
  const previous = useRef<{ owner: string | undefined; ids: Set<string> } | null>(null);
  useEffect(() => {
    const ids = new Set(events.map((event) => event.id));
    const before = previous.current;
    previous.current = { owner: userId, ids };
    if (!enabled || !before || before.owner !== userId || !before.ids.size) return;
    const added = events.some(
      (event) =>
        !before.ids.has(event.id) &&
        ['NOTIFIED', 'ESCALATED'].includes(event.status) &&
        event.priority !== 'P3',
    );
    if (!added || !window.AudioContext) return;
    const audio = new AudioContext(),
      oscillator = audio.createOscillator(),
      gain = audio.createGain();
    oscillator.frequency.value = 660;
    gain.gain.setValueAtTime(0.06, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.2);
    oscillator.connect(gain);
    gain.connect(audio.destination);
    oscillator.start();
    oscillator.stop(audio.currentTime + 0.2);
    oscillator.onended = () => {
      void audio.close();
    };
    return () => {
      void audio.close().catch(() => {});
    };
  }, [events, enabled, userId]);
}
