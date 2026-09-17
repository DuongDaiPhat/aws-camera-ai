export const SESSION_COOKIE = 'camerai_session';

const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export function markBrowserSession(): void {
  if (typeof document === 'undefined') return;
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${SESSION_COOKIE}=active; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
}

export function clearBrowserSession(): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${SESSION_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}
