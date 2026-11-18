// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  cameraReadEndpoint,
  subscribeCameraRead,
  refreshCameraReadUrl,
  type LiveStreamSnapshot,
} from '../live/camera-reader';

class Peer {
  static instances: Peer[] = [];
  iceGatheringState = 'complete';
  connectionState = 'new';
  localDescription = { type: 'offer', sdp: 'video-offer' };
  ontrack: ((event: RTCTrackEvent) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  close = vi.fn();
  addTransceiver = vi.fn();
  createOffer = vi.fn(async () => this.localDescription);
  setLocalDescription = vi.fn(async () => {});
  setRemoteDescription = vi.fn(async () => {});
  constructor() {
    Peer.instances.push(this);
  }
}
const address = 'http://localhost:8889/cam_test/?token=private';
const accepted = (location = '/cam_test/whep/session') =>
  new Response('video-answer', {
    status: 201,
    headers: { Location: location },
  });
let fetcher: ReturnType<typeof vi.fn>;
let dispose: (() => void)[];
beforeEach(() => {
  vi.useFakeTimers();
  Peer.instances = [];
  dispose = [];
  vi.stubGlobal('RTCPeerConnection', Peer);
  fetcher = vi.fn(async () => accepted());
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => {
  dispose.forEach((stop) => stop());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function flush() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

it('addresses WHEP with its original token and removes iframe-only options', () => {
  const url = cameraReadEndpoint(address + '&controls=false#player');
  expect(url.pathname).toBe('/cam_test/whep');
  expect(url.searchParams.get('token')).toBe('private');
  expect(url.searchParams.has('controls')).toBe(false);
  expect(url.hash).toBe('');
});

it('shares a receiver and tears it down only after the final view closes', async () => {
  const first = vi.fn(),
    second = vi.fn();
  const stop = subscribeCameraRead(address, first);
  dispose.push(subscribeCameraRead(address, second));
  await flush();
  expect(Peer.instances).toHaveLength(1);
  expect(fetcher).toHaveBeenCalledWith(
    expect.stringContaining('/cam_test/whep?token=private'),
    expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer private' }),
    }),
  );
  const stream = {} as MediaStream;
  Peer.instances[0]!.ontrack?.({ streams: [stream] } as unknown as RTCTrackEvent);
  expect(second).toHaveBeenLastCalledWith({ status: 'live', stream });
  stop();
  expect(Peer.instances[0]!.close).not.toHaveBeenCalled();
  dispose.pop()!();
  expect(Peer.instances[0]!.close).toHaveBeenCalledOnce();
  expect(fetcher).toHaveBeenLastCalledWith(
    'http://localhost:8889/cam_test/whep/session',
    expect.objectContaining({ method: 'DELETE' }),
  );
});

it('turns a missing stream into unavailable and retries with a refreshed read token', async () => {
  fetcher.mockResolvedValueOnce(new Response('{"error":"stream not found"}', { status: 404 }));
  const listener = vi.fn<(state: LiveStreamSnapshot) => void>();
  dispose.push(subscribeCameraRead(address, listener));
  await flush();
  expect(listener).toHaveBeenLastCalledWith({ status: 'unavailable', stream: null });
  refreshCameraReadUrl(address.replace('private', 'renewed'));
  await vi.advanceTimersByTimeAsync(2500);
  expect(Peer.instances).toHaveLength(2);
  expect(fetcher).toHaveBeenLastCalledWith(
    expect.stringContaining('token=renewed'),
    expect.anything(),
  );
  Peer.instances[1]!.ontrack?.({ streams: [{} as MediaStream] } as unknown as RTCTrackEvent);
  expect(listener.mock.lastCall?.[0].status).toBe('live');
  refreshCameraReadUrl(address.replace('private', 'next-token'));
  expect(Peer.instances).toHaveLength(2);
});

it('reconnects after transport failure and releases a reader that never gets a track', async () => {
  const listener = vi.fn();
  dispose.push(subscribeCameraRead(address, listener));
  await flush();
  Peer.instances[0]!.connectionState = 'failed';
  Peer.instances[0]!.onconnectionstatechange?.();
  expect(listener.mock.lastCall?.[0].status).toBe('unavailable');
  await vi.advanceTimersByTimeAsync(2500);
  await vi.advanceTimersByTimeAsync(10000);
  expect(Peer.instances[1]!.close).toHaveBeenCalledOnce();
  expect(listener.mock.lastCall?.[0].status).toBe('unavailable');
});

it('cleans up a late session without closing a newly subscribed receiver or leaking its token', async () => {
  let resolveOld!: (response: Response) => void;
  fetcher.mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        resolveOld = resolve;
      }),
  );
  const stop = subscribeCameraRead(address, vi.fn());
  await flush();
  stop();
  dispose.push(subscribeCameraRead(address, vi.fn()));
  await flush();
  resolveOld(accepted('/cam_test/whep/old-session'));
  await flush();
  expect(Peer.instances[1]!.close).not.toHaveBeenCalled();
  expect(fetcher).toHaveBeenLastCalledWith(
    'http://localhost:8889/cam_test/whep/old-session',
    expect.objectContaining({ method: 'DELETE' }),
  );
});

it('does not forward session authorization to a cross-origin cleanup URL', async () => {
  fetcher.mockResolvedValueOnce(accepted('https://other.example/session'));
  const stop = subscribeCameraRead(address, vi.fn());
  await flush();
  stop();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
