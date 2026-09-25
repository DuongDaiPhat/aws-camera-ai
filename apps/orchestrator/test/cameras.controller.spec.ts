import { Test, TestingModule } from '@nestjs/testing';
import { CamerasController } from '../src/cameras/cameras.controller';
import { CamerasService } from '../src/cameras/cameras.service';
import type { AuthenticatedRequest } from '../src/auth/jwt-auth.guard';
import type { CameraDto, CameraSourceDetail } from '../src/cameras/cameras.types';

describe('CamerasController (Slice CAM)', () => {
  let controller: CamerasController;
  let service: jest.Mocked<CamerasService>;

  const adminReq: AuthenticatedRequest = {
    auth: {
      sub: 'u1111111-1111-1111-1111-111111111111',
      email: 'admin@camerai.local',
      role: 'ADMIN',
      tokenType: 'access',
      jti: 'jti-1',
    },
  } as AuthenticatedRequest;

  const mockCameraDto: CameraDto = {
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
    zoneCount: 0,
    createdAt: '2026-03-01T00:00:00.000Z',
  };

  const mockSourceDetail: CameraSourceDetail = {
    id: 's1111111-1111-1111-1111-111111111111',
    cameraId: mockCameraDto.id,
    sourceType: 'RTSP',
    rtspUrl: 'rtsp://admin:***@192.168.1.100:554/stream1',
    videoOriginalName: null,
    videoLoop: true,
    transport: 'TCP',
    inputFormat: null,
    webcamDeviceLabel: null,
    status: 'ONLINE',
    lastErrorCode: null,
    lastErrorMessage: null,
    startedAt: '2026-03-01T00:00:00.000Z',
    stoppedAt: null,
    updatedAt: '2026-03-01T00:00:00.000Z',
  };

  beforeEach(async () => {
    const mockService = {
      listCameras: jest.fn(),
      getCamera: jest.fn(),
      updateCamera: jest.fn(),
      deleteCamera: jest.fn(),
      getPreview: jest.fn(),
      updateCameraState: jest.fn(),
      getCameraSource: jest.fn(),
      updateCameraSource: jest.fn(),
      testRtspConnection: jest.fn(),
      createBrowserPublishSession: jest.fn(),
      revokeBrowserPublishSession: jest.fn(),
      getCameraRuntimeStatus: jest.fn(),
      uploadCameraVideo: jest.fn(),
      deleteCameraVideo: jest.fn(),
      startCameraSource: jest.fn(),
      stopCameraSource: jest.fn(),
      getCameraDebugStream: jest.fn(),
      retryFrigateSync: jest.fn(),
      getCameraZones: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CamerasController],
      providers: [{ provide: CamerasService, useValue: mockService }],
    }).compile();

    controller = module.get<CamerasController>(CamerasController);
    service = module.get(CamerasService);
  });

  it('listCameras goi service.listCameras voi dung query va role', async () => {
    service.listCameras.mockResolvedValueOnce({ data: [mockCameraDto] });

    const result = await controller.listCameras({}, adminReq);

    expect(service.listCameras).toHaveBeenCalledWith({}, 'ADMIN');
    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe(mockCameraDto.id);
  });

  it('getCamera goi service.getCamera voi id va role', async () => {
    service.getCamera.mockResolvedValueOnce(mockCameraDto);

    const result = await controller.getCamera(mockCameraDto.id, adminReq);

    expect(service.getCamera).toHaveBeenCalledWith(mockCameraDto.id, 'ADMIN');
    expect(result.name).toBe(mockCameraDto.name);
  });

  it('updateCameraState goi service.updateCameraState voi isEnabled va role', async () => {
    service.updateCameraState.mockResolvedValueOnce({ ...mockCameraDto, isEnabled: false });

    const result = await controller.updateCameraState(
      mockCameraDto.id,
      { isEnabled: false },
      adminReq,
    );

    expect(service.updateCameraState).toHaveBeenCalledWith(mockCameraDto.id, false, 'ADMIN');
    expect(result.isEnabled).toBe(false);
  });

  it('createBrowserPublishSession goi service tao phien WHIP', async () => {
    const mockSession = {
      publishUrl: 'http://localhost:8889/camera_cong_chinh/whip',
      streamKey: 'camera_cong_chinh',
      token: 'test-token-uuid-12345',
      expiresAt: '2026-03-01T01:00:00.000Z',
    };
    service.createBrowserPublishSession.mockResolvedValueOnce(mockSession);

    const result = await controller.createBrowserPublishSession(mockCameraDto.id, adminReq);

    expect(service.createBrowserPublishSession).toHaveBeenCalledWith(mockCameraDto.id, 'ADMIN');
    expect(result.publishUrl).toContain('/whip');
    expect(result.token).toBe('test-token-uuid-12345');
  });

  it('testRtspConnection goi service voi URL va transport', async () => {
    service.testRtspConnection.mockResolvedValueOnce({
      success: true,
      message: 'Kết nối RTSP thành công.',
      latencyMs: 90,
    });

    const result = await controller.testRtspConnection(
      mockCameraDto.id,
      { rtspUrl: 'rtsp://camera.local/live', transport: 'TCP' },
      adminReq,
    );

    expect(service.testRtspConnection).toHaveBeenCalledWith(
      mockCameraDto.id,
      { rtspUrl: 'rtsp://camera.local/live', transport: 'TCP' },
      'ADMIN',
    );
    expect(result.success).toBe(true);
  });

  it('revokeBrowserPublishSession goi service thu hoi session', async () => {
    service.revokeBrowserPublishSession.mockResolvedValueOnce(undefined);

    await controller.revokeBrowserPublishSession(mockCameraDto.id, adminReq);
    expect(service.revokeBrowserPublishSession).toHaveBeenCalledWith(mockCameraDto.id, 'ADMIN');
  });

  it('getCameraRuntimeStatus goi service va tra ve trang thai thuc te', async () => {
    const mockRuntime = {
      cameraId: mockCameraDto.id,
      runtimeStatus: 'ONLINE' as const,
      isPublishing: true,
      frigateSyncStatus: 'SYNCED' as const,
      lastCheckedAt: new Date().toISOString(),
      details: { sourceType: 'RTSP' as const, errorCode: null, errorMessage: null },
    };
    service.getCameraRuntimeStatus.mockResolvedValueOnce(mockRuntime);

    const result = await controller.getCameraRuntimeStatus(mockCameraDto.id);
    expect(service.getCameraRuntimeStatus).toHaveBeenCalledWith(mockCameraDto.id);
    expect(result.runtimeStatus).toBe('ONLINE');
  });

  it('uploadCameraVideo goi service upload video nguon', async () => {
    const mockFile = {
      originalname: 'test.mp4',
      buffer: Buffer.from('fake-video'),
      size: 10,
    };
    service.uploadCameraVideo.mockResolvedValueOnce(mockSourceDetail);

    const result = await controller.uploadCameraVideo(mockCameraDto.id, mockFile, true, adminReq);
    expect(service.uploadCameraVideo).toHaveBeenCalledWith(
      mockCameraDto.id,
      mockFile,
      true,
      'ADMIN',
    );
    expect(result.sourceType).toBe('RTSP');
  });

  it('deleteCameraVideo goi service xoa video nguon', async () => {
    service.deleteCameraVideo.mockResolvedValueOnce(undefined);

    await controller.deleteCameraVideo(mockCameraDto.id, adminReq);
    expect(service.deleteCameraVideo).toHaveBeenCalledWith(mockCameraDto.id, 'ADMIN');
  });

  it('startCameraSource va stopCameraSource dieu khien nguon phat', async () => {
    service.startCameraSource.mockResolvedValueOnce(mockSourceDetail);
    service.stopCameraSource.mockResolvedValueOnce(mockSourceDetail);

    await controller.startCameraSource(mockCameraDto.id, adminReq);
    expect(service.startCameraSource).toHaveBeenCalledWith(mockCameraDto.id, 'ADMIN');

    await controller.stopCameraSource(mockCameraDto.id, adminReq);
    expect(service.stopCameraSource).toHaveBeenCalledWith(mockCameraDto.id, 'ADMIN');
  });

  it('getCameraDebugStream goi service lay luong debug va detection', async () => {
    const mockDebugStream = {
      cameraId: mockCameraDto.id,
      streamUrl: 'http://localhost:8889/camera_cong_chinh',
      snapshotUrl: null,
      detections: [],
      activeZones: ['Khu vực bếp'],
    };
    service.getCameraDebugStream.mockResolvedValueOnce(mockDebugStream);

    const result = await controller.getCameraDebugStream(mockCameraDto.id);
    expect(service.getCameraDebugStream).toHaveBeenCalledWith(mockCameraDto.id);
    expect(result.streamUrl).toContain('/camera_cong_chinh');
  });

  it('retryFrigateSync goi service retry sync', async () => {
    const mockSyncRes = {
      cameraId: mockCameraDto.id,
      configVersion: 2,
      syncStatus: 'SYNCED' as const,
    };
    service.retryFrigateSync.mockResolvedValueOnce(mockSyncRes);

    const result = await controller.retryFrigateSync(mockCameraDto.id, adminReq);

    expect(service.retryFrigateSync).toHaveBeenCalledWith(mockCameraDto.id, 'ADMIN');
    expect(result.syncStatus).toBe('SYNCED');
  });

  it('getCameraZones tra ve danh sach polygon zones cua camera', async () => {
    const mockZones = [
      {
        id: 'z1',
        cameraId: mockCameraDto.id,
        name: 'Khu vực bếp',
        slug: 'zone_bep',
        zoneType: 'RESTRICTED',
        polygon: [
          [0.1, 0.1],
          [0.9, 0.9],
        ],
        isEnabled: true,
      },
    ];
    service.getCameraZones.mockResolvedValueOnce(mockZones);

    const result = await controller.getCameraZones(mockCameraDto.id);
    expect(service.getCameraZones).toHaveBeenCalledWith(mockCameraDto.id);
    expect(result.data).toEqual(mockZones);
  });
});
