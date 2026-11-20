import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { AppMotion } from '@/components/ui/AppMotion';

export const metadata: Metadata = {
  title: 'CameraAI — Giám sát an toàn tại nhà',
  description: 'Hệ thống camera giám sát hành vi ứng dụng AI và AWS',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <body>
        <AppMotion>{children}</AppMotion>
      </body>
    </html>
  );
}
