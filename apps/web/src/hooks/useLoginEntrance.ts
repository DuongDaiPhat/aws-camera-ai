'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { consumeLoginEntrance } from '@/lib/login-entrance';

type Phase = 'idle' | 'pending' | 'playing' | 'done';
export function useLoginEntrance(userId?: string) {
  const [phase, setPhase] = useState<Phase>('idle');
  const checked = useRef(false);
  const ready = useRef(false);
  const cancelled = useRef(false);
  const finish = useCallback(() => {
    cancelled.current = true;
    setPhase('done');
  }, []);
  const onReady = useCallback(() => {
    ready.current = true;
    setPhase((current) => (current === 'pending' ? 'playing' : current));
  }, []);
  useEffect(() => {
    if (!userId || checked.current) return;
    checked.current = true;
    if (consumeLoginEntrance() && !cancelled.current)
      setPhase(ready.current ? 'playing' : 'pending');
  }, [userId]);
  useEffect(() => {
    if (phase === 'pending') {
      const timer = setTimeout(() => setPhase('playing'), 1200);
      return () => clearTimeout(timer);
    }
    if (phase === 'playing') {
      const timer = setTimeout(finish, 1450);
      return () => clearTimeout(timer);
    }
  }, [phase, finish]);
  return { phase, onReady, finish };
}
