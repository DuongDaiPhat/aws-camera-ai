/**
 * Client goi Orchestrator API.
 *
 * Kieu du lieu KHONG duoc viet tay o day — import tu `@cam/contracts`,
 * duoc sinh ra tu api/openapi.yaml (`pnpm contracts:generate`).
 * Xem docs/api/API_GUIDE.md.
 */
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api/v1';

interface RefreshResponse {
  accessToken: string;
}

let accessToken: string | null = null;
let refreshRequest: Promise<string> | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly traceId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  return request<T>(path, init, true);
}

async function request<T>(path: string, init: RequestInit, canRefresh: boolean): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: buildHeaders(init.headers),
    credentials: 'include',
  });

  if (response.status === 401 && canRefresh && canRefreshRequest(path)) {
    try {
      const refreshedToken = await refreshAccessToken();
      setAccessToken(refreshedToken);
      return request<T>(path, init, false);
    } catch (error: unknown) {
      setAccessToken(null);
      redirectToLogin();
      throw error;
    }
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: { code?: string; message?: string; traceId?: string };
    };
    throw new ApiError(
      response.status,
      body.error?.code ?? 'UNKNOWN',
      body.error?.message ?? response.statusText,
      body.error?.traceId,
    );
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function canRefreshRequest(path: string): boolean {
  return path !== '/auth/login' && path !== '/auth/refresh';
}

function redirectToLogin(): void {
  if (typeof window === 'undefined' || window.location.pathname === '/login') return;
  document.cookie = 'camerai_session=; Path=/; Max-Age=0; SameSite=Lax';
  window.location.assign('/login');
}

function buildHeaders(headers?: HeadersInit): HeadersInit {
  return {
    'Content-Type': 'application/json',
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    ...(headers ?? {}),
  };
}

async function refreshAccessToken(): Promise<string> {
  refreshRequest ??= request<RefreshResponse>(
    '/auth/refresh',
    { method: 'POST', body: JSON.stringify({}) },
    false,
  )
    .then((response) => response.accessToken)
    .finally(() => {
      refreshRequest = null;
    });

  return refreshRequest;
}
