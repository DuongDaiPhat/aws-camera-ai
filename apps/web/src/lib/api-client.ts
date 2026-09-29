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

const ACCESS_TOKEN_KEY = 'camerai_access_token';
let accessToken: string | null = null;
let refreshRequest: Promise<string> | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
  if (typeof window !== 'undefined' && window.sessionStorage) {
    if (token) {
      window.sessionStorage.setItem(ACCESS_TOKEN_KEY, token);
    } else {
      window.sessionStorage.removeItem(ACCESS_TOKEN_KEY);
    }
  }
}

export function getAccessToken(): string | null {
  if (!accessToken && typeof window !== 'undefined' && window.sessionStorage) {
    accessToken = window.sessionStorage.getItem(ACCESS_TOKEN_KEY);
  }
  return accessToken;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly traceId?: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  return request<T>(path, init, true);
}

/**
 * Upload multipart có báo tiến độ và dùng cùng cơ chế access/refresh token với apiFetch.
 */
export async function apiUpload<T>(
  path: string,
  body: FormData,
  onProgress?: (progressPercent: number) => void,
): Promise<T> {
  return uploadRequest<T>(path, body, onProgress, true);
}

async function request<T>(path: string, init: RequestInit, canRefresh: boolean): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: buildHeaders(init.headers, init.body instanceof FormData),
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
      error?: { code?: string; message?: string; traceId?: string; details?: unknown };
    };
    throw new ApiError(
      response.status,
      body.error?.code ?? 'UNKNOWN',
      body.error?.message ?? response.statusText,
      body.error?.traceId,
      body.error?.details,
    );
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

async function uploadRequest<T>(
  path: string,
  body: FormData,
  onProgress: ((progressPercent: number) => void) | undefined,
  canRefresh: boolean,
): Promise<T> {
  try {
    return await sendUpload<T>(path, body, onProgress);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401 || !canRefresh) throw error;

    try {
      const refreshedToken = await refreshAccessToken();
      setAccessToken(refreshedToken);
      return await uploadRequest<T>(path, body, onProgress, false);
    } catch (refreshError) {
      setAccessToken(null);
      redirectToLogin();
      throw refreshError;
    }
  }
}

function sendUpload<T>(
  path: string,
  body: FormData,
  onProgress?: (progressPercent: number) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE_URL}${path}`);
    xhr.withCredentials = true;

    const token = getAccessToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || !onProgress) return;
      onProgress(Math.round((event.loaded / event.total) * 100));
    };

    xhr.onerror = () => reject(new ApiError(0, 'NETWORK_ERROR', 'Không thể kết nối tới máy chủ.'));
    xhr.onload = () => {
      const responseBody = parseResponseBody(xhr.responseText);
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(
          new ApiError(
            xhr.status,
            responseBody.error?.code ?? 'UNKNOWN',
            responseBody.error?.message ?? xhr.statusText,
            responseBody.error?.traceId,
          ),
        );
        return;
      }
      resolve(responseBody as T);
    };

    xhr.send(body);
  });
}

function parseResponseBody(responseText: string): {
  error?: { code?: string; message?: string; traceId?: string };
  [key: string]: unknown;
} {
  if (!responseText) return {};
  try {
    return JSON.parse(responseText) as {
      error?: { code?: string; message?: string; traceId?: string };
      [key: string]: unknown;
    };
  } catch {
    return {};
  }
}

function canRefreshRequest(path: string): boolean {
  return path !== '/auth/login' && path !== '/auth/refresh';
}

function redirectToLogin(): void {
  if (typeof window === 'undefined' || window.location.pathname === '/login') return;
  document.cookie = 'camerai_session=; Path=/; Max-Age=0; SameSite=Lax';
  if (window.sessionStorage) window.sessionStorage.removeItem(ACCESS_TOKEN_KEY);
  window.location.assign('/login');
}

function buildHeaders(headers?: HeadersInit, multipart = false): HeadersInit {
  const token = getAccessToken();
  const result = new Headers(headers);
  if (multipart) result.delete('Content-Type');
  else if (!result.has('Content-Type')) result.set('Content-Type', 'application/json');
  const authorization = result.get('Authorization') ?? (token ? `Bearer ${token}` : null);
  result.delete('Authorization');
  return {
    ...Object.fromEntries(result.entries()),
    ...(authorization ? { Authorization: authorization } : {}),
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
