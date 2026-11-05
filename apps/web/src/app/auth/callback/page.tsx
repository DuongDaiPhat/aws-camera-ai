'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { setAccessToken } from '@/lib/api-client';
import { markBrowserSession } from '@/lib/auth-session';
import { completeCognitoLogin } from '@/lib/cognito-session';

export default function CallbackPage() {
  const router = useRouter();
  const [status, setStatus] = useState('Đang hoàn tất đăng nhập…');

  useEffect(() => {
    let active = true;
    completeCognitoLogin()
      .then((user) => {
        if (!active) return;
        setAccessToken(user.access_token);
        markBrowserSession();
        router.replace('/');
        router.refresh();
      })
      .catch(() => {
        if (active)
          setStatus('Không hoàn tất được đăng nhập. Hãy quay về trang đăng nhập và thử lại.');
      });
    return () => {
      active = false;
    };
  }, [router]);

  return <p>{status}</p>;
}
