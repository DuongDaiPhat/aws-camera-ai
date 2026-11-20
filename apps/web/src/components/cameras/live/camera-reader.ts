export type LiveStreamStatus = 'connecting' | 'live' | 'unavailable' | 'unsupported';
export interface LiveStreamSnapshot {
  status: LiveStreamStatus;
  stream: MediaStream | null;
}

const RETRY_DELAY_MS = 2500;
const CONNECTION_TIMEOUT_MS = 10000;
const SESSION_DELETE_TIMEOUT_MS = 3000;
type Listener = (snapshot: LiveStreamSnapshot) => void;
interface ReadResource {
  url: string;
  headers: Record<string, string>;
}
interface Attempt {
  peer: RTCPeerConnection;
  abort: AbortController;
  timeout: ReturnType<typeof setTimeout>;
  resource?: ReadResource;
}

export function cameraReadEndpoint(address: string): URL {
  const url = new URL(
    address,
    typeof location === 'undefined' ? 'http://localhost' : location.href,
  );
  url.pathname = url.pathname.replace(/\/$/, '').replace(/\/whep$/, '') + '/whep';
  for (const key of ['controls', 'muted', 'autoplay', 'playsInline', 'disablepictureinpicture'])
    url.searchParams.delete(key);
  url.hash = '';
  return url;
}

export function cameraReadKey(address: string): string {
  const url = cameraReadEndpoint(address);
  url.searchParams.delete('token');
  return url.href;
}

function deleteReadResource(resource?: ReadResource) {
  if (!resource) return;
  // Failed cleanup expires on the server; never expose credentials in logs.
  void fetch(resource.url, {
    method: 'DELETE',
    headers: resource.headers,
    redirect: 'error',
    signal: AbortSignal.timeout(SESSION_DELETE_TIMEOUT_MS),
  }).catch(() => undefined);
}

function gatherCandidates(peer: RTCPeerConnection, signal: AbortSignal): Promise<void> {
  if (peer.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      peer.removeEventListener('icegatheringstatechange', changed);
      signal.removeEventListener('abort', aborted);
    };
    const changed = () => {
      if (peer.iceGatheringState === 'complete') {
        cleanup();
        resolve();
      }
    };
    const aborted = () => {
      cleanup();
      reject(new Error('Read cancelled'));
    };
    peer.addEventListener('icegatheringstatechange', changed);
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) aborted();
  });
}

class CameraReader {
  address: string;
  listeners = new Set<Listener>();
  snapshot: LiveStreamSnapshot = { status: 'connecting', stream: null };
  private attempt?: Attempt;
  private retry?: ReturnType<typeof setTimeout>;
  private stopped = false;

  constructor(address: string) {
    this.address = address;
  }

  private emit(status: LiveStreamStatus, stream: MediaStream | null = null) {
    this.snapshot = { status, stream };
    for (const listener of this.listeners) listener(this.snapshot);
  }

  private release() {
    const attempt = this.attempt;
    this.attempt = undefined;
    if (!attempt) return;
    clearTimeout(attempt.timeout);
    attempt.abort.abort();
    attempt.peer.ontrack = null;
    attempt.peer.onconnectionstatechange = null;
    attempt.peer.close();
    deleteReadResource(attempt.resource);
  }

  retryRead = () => {
    if (this.stopped || this.retry) return;
    this.release();
    this.emit('unavailable');
    this.retry = setTimeout(() => {
      this.retry = undefined;
      void this.connect();
    }, RETRY_DELAY_MS);
  };

  private createAttempt(): Attempt {
    const peer = new RTCPeerConnection();
    const current: Attempt = {
      peer,
      abort: new AbortController(),
      timeout: setTimeout(this.retryRead, CONNECTION_TIMEOUT_MS),
    };
    this.attempt = current;
    peer.addTransceiver('video', { direction: 'recvonly' });
    peer.ontrack = (event) => {
      if (this.attempt !== current || this.stopped) return;
      clearTimeout(current.timeout);
      this.emit('live', event.streams[0] ?? new MediaStream([event.track]));
    };
    peer.onconnectionstatechange = () => {
      if (this.attempt === current && ['failed', 'disconnected'].includes(peer.connectionState))
        this.retryRead();
    };
    return current;
  }

  async connect() {
    if (this.stopped) return;
    if (typeof RTCPeerConnection === 'undefined') {
      this.emit('unsupported');
      return;
    }
    this.emit('connecting');
    let attempt: Attempt | undefined;
    try {
      attempt = this.createAttempt();
      const current = attempt;
      const { peer } = current;
      await peer.setLocalDescription(await peer.createOffer());
      await gatherCandidates(peer, current.abort.signal);
      if (this.attempt !== current) return;
      const endpoint = cameraReadEndpoint(this.address);
      const token = endpoint.searchParams.get('token');
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
      // Send a complete video-only offer to the authenticated WHEP endpoint.
      const response = await fetch(endpoint.href, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/sdp' },
        body: peer.localDescription?.sdp,
        signal: current.abort.signal,
        redirect: 'error',
      });
      const location = response.headers.get('Location');
      const session = location ? new URL(location, endpoint) : null;
      const resource =
        response.ok && session?.origin === endpoint.origin
          ? { url: session.href, headers }
          : undefined;
      // A late response owns only its own session, never a newer connection.
      if (this.attempt !== current || this.stopped) {
        deleteReadResource(resource);
        return;
      }
      current.resource = resource;
      if (!response.ok) throw new Error('Camera read unavailable');
      const sdp = await response.text();
      if (this.attempt !== current) return;
      await peer.setRemoteDescription({ type: 'answer', sdp });
    } catch {
      if (!this.stopped && (!attempt || this.attempt === attempt)) this.retryRead();
    }
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.retry);
    this.release();
  }
}

// Dashboard and area views share a receiver but keep independent video elements.
const readers = new Map<string, CameraReader>();
export function subscribeCameraRead(address: string, listener: Listener): () => void {
  const key = cameraReadKey(address);
  let reader = readers.get(key);
  if (!reader) {
    reader = new CameraReader(address);
    readers.set(key, reader);
  }
  reader.address = address;
  reader.listeners.add(listener);
  listener(reader.snapshot);
  if (reader.listeners.size === 1) void reader.connect();
  return () => {
    reader.listeners.delete(listener);
    if (reader.listeners.size === 0) {
      reader.stop();
      readers.delete(key);
    }
  };
}

export function refreshCameraReadUrl(address: string) {
  const reader = readers.get(cameraReadKey(address));
  if (reader) reader.address = address;
}

export function retryCameraRead(address: string) {
  readers.get(cameraReadKey(address))?.retryRead();
}
