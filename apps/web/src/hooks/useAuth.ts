'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrentUser, logout } from '@/lib/auth-client';
import type { CurrentUser } from '@/types';

export function useAuth() {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [isLoading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    getCurrentUser()
      .then((data) => {
        if (isMounted) setUser(data);
      })
      .catch(() => {
        // Có thể chưa đăng nhập hoặc lỗi mạng, middleware/client sẽ xử lý
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      await logout();
    } catch {
      // bỏ qua lỗi thu hồi token
    } finally {
      router.replace('/login');
      router.refresh();
    }
  }, [router]);

  return {
    user,
    isLoading,
    handleLogout,
  };
}
