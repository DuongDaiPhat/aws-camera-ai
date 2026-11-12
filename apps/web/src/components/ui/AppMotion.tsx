'use client';
import type { ReactNode } from 'react';
import { MotionConfig } from 'motion/react';
export function AppMotion({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user" transition={{ type: 'spring', stiffness: 330, damping: 30 }}>
      {children}
    </MotionConfig>
  );
}
