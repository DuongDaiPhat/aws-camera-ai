import type { components } from '@cam/contracts';

export type AuthConfig = components['schemas']['AuthConfig'];

// Runtime configuration: changing AUTH_PROVIDER does not require a new browser bundle.
export async function getAuthConfig(): Promise<AuthConfig> {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api/v1';
  const response = await fetch(`${base}/auth/config`, { cache: 'no-store' });
  if (!response.ok) throw new Error('Không tải được cấu hình đăng nhập.');
  const config = (await response.json()) as AuthConfig;
  if (config.provider !== 'jwt' && config.provider !== 'cognito') {
    throw new Error('Chế độ đăng nhập không hợp lệ.');
  }
  return config;
}
