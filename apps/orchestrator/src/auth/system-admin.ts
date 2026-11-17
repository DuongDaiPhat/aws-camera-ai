import { SetMetadata } from '@nestjs/common';
import type { TokenClaims } from './auth.types';

export const SYSTEM_ADMIN_EMAIL = 'admin@camerai.local';
export const SYSTEM_ADMIN_REQUIRED = Symbol('system-admin-required');
export const SystemAdminOnly = () => SetMetadata(SYSTEM_ADMIN_REQUIRED, true);

export function isSystemAdmin(actor?: Pick<TokenClaims, 'role' | 'email'>): boolean {
  return actor?.role === 'ADMIN' && actor.email?.toLowerCase() === SYSTEM_ADMIN_EMAIL;
}
