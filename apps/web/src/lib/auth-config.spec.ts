import { afterEach, expect, it, vi } from 'vitest';
import { getAuthConfig } from './auth-config';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it.each(['jwt', 'cognito'])('loads the %s runtime provider without caching', async (provider) => {
  vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'https://api.example/v1');
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ provider })));
  vi.stubGlobal('fetch', fetch);
  expect(await getAuthConfig()).toEqual({ provider });
  expect(fetch).toHaveBeenCalledWith('https://api.example/v1/auth/config', { cache: 'no-store' });
});
it('uses the development endpoint when unset', async () => {
  vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', undefined);
  const fetch = vi.fn().mockResolvedValue(new Response('{"provider":"jwt"}'));
  vi.stubGlobal('fetch', fetch);
  await getAuthConfig();
  expect(fetch).toHaveBeenCalledWith('http://localhost:3001/api/v1/auth/config', {
    cache: 'no-store',
  });
});
it('rejects HTTP failures and unsupported providers', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response('{"provider":"other"}')),
  );
  await expect(getAuthConfig()).rejects.toThrow('Không tải được cấu hình');
  await expect(getAuthConfig()).rejects.toThrow('Chế độ đăng nhập không hợp lệ');
});
