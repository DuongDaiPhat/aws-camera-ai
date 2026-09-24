import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { FrigateSyncService } from '../src/frigate/frigate-sync.service';
import { FrigateClientService } from '../src/frigate/frigate-client.service';
import { FrigateConfigService } from '../src/frigate/frigate-config.service';
import { CamerasRepository } from '../src/cameras/cameras.repository';
import type { CameraAggregateRecord } from '../src/cameras/cameras.types';

describe('FrigateSyncService', () => {
  let service: FrigateSyncService;
  let camerasRepository: jest.Mocked<CamerasRepository>;
  let frigateClient: jest.Mocked<FrigateClientService>;
  let frigateConfig: jest.Mocked<FrigateConfigService>;

  const mockCamera: CameraAggregateRecord = {
    id: 'c1111111-1111-1111-1111-111111111111',
    device_id: 'd1111111-1111-1111-1111-111111111111',
    name: 'Camera Cổng Chính',
    slug: 'camera_cong_chinh',
    rtsp_url: 'rtsp://admin:secret@192.168.1.100:554/stream1',
    detect_width: 1280,
    detect_height: 720,
    fps: 5,
    timezone: 'Asia/Ho_Chi_Minh',
    is_enabled: true,
    detection_enabled: true,
    retention_days: 7,
    created_at: new Date(),
    updated_at: new Date(),
    source_id: 's111',
    source_type_val: 'RTSP',
    source_rtsp_url: 'rtsp://admin:secret@192.168.1.100:554/stream1',
    source_video_key: null,
    source_video_name: null,
    source_video_loop: null,
    source_transport: 'TCP',
    source_status: 'ONLINE',
    source_error_code: null,
    source_error_msg: null,
    config_version: 2,
    applied_version: 2,
    sync_status: 'SYNCED',
    sync_error_code: null,
    sync_error_message: null,
    zone_count: 0,
  };

  beforeEach(async () => {
    const mockRepo = {
      findById: jest.fn(),
      findFrigateSettingsByCameraId: jest.fn(),
      updateFrigateSettings: jest.fn(),
    };

    const mockClient = {
      getRawConfig: jest.fn(),
      saveConfig: jest.fn(),
      restart: jest.fn(),
      setCameraDetection: jest.fn(),
    };

    const mockConfig = {
      generateUpdatedConfig: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FrigateSyncService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('rtsp://localhost:8554'),
          },
        },
        { provide: CamerasRepository, useValue: mockRepo },
        { provide: FrigateClientService, useValue: mockClient },
        { provide: FrigateConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get<FrigateSyncService>(FrigateSyncService);
    camerasRepository = module.get(CamerasRepository);
    frigateClient = module.get(FrigateClientService);
    frigateConfig = module.get(FrigateConfigService);
  });

  it('dong bo thanh cong va cap nhat Database trang thai SYNCED', async () => {
    camerasRepository.findById.mockResolvedValueOnce(mockCamera);
    camerasRepository.findFrigateSettingsByCameraId.mockResolvedValue({
      camera_id: mockCamera.id,
      detect_width: 1280,
      detect_height: 720,
      detect_fps: 5,
      min_initialized_frames: 3,
      max_disappeared_frames: 10,
      person_min_score: 0.5,
      person_threshold: 0.7,
      person_min_area: 500,
      snapshots_enabled: true,
      snapshot_bounding_box: true,
      recording_enabled: false,
      detection_retention_days: 7,
      config_version: 2,
      applied_version: 1,
      sync_status: 'PENDING',
      sync_error_code: null,
      sync_error_message: null,
      updated_at: new Date(),
    });

    frigateClient.getRawConfig.mockResolvedValueOnce('mqtt: { host: mosquitto }');
    frigateConfig.generateUpdatedConfig.mockReturnValueOnce('cameras: { camera_cong_chinh: {} }');
    frigateClient.saveConfig.mockResolvedValueOnce(true);

    camerasRepository.updateFrigateSettings.mockResolvedValueOnce({
      camera_id: mockCamera.id,
      detect_width: 1280,
      detect_height: 720,
      detect_fps: 5,
      min_initialized_frames: 3,
      max_disappeared_frames: 10,
      person_min_score: 0.5,
      person_threshold: 0.7,
      person_min_area: 500,
      snapshots_enabled: true,
      snapshot_bounding_box: true,
      recording_enabled: false,
      detection_retention_days: 7,
      config_version: 2,
      applied_version: 2,
      sync_status: 'SYNCED',
      sync_error_code: null,
      sync_error_message: null,
      updated_at: new Date(),
    });

    const result = await service.syncCamera(mockCamera.id);

    expect(result.success).toBe(true);
    expect(result.syncStatus).toBe('SYNCED');
    expect(frigateClient.saveConfig).toHaveBeenCalledWith('cameras: { camera_cong_chinh: {} }');
    expect(camerasRepository.updateFrigateSettings).toHaveBeenCalledWith(
      mockCamera.id,
      expect.objectContaining({ sync_status: 'SYNCED' }),
    );
  });

  it('chan dong bo song song tren cung mot camera nho co che mutex lock', async () => {
    camerasRepository.findById.mockImplementation(async () => {
      // Mo phong do tre xu ly Frigate API
      await new Promise((resolve) => setTimeout(resolve, 50));
      return mockCamera;
    });
    camerasRepository.findFrigateSettingsByCameraId.mockResolvedValue({
      camera_id: mockCamera.id,
      detect_width: 1280,
      detect_height: 720,
      detect_fps: 5,
      min_initialized_frames: 3,
      max_disappeared_frames: 10,
      person_min_score: 0.5,
      person_threshold: 0.7,
      person_min_area: 500,
      snapshots_enabled: true,
      snapshot_bounding_box: true,
      recording_enabled: false,
      detection_retention_days: 7,
      config_version: 2,
      applied_version: 1,
      sync_status: 'PENDING',
      sync_error_code: null,
      sync_error_message: null,
      updated_at: new Date(),
    });
    frigateClient.getRawConfig.mockResolvedValue('mqtt: {}');
    frigateConfig.generateUpdatedConfig.mockReturnValue('updated: {}');
    frigateClient.saveConfig.mockResolvedValue(true);
    camerasRepository.updateFrigateSettings.mockResolvedValue({} as any);

    // Goi dong thoi 2 lan
    const promise1 = service.syncCamera(mockCamera.id);
    const promise2 = service.syncCamera(mockCamera.id);

    const [res1, res2] = await Promise.all([promise1, promise2]);

    // Mot trong 2 request phai bi chan voi CAMERA_ALREADY_TRANSITIONING
    const blockedRes = !res1.success ? res1 : res2;
    expect(blockedRes.success).toBe(false);
    expect(blockedRes.errorCode).toBe('CAMERA_ALREADY_TRANSITIONING');
  });

  it('tra ve loi khi khong tim thay camera', async () => {
    camerasRepository.findById.mockResolvedValueOnce(null);

    const res = await service.syncCamera('non-existent-id');

    expect(res.success).toBe(false);
    expect(res.errorCode).toBe('CAMERA_NOT_FOUND');
  });

  it('xu ly loi Frigate API offline va danh dau FAILED vao DB', async () => {
    camerasRepository.findById.mockResolvedValueOnce(mockCamera);
    camerasRepository.findFrigateSettingsByCameraId.mockResolvedValueOnce(null);
    frigateClient.getRawConfig.mockRejectedValueOnce(
      new Error('fetch failed: ECONNREFUSED 127.0.0.1:5000'),
    );

    const res = await service.syncCamera(mockCamera.id);

    expect(res.success).toBe(false);
    expect(res.syncStatus).toBe('FAILED');
    expect(res.errorCode).toBe('FRIGATE_SYNC_FAILED');
    expect(res.errorMessage).toContain('ECONNREFUSED');
    expect(camerasRepository.updateFrigateSettings).toHaveBeenCalledWith(
      mockCamera.id,
      expect.objectContaining({
        sync_status: 'FAILED',
        sync_error_code: 'FRIGATE_SYNC_FAILED',
      }),
    );
  });
});
