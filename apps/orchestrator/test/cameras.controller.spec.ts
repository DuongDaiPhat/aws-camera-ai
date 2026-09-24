import { Test, TestingModule } from '@nestjs/testing';
import { CamerasController } from '../src/cameras/cameras.controller';
import { CamerasService } from '../src/cameras/cameras.service';
import type { AuthenticatedRequest } from '../src/auth/jwt-auth.guard';
import type { CameraDto } from '../src/cameras/cameras.types';

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
    configVersion: 1,
    syncStatus: 'APPLIED',
    zoneCount: 0,
    createdAt: '2026-03-01T00:00:00.000Z',
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
      createBrowserPublishSession: jest.fn(),
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
      expiresAt: '2026-03-01T01:00:00.000Z',
    };
    service.createBrowserPublishSession.mockResolvedValueOnce(mockSession);

    const result = await controller.createBrowserPublishSession(mockCameraDto.id, adminReq);

    expect(service.createBrowserPublishSession).toHaveBeenCalledWith(mockCameraDto.id, 'ADMIN');
    expect(result.publishUrl).toContain('/whip');
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
        polygon: [[0.1, 0.1], [0.9, 0.9]],
        isEnabled: true,
      },
    ];
    service.getCameraZones.mockResolvedValueOnce(mockZones);

    const result = await controller.getCameraZones(mockCameraDto.id);
    expect(service.getCameraZones).toHaveBeenCalledWith(mockCameraDto.id);
    expect(result.data).toEqual(mockZones);
  });
});
