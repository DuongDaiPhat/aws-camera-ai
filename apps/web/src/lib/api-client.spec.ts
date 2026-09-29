import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch, apiUpload, setAccessToken } from './api-client';

afterEach(() => {
  setAccessToken(null);
  vi.unstubAllGlobals();
});

describe('ApiError', () => {
  it('giu lai status, code va traceId de hien thi cho nguoi dung', () => {
    const error = new ApiError(401, 'TOKEN_EXPIRED', 'Token het han', 'trace-123');

    expect(error).toBeInstanceOf(Error);
    expect(error.status).toBe(401);
    expect(error.code).toBe('TOKEN_EXPIRED');
    expect(error.traceId).toBe('trace-123');
  });
});

describe('apiFetch', () => {
  it('tự refresh đúng một lần khi access token hết hạn rồi gọi lại API', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: { code: 'TOKEN_EXPIRED', message: 'Token hết hạn' } }),
          { status: 401, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ accessToken: 'new-access', refreshToken: '', expiresIn: 3600 }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 'ok' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    setAccessToken('expired-access');

    await expect(apiFetch<{ status: string }>('/events')).resolves.toEqual({ status: 'ok' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1]?.[0]).toContain('/auth/refresh');
    expect(fetchMock.mock.calls[2]?.[1]?.headers).toMatchObject({
      Authorization: 'Bearer new-access',
    });
  });

  it('không lặp refresh khi lần gọi lại vẫn nhận 401', async () => {
    const unauthorized = new Response(
      JSON.stringify({ error: { code: 'TOKEN_EXPIRED', message: 'Token hết hạn' } }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    );
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(unauthorized)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ accessToken: 'new-access', refreshToken: '', expiresIn: 3600 }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: { code: 'TOKEN_EXPIRED', message: 'Token hết hạn' } }),
          { status: 401, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiFetch('/events')).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('không gọi refresh khi chính yêu cầu đăng nhập trả 401', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: { code: 'INVALID_CREDENTIALS', message: 'Sai mật khẩu' } }),
          { status: 401, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      apiFetch('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: 'admin@camerai.local', password: 'wrong-password' }),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('apiUpload', () => {
  it('gui multipart bang XMLHttpRequest va bao cao tien do upload', async () => {
    const progressValues: number[] = [];

    class MockXMLHttpRequest {
      status = 200;
      responseText = JSON.stringify({ cameraId: 'camera-1', sourceType: 'VIDEO_FILE' });
      statusText = 'OK';
      withCredentials = false;
      upload = { onprogress: null as ((event: ProgressEvent) => void) | null };
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      headers: Record<string, string> = {};

      open(_method: string, _url: string): void {}

      setRequestHeader(name: string, value: string): void {
        this.headers[name] = value;
      }

      send(_body: FormData): void {
        this.upload.onprogress?.({
          lengthComputable: true,
          loaded: 50,
          total: 100,
        } as ProgressEvent);
        this.onload?.();
      }
    }

    vi.stubGlobal('XMLHttpRequest', MockXMLHttpRequest);
    setAccessToken('access-token');

    const result = await apiUpload<{ cameraId: string; sourceType: string }>(
      '/cameras/camera-1/source/video',
      new FormData(),
      (progress) => progressValues.push(progress),
    );

    expect(result.sourceType).toBe('VIDEO_FILE');
    expect(progressValues).toEqual([50]);
  });
});
