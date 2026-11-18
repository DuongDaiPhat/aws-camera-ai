import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
  createBrowserPublishSession,
  fetchCamera,
  updateCameraSource,
  updateCameraState,
} from '@/lib/cameras-client';
import { publishWebcam } from '../source/webcam-publish';

vi.mock('@/lib/cameras-client', () => ({
  createBrowserPublishSession: vi.fn(),
  fetchCamera: vi.fn(),
  updateCameraSource: vi.fn(),
  updateCameraState: vi.fn(),
}));

describe('publishWebcam', () => {
  beforeEach(() =>
    vi
      .mocked(fetchCamera)
      .mockResolvedValue({ sourceType: 'RTSP', isEnabled: false } as Awaited<
        ReturnType<typeof fetchCamera>
      >),
  );
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('configures and enables the webcam before publishing with the camera-bound bearer token', async () => {
    const calls: string[] = [];
    vi.mocked(updateCameraSource).mockImplementation(async () => {
      calls.push('source');
      return {} as Awaited<ReturnType<typeof updateCameraSource>>;
    });
    vi.mocked(updateCameraState).mockImplementation(async () => {
      calls.push('state');
      return { frigateSync: { status: 'SYNCED' } } as Awaited<ReturnType<typeof updateCameraState>>;
    });
    vi.mocked(createBrowserPublishSession).mockImplementation(async () => {
      calls.push('session');
      return {
        publishUrl: 'http://localhost:8889/cam_test/whip',
        streamKey: 'cam_test',
        token: 'short-lived-token',
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      };
    });

    class FakePeerConnection {
      iceGatheringState = 'complete';
      addTrack = vi.fn();
      createOffer = vi.fn().mockResolvedValue({ type: 'offer', sdp: 'offer-sdp' });
      setLocalDescription = vi.fn().mockResolvedValue(undefined);
      setRemoteDescription = vi.fn().mockResolvedValue(undefined);
      close = vi.fn();
      localDescription = { sdp: 'offer-sdp' };
    }
    vi.stubGlobal('RTCPeerConnection', FakePeerConnection);
    vi.stubGlobal(
      'RTCSessionDescription',
      class {
        constructor(public description: unknown) {}
      },
    );
    const fetchMock = vi.fn().mockImplementation(async () => {
      calls.push('whip');
      return { ok: true, text: async () => 'answer-sdp' };
    });
    vi.stubGlobal('fetch', fetchMock);

    const stream = { getTracks: () => [{ kind: 'video' }] } as unknown as MediaStream;
    await publishWebcam('camera-id', stream);

    expect(calls).toEqual(['source', 'state', 'session', 'whip']);
    expect(updateCameraSource).toHaveBeenCalledWith('camera-id', {
      sourceType: 'BROWSER_WEBCAM',
      videoLoop: true,
      transport: 'TCP',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8889/cam_test/whip',
      expect.objectContaining({
        headers: {
          'Content-Type': 'application/sdp',
          Authorization: 'Bearer short-lived-token',
        },
      }),
    );
  });

  it('does not publish when Frigate fails to accept the camera configuration', async () => {
    vi.mocked(updateCameraSource).mockResolvedValue(
      {} as Awaited<ReturnType<typeof updateCameraSource>>,
    );
    vi.mocked(updateCameraState).mockResolvedValue({
      frigateSync: { status: 'FAILED', errorMessage: 'Frigate unavailable' },
    } as Awaited<ReturnType<typeof updateCameraState>>);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(publishWebcam('camera-id', {} as MediaStream)).rejects.toThrow(
      'Frigate unavailable',
    );
    expect(createBrowserPublishSession).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reuses an enabled webcam configuration without resetting Frigate or recording', async () => {
    vi.mocked(fetchCamera).mockResolvedValue({
      sourceType: 'BROWSER_WEBCAM',
      isEnabled: true,
      frigateSync: { status: 'SYNCED' },
    } as Awaited<ReturnType<typeof fetchCamera>>);
    vi.mocked(createBrowserPublishSession).mockResolvedValue({
      publishUrl: 'http://localhost:8889/cam/whip',
      token: 'test-token',
      streamKey: 'cam',
      expiresAt: new Date().toISOString(),
    });
    class Peer {
      iceGatheringState = 'complete';
      localDescription = { sdp: 'offer' };
      addTrack = vi.fn();
      close = vi.fn();
      createOffer = vi.fn(async () => ({ type: 'offer', sdp: 'offer' }));
      setLocalDescription = vi.fn(async () => {});
      setRemoteDescription = vi.fn(async () => {});
    }
    vi.stubGlobal('RTCPeerConnection', Peer);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, text: async () => 'answer' })),
    );
    await publishWebcam('already-live', { getTracks: () => [] } as unknown as MediaStream);
    expect(updateCameraSource).not.toHaveBeenCalled();
    expect(updateCameraState).not.toHaveBeenCalled();
    expect(createBrowserPublishSession).toHaveBeenCalledOnce();
  });
});
