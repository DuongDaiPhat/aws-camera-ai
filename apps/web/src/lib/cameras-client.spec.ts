import { afterEach, describe, expect, it, vi } from 'vitest';
import { setAccessToken } from './api-client';
import {
  createBrowserPublishSession,
  deleteCameraVideo,
  deleteCamera,
  fetchCamera,
  fetchCameras,
  fetchCameraSnapshot,
  fetchCameraSource,
  retryFrigateSync,
  testRtspConnection,
  uploadCameraVideo,
  updateCamera,
  updateCameraSource,
  updateCameraState,
} from './cameras-client';
import type { Camera, CameraSourceDetail } from '@/types';

afterEach(() => {
  setAccessToken(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const mockCamera: Camera = {
  id: 'c1111111-1111-1111-1111-111111111111',
  deviceId: 'd1111111-1111-1111-1111-111111111111',
  name: 'Camera Cổng Chính',
  slug: 'camera_cong_chinh',
  rtspUrl: 'rtsp://admin:***@192.168.1.100:554/stream1',
  detectWidth: 1280,
  detectHeight: 720,
  fps: 5,
  timezone: 'Asia/Ho_Chi_Minh',
  isEnabled: true,
  detectionEnabled: true,
  retentionDays: 7,
  sourceType: 'RTSP',
  runtimeStatus: 'ONLINE',
  source: {
    type: 'RTSP',
    displayName: 'rtsp://admin:***@192.168.1.100:554/stream1',
    isPublishing: true,
    lastError: null,
    requiresBrowserPublisher: false,
  },
  frigateSync: {
    status: 'SYNCED',
    configVersion: 1,
    appliedVersion: 1,
    errorCode: null,
    errorMessage: null,
  },
  frigateSettings: {
    detectWidth: 1280,
    detectHeight: 720,
    detectFps: 5,
    minInitializedFrames: 5,
    maxDisappearedFrames: 25,
    personMinScore: 0.5,
    personThreshold: 0.7,
    personMinArea: 1500,
    snapshotsEnabled: true,
    snapshotBoundingBox: true,
    recordingEnabled: true,
    detectionRetentionDays: 7,
  },
  debugCapabilities: {
    personBoundary: true,
    zoneBoundary: true,
  },
  configVersion: 1,
  syncStatus: 'SYNCED',
  zoneCount: 2,
  createdAt: '2026-03-01T00:00:00.000Z',
};

describe('cameras-client (Slice CAM)', () => {
  describe('fetchCameras', () => {
    it('goi dung API /cameras va tra ve danh sach camera', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [mockCamera] }));
      vi.stubGlobal('fetch', fetchMock);

      const cameras = await fetchCameras();

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/cameras'),
        expect.any(Object),
      );
      expect(cameras).toHaveLength(1);
      expect(cameras[0].id).toBe(mockCamera.id);
    });

    it('them query params deviceId va isEnabled vao URL', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [] }));
      vi.stubGlobal('fetch', fetchMock);

      await fetchCameras({ deviceId: 'dev-1', isEnabled: true });

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('deviceId=dev-1&isEnabled=true'),
        expect.any(Object),
      );
    });
  });

  describe('fetchCamera', () => {
    it('goi dung URL /cameras/:id', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(mockCamera));
      vi.stubGlobal('fetch', fetchMock);

      const camera = await fetchCamera(mockCamera.id);

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining(`/cameras/${mockCamera.id}`),
        expect.any(Object),
      );
      expect(camera.name).toBe(mockCamera.name);
    });
  });

  describe('updateCameraState', () => {
    it('gui PUT /cameras/:id/state voi payload { isEnabled }', async () => {
      const updated = { ...mockCamera, isEnabled: false };
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(updated));
      vi.stubGlobal('fetch', fetchMock);

      const res = await updateCameraState(mockCamera.id, false);

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining(`/cameras/${mockCamera.id}/state`),
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ isEnabled: false }),
        }),
      );
      expect(res.isEnabled).toBe(false);
    });
  });

  describe('updateCamera & deleteCamera', () => {
    it('updateCamera gui PATCH /cameras/:id voi body data', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(mockCamera));
      vi.stubGlobal('fetch', fetchMock);

      await updateCamera(mockCamera.id, { name: 'Ten moi' });

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining(`/cameras/${mockCamera.id}`),
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ name: 'Ten moi' }),
        }),
      );
    });

    it('deleteCamera gui DELETE /cameras/:id', async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
      vi.stubGlobal('fetch', fetchMock);

      await deleteCamera(mockCamera.id);

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining(`/cameras/${mockCamera.id}`),
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });

  describe('Source & Frigate Sync', () => {
    it('fetchCameraSnapshot goi GET /cameras/:id/snapshot', async () => {
      const mockSnapshot = {
        url: 'http://localhost/snap.jpg',
        expiresAt: '2026-03-01T01:00:00.000Z',
        cameraId: mockCamera.id,
        width: 1280,
        height: 720,
        capturedAt: '2026-03-01T00:00:00.000Z',
      };
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(mockSnapshot));
      vi.stubGlobal('fetch', fetchMock);

      const res = await fetchCameraSnapshot(mockCamera.id);
      expect(res.url).toBe(mockSnapshot.url);
    });

    it('fetchCameraSource goi GET /cameras/:id/source', async () => {
      const mockSource: CameraSourceDetail = {
        id: 's1',
        cameraId: mockCamera.id,
        sourceType: 'RTSP',
        rtspUrl: 'rtsp://192.168.1.100',
        videoOriginalName: null,
        videoLoop: true,
        transport: 'TCP',
        inputFormat: null,
        webcamDeviceLabel: null,
        status: 'ONLINE',
        lastErrorCode: null,
        lastErrorMessage: null,
        startedAt: null,
        stoppedAt: null,
        updatedAt: '2026-03-01T00:00:00.000Z',
      };
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(mockSource));
      vi.stubGlobal('fetch', fetchMock);

      const res = await fetchCameraSource(mockCamera.id);
      expect(res.sourceType).toBe('RTSP');
    });

    it('updateCameraSource goi PUT /cameras/:id/source voi payload', async () => {
      const mockSource: CameraSourceDetail = {
        id: 's1',
        cameraId: mockCamera.id,
        sourceType: 'BROWSER_WEBCAM',
        rtspUrl: null,
        videoOriginalName: null,
        videoLoop: true,
        transport: 'TCP',
        inputFormat: null,
        webcamDeviceLabel: 'HD Webcam',
        status: 'NOT_CONFIGURED',
        lastErrorCode: null,
        lastErrorMessage: null,
        startedAt: null,
        stoppedAt: null,
        updatedAt: '2026-03-01T00:00:00.000Z',
      };
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(mockSource));
      vi.stubGlobal('fetch', fetchMock);

      const res = await updateCameraSource(mockCamera.id, {
        sourceType: 'BROWSER_WEBCAM',
        videoLoop: true,
        transport: 'TCP',
      });
      expect(res.sourceType).toBe('BROWSER_WEBCAM');
    });

    it('createBrowserPublishSession goi POST /cameras/:id/source/browser-session', async () => {
      const mockSession = {
        publishUrl: 'http://localhost:8889/cam/whip',
        streamKey: 'cam',
        expiresAt: '2026-03-01T01:00:00.000Z',
      };
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(mockSession));
      vi.stubGlobal('fetch', fetchMock);

      const res = await createBrowserPublishSession(mockCamera.id);
      expect(res.publishUrl).toContain('/whip');
    });

    it('retryFrigateSync goi POST /cameras/:id/frigate-sync/retry', async () => {
      const mockRetry = {
        cameraId: mockCamera.id,
        configVersion: 2,
        syncStatus: 'SYNCED' as const,
      };
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(mockRetry));
      vi.stubGlobal('fetch', fetchMock);

      const res = await retryFrigateSync(mockCamera.id);
      expect(res.syncStatus).toBe('SYNCED');
    });

    it('testRtspConnection gui URL va transport toi API kiem tra ket noi', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ success: true, message: 'Kết nối RTSP thành công.', latencyMs: 120 }),
        );
      vi.stubGlobal('fetch', fetchMock);

      const result = await testRtspConnection(mockCamera.id, {
        rtspUrl: 'rtsp://camera.local/live',
        transport: 'TCP',
      });

      expect(result.success).toBe(true);
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining(`/cameras/${mockCamera.id}/source/test`),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ rtspUrl: 'rtsp://camera.local/live', transport: 'TCP' }),
        }),
      );
    });

    it('uploadCameraVideo gui file, loop va tien do bang multipart', async () => {
      const progressValues: number[] = [];

      class MockXMLHttpRequest {
        status = 200;
        responseText = JSON.stringify({ sourceType: 'VIDEO_FILE' });
        statusText = 'OK';
        withCredentials = false;
        upload = { onprogress: null as ((event: ProgressEvent) => void) | null };
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        open(_method: string, _url: string): void {}
        setRequestHeader(_name: string, _value: string): void {}
        send(body: FormData): void {
          expect(body.get('file')).toBeInstanceOf(Blob);
          expect(body.get('loop')).toBe('false');
          this.upload.onprogress?.({
            lengthComputable: true,
            loaded: 75,
            total: 100,
          } as ProgressEvent);
          this.onload?.();
        }
      }

      vi.stubGlobal('XMLHttpRequest', MockXMLHttpRequest);
      const file = new File(['video'], 'sample.mp4', { type: 'video/mp4' });

      const result = await uploadCameraVideo(mockCamera.id, file, false, (progress) =>
        progressValues.push(progress),
      );

      expect(result.sourceType).toBe('VIDEO_FILE');
      expect(progressValues).toEqual([75]);
    });

    it('deleteCameraVideo gui DELETE toi endpoint video', async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
      vi.stubGlobal('fetch', fetchMock);

      await deleteCameraVideo(mockCamera.id);

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining(`/cameras/${mockCamera.id}/source/video`),
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });
});
