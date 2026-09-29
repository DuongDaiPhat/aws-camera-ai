import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, ApiError, setAccessToken } from './api-client';
import { selectionDetails, deleteKnownFace } from './known-faces-client';

afterEach(() => {
  vi.unstubAllGlobals();
  setAccessToken(null);
});
describe('US-09 API client', () => {
  it('để browser đặt multipart boundary và giữ token', async () => {
    const mocked = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', mocked);
    setAccessToken('test');
    const body = new FormData();
    body.append('personName', 'Test');
    await apiFetch('/known-faces', { method: 'POST', body });
    const headers = new Headers(mocked.mock.calls[0]?.[1]?.headers);
    expect(headers.has('Content-Type')).toBe(false);
    expect(headers.get('Authorization')).toBe('Bearer test');
  });
  it('giữ details cho nhiều ảnh và từ chối box sai', async () => {
    const details = {
      images: [
        {
          imageIndex: 0,
          faces: [{ faceIndex: 1, boundingBox: { x: 0, y: 0, width: 1, height: 1 } }],
        },
      ],
    };
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ error: { code: 'MULTIPLE_FACES', message: 'Chọn mặt', details } }),
            { status: 422 },
          ),
        ),
    );
    try {
      await apiFetch('/known-faces');
    } catch (error) {
      expect(selectionDetails(error)).toEqual(details);
    }
    expect(
      selectionDetails(
        new ApiError(422, 'MULTIPLE_FACES', '', '', {
          images: [{ imageIndex: 0, faces: [{ faceIndex: 0, boundingBox: { x: 2 } }] }],
        }),
      ),
    ).toBeNull();
  });
  it('phân biệt xóa hoàn tất và pending', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status: 204 }))
        .mockResolvedValueOnce(
          new Response('{"recognitionStatus":"SYNC_PENDING"}', { status: 202 }),
        ),
    );
    expect(await deleteKnownFace('one')).toBeUndefined();
    expect(await deleteKnownFace('two')).toEqual({ recognitionStatus: 'SYNC_PENDING' });
  });
});
