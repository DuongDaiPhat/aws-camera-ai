import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('./auth-config', () => ({ getAuthConfig: vi.fn(async () => ({ provider: 'jwt' })) }));
vi.mock('./cognito-session', () => ({ refreshCognitoToken: vi.fn() }));
vi.mock('./auth-config', () => ({ getAuthConfig: vi.fn(async () => ({ provider: 'jwt' })) }));
vi.mock('./cognito-session', () => ({ refreshCognitoToken: vi.fn() }));
import { apiFetchBlob, setAccessToken } from './api-client';
describe('Authenticated video client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setAccessToken(null);
  });
  it('refreshes an expired session and still returns binary video', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ accessToken: 'refreshed' }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response('mp4 bytes', { headers: { 'Content-Type': 'video/mp4' } }),
      );
    vi.stubGlobal('fetch', fetcher);
    setAccessToken('expired');
    const blob = await apiFetchBlob('/playback/cameras/camera/clip');
    expect(blob.type).toBe('video/mp4');
    expect(await blob.text()).toBe('mp4 bytes');
    expect(fetcher.mock.calls[2]?.[1].headers.Authorization).toBe('Bearer refreshed');
  });
});
