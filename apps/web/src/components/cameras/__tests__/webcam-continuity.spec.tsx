// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { it, expect, vi } from 'vitest';
import { publishWebcam } from '../source/webcam-publish';
import {
  getWebcamSession,
  startWebcamPublish,
  stopAllWebcamSessions,
  useWebcamSession,
} from '../source/webcam-session-manager';
import { revokeBrowserPublishSession } from '@/lib/cameras-client';
vi.mock('../source/webcam-publish', () => ({ publishWebcam: vi.fn() }));
vi.mock('@/lib/cameras-client', () => ({ revokeBrowserPublishSession: vi.fn(async () => {}) }));
function Consumer() {
  const session = useWebcamSession('owner');
  return <span>{session.isPublishing ? 'publishing' : 'stopped'}</span>;
}
it('keeps one publisher across view unmounts, repeat starts and module refresh; only explicit stop closes capture', async () => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    value: true,
    configurable: true,
  });
  const track = { stop: vi.fn() },
    stream = { active: true, getTracks: () => [track] } as unknown as MediaStream;
  const pc = {
    connectionState: 'connected',
    close: vi.fn(),
    addEventListener: vi.fn(),
  } as unknown as RTCPeerConnection;
  vi.mocked(publishWebcam).mockResolvedValue(pc);
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: vi.fn(async () => stream) },
    configurable: true,
  });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<Consumer />));
    await act(async () => startWebcamPublish('owner'));
    await act(async () => root.render(<span>Dashboard</span>));
    await startWebcamPublish('owner');
    expect(publishWebcam).toHaveBeenCalledTimes(1);
    expect(track.stop).not.toHaveBeenCalled();
    expect(pc.close).not.toHaveBeenCalled();
    await act(async () => root.render(<Consumer />));
    expect(host.textContent).toBe('publishing');
    vi.resetModules();
    const refreshed = await import('../source/webcam-session-manager');
    expect(refreshed.getWebcamSession('owner').pc).toBe(pc);
    await refreshed.startWebcamPublish('owner');
    expect(publishWebcam).toHaveBeenCalledTimes(1);
    getWebcamSession('viewer-only');
    await act(async () => root.render(null));
    stopAllWebcamSessions();
    expect(pc.close).toHaveBeenCalledOnce();
    expect(track.stop).toHaveBeenCalledOnce();
    expect(revokeBrowserPublishSession).toHaveBeenCalledWith('owner');
    expect(revokeBrowserPublishSession).not.toHaveBeenCalledWith('viewer-only');
  } finally {
    await act(async () => root.unmount());
    host.remove();
    stopAllWebcamSessions();
    vi.restoreAllMocks();
  }
});
