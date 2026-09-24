import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { CamerasService } from '../src/cameras/cameras.service';
import { CamerasRepository } from '../src/cameras/cameras.repository';
import { STORAGE_SERVICE } from '../src/storage/storage.interface';
import { CameraSourcesService } from '../src/camera-sources/camera-sources.service';
import { FrigateSyncService } from '../src/frigate/frigate-sync.service';
import type { CameraAggregateRecord } from '../src/cameras/cameras.types';

describe('CamerasService & CameraConfigPortV1 (Slice CAM)', () => {
  let service: CamerasService;
  let repository: jest.Mocked<CamerasRepository>;
  let storageService: { getPresignedUrl: jest.Mock };
  let mockFrigateSyncService: { syncCamera: jest.Mock; waitForCameraFrames: jest.Mock };

  const mockCamera: CameraAggregateRecord = {
    id: 'c1111111-1111-1111-1111-111111111111',
    device_id: 'd1111111-1111-1111-1111-111111111111',
    name: 'Camera Cổng Chính',
    slug: 'camera_cong_chinh',
    rtsp_url: 'rtsp://admin:secret123@192.168.1.100:554/stream1',
    detect_width: 1280,
    detect_height: 720,
    fps: 5,
    timezone: 'Asia/Ho_Chi_Minh',
    is_enabled: true,
    detection_enabled: true,
    retention_days: 7,
    created_at: new Date('2026-03-01T00:00:00Z'),
    updated_at: new Date('2026-03-01T00:00:00Z'),
    source_id: 's1111111-1111-1111-1111-111111111111',
    source_type_val: 'RTSP',
    source_rtsp_url: 'rtsp://admin:secret123@192.168.1.100:554/stream1',
    source_video_key: null,
    source_video_name: null,
    source_video_loop: null,
    source_transport: 'TCP',
    source_status: 'ONLINE',
    source_error_code: null,
    source_error_msg: null,
    config_version: 1,
    applied_version: 1,
    sync_status: 'SYNCED',
    sync_error_code: null,
    sync_error_message: null,
    zone_count: 2,
  };

  beforeEach(async () => {
    const mockRepo = {
      findAll: jest.fn(),
      findById: jest.fn(),
      findBySlug: jest.fn(),
      updateState: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findSourceByCameraId: jest.fn(),
      upsertSource: jest.fn(),
      findFrigateSettingsByCameraId: jest.fn(),
      updateFrigateSettings: jest.fn(),
      bumpFrigateConfigVersion: jest.fn().mockResolvedValue(2),
      findLatestSnapshotKey: jest.fn(),
      findZonesByCameraId: jest.fn(),
    };

    storageService = {
      getPresignedUrl: jest.fn(),
    };

    const mockCameraSourcesService = {
      startCameraSource: jest.fn(),
      stopCameraSource: jest.fn(),
      createBrowserSession: jest.fn().mockReturnValue({
        publishUrl: `http://localhost:8889/${mockCamera.slug}/whip`,
        streamKey: mockCamera.slug,
        token: 'tok-uuid-12345',
        expiresAt: '2026-03-01T01:00:00.000Z',
      }),
      revokeBrowserSession: jest.fn(),
      markCameraOnline: jest.fn(),
    };

    mockFrigateSyncService = {
      waitForCameraFrames: jest.fn().mockResolvedValue(false),
      syncCamera: jest.fn().mockImplementation(async (cameraId: string, version?: number) => ({
        success: true,
        cameraId,
        configVersion: version ?? 2,
        syncStatus: 'SYNCED',
      })),
    };

    const mockConfigService = {
      get: jest.fn((key: string, defaultVal: unknown) => {
        if (key === 'MEDIAMTX_WEBRTC_URL') return 'http://localhost:8889';
        if (key === 'CAMERA_VIDEO_STORAGE_PATH') return './storage/videos';
        if (key === 'CAMERA_VIDEO_MAX_BYTES') return 524288000;
        return defaultVal;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CamerasService,
        { provide: CamerasRepository, useValue: mockRepo },
        { provide: STORAGE_SERVICE, useValue: storageService },
        { provide: CameraSourcesService, useValue: mockCameraSourcesService },
        { provide: FrigateSyncService, useValue: mockFrigateSyncService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<CamerasService>(CamerasService);
    repository = module.get(CamerasRepository);
  });

  describe('CameraConfigPortV1: getCameraContext', () => {
    it('tra ve CameraContextV1 hop le khi camera ton tai', async () => {
      repository.findById.mockResolvedValueOnce(mockCamera);

      const context = await service.getCameraContext(mockCamera.id);

      expect(context).toEqual({
        schemaVersion: 1,
        cameraId: mockCamera.id,
        deviceId: mockCamera.device_id,
        slug: mockCamera.slug,
        name: mockCamera.name,
        timezone: mockCamera.timezone,
        detectWidth: 1280,
        detectHeight: 720,
        fps: 5,
        isEnabled: true,
        detectionEnabled: true,
        sourceType: 'RTSP',
        runtimeStatus: 'ONLINE',
        configVersion: 1,
      });
    });

    it('nem NotFoundException neu khong tim thay camera', async () => {
      repository.findById.mockResolvedValueOnce(null);

      await expect(service.getCameraContext('invalid-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('CameraConfigPortV1: getPreview', () => {
    it('tra ve presigned URL tu storage khi co snapshot trong event_media', async () => {
      repository.findById.mockResolvedValueOnce(mockCamera);
      repository.findLatestSnapshotKey.mockResolvedValueOnce('snapshots/camera-1.jpg');
      storageService.getPresignedUrl.mockResolvedValueOnce({
        url: 'https://s3.amazonaws.com/camerai-media/snapshots/camera-1.jpg?token=abc',
        expiresAt: new Date(),
      });

      const preview = await service.getPreview(mockCamera.id);

      expect(preview.url).toContain('https://s3.amazonaws.com');
      expect(preview.cameraId).toBe(mockCamera.id);
      expect(storageService.getPresignedUrl).toHaveBeenCalledWith('snapshots/camera-1.jpg', 900);
    });

    it('fallback ve dia chi placeholder Frigate khi chua co snapshot', async () => {
      repository.findById.mockResolvedValueOnce(mockCamera);
      repository.findLatestSnapshotKey.mockResolvedValueOnce(null);

      const preview = await service.getPreview(mockCamera.id);

      expect(preview.url).toBe(`http://localhost:5000/api/${mockCamera.slug}/latest.jpg`);
    });
  });

  describe('CameraConfigPortV1: applyConfiguration', () => {
    it('ap dung thanh cong va tra ve APPLIED khi version hop le', async () => {
      repository.findById.mockResolvedValueOnce(mockCamera);
      repository.findFrigateSettingsByCameraId.mockResolvedValueOnce({
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
        config_version: 1,
        applied_version: 1,
        sync_status: 'SYNCED',
        sync_error_code: null,
        sync_error_message: null,
        updated_at: new Date(),
      });
      repository.updateFrigateSettings.mockResolvedValueOnce({
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

      const result = await service.applyConfiguration({
        schemaVersion: 1,
        commandId: 'cmd-1',
        cameraId: mockCamera.id,
        expectedConfigVersion: 2,
        reason: 'CAMERA_CHANGED',
        requestedAt: new Date().toISOString(),
      });

      expect(result.status).toBe('APPLIED');
      expect(result.configVersion).toBe(2);
    });

    it('tra ve FAILED voi CONFIG_VERSION_CONFLICT neu expectedConfigVersion < currentVersion', async () => {
      repository.findById.mockResolvedValueOnce(mockCamera);
      repository.findFrigateSettingsByCameraId.mockResolvedValueOnce({
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
        config_version: 5,
        applied_version: 5,
        sync_status: 'SYNCED',
        sync_error_code: null,
        sync_error_message: null,
        updated_at: new Date(),
      });

      const result = await service.applyConfiguration({
        schemaVersion: 1,
        commandId: 'cmd-conflict',
        cameraId: mockCamera.id,
        expectedConfigVersion: 3,
        reason: 'ZONE_CHANGED',
        requestedAt: new Date().toISOString(),
      });

      expect(result.status).toBe('FAILED');
      expect(result.errorCode).toBe('CONFIG_VERSION_CONFLICT');
    });
  });

  describe('listCameras & Masking RTSP', () => {
    it('che giau mat khau RTSP cho role ADMIN', async () => {
      repository.findAll.mockResolvedValueOnce([mockCamera]);

      const res = await service.listCameras({}, 'ADMIN');
      // ADMIN van duoc mask password rtsp://admin:***@host:port/path (NFR-09)
      expect(res.data[0].rtspUrl).toBe('rtsp://admin:***@192.168.1.100:554/stream1');
    });

    it('an hoan toan RTSP url (null) cho role VIEWER', async () => {
      repository.findAll.mockResolvedValueOnce([mockCamera]);

      const res = await service.listCameras({}, 'VIEWER');
      expect(res.data[0].rtspUrl).toBeNull();
      expect(res.data[0].source.displayName).not.toContain('admin:');
      expect(res.data[0].source.displayName).not.toContain('192.168.1.100');
    });
  });

  describe('updateCameraState', () => {
    it('chan quyen neu role khong phai ADMIN', async () => {
      await expect(service.updateCameraState(mockCamera.id, false, 'CAREGIVER')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('cho phep ADMIN bat/tat camera thanh cong', async () => {
      repository.findById.mockResolvedValueOnce(mockCamera).mockResolvedValueOnce({
        ...mockCamera,
        is_enabled: false,
        source_status: 'STOPPED',
      });
      repository.updateState.mockResolvedValueOnce({
        ...mockCamera,
        is_enabled: false,
        source_status: 'STOPPED',
      });

      const res = await service.updateCameraState(mockCamera.id, false, 'ADMIN');
      expect(res.isEnabled).toBe(false);
      expect(res.runtimeStatus).toBe('DISABLED');
      expect(repository.updateState).toHaveBeenCalledWith(mockCamera.id, false);
    });

    it('chan chuyen trang thai neu dang transitioning', async () => {
      repository.findById.mockResolvedValue(mockCamera);
      repository.updateState.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(mockCamera), 50)),
      );

      const p1 = service.updateCameraState(mockCamera.id, false, 'ADMIN');
      await expect(service.updateCameraState(mockCamera.id, false, 'ADMIN')).rejects.toMatchObject({
        response: { error: { code: 'CAMERA_ALREADY_TRANSITIONING' } },
      });
      await p1;
    });
  });

  describe('Browser Session & Frigate Retry & Debug Stream', () => {
    it('createBrowserPublishSession tra ve WHIP endpoint kem token cho ADMIN', async () => {
      repository.findById.mockResolvedValueOnce(mockCamera);

      const session = await service.createBrowserPublishSession(mockCamera.id, 'ADMIN');
      expect(session.publishUrl).toBe(`http://localhost:8889/${mockCamera.slug}/whip`);
      expect(session.streamKey).toBe(mockCamera.slug);
      expect(session.token).toBe('tok-uuid-12345');
    });

    it('revokeBrowserPublishSession thu hoi session thanh cong', async () => {
      repository.findById.mockResolvedValueOnce(mockCamera);
      await service.revokeBrowserPublishSession(mockCamera.id, 'ADMIN');
      expect(repository.upsertSource).toHaveBeenCalledWith(mockCamera.id, { status: 'OFFLINE' });
    });

    it('getCameraRuntimeStatus tra ve trang thai runtime dung chuẩn', async () => {
      repository.findById.mockResolvedValueOnce(mockCamera);

      const status = await service.getCameraRuntimeStatus(mockCamera.id);
      expect(status.cameraId).toBe(mockCamera.id);
      expect(status.runtimeStatus).toBe('ONLINE');
      expect(status.isPublishing).toBe(true);
    });

    it('getCameraDebugStream tra ve thong tin debug stream', async () => {
      repository.findById.mockResolvedValueOnce(mockCamera);
      repository.findZonesByCameraId.mockResolvedValueOnce([
        {
          id: 'z1',
          cameraId: mockCamera.id,
          name: 'Vùng 1',
          slug: 'vung_1',
          zoneType: 'SAFE',
          polygon: [
            [0, 0],
            [1, 1],
          ],
          isEnabled: true,
        },
      ]);
      storageService.getPresignedUrl.mockResolvedValueOnce({
        url: 'http://minio/snapshot.jpg',
        expiresAt: new Date(),
      });

      const debug = await service.getCameraDebugStream(mockCamera.id);
      expect(debug.cameraId).toBe(mockCamera.id);
      expect(debug.streamUrl).toBe(`http://localhost:8889/${mockCamera.slug}`);
      expect(debug.activeZones).toEqual([]);
    });

    it('retryFrigateSync goi frigateSyncService cho ADMIN', async () => {
      repository.findById.mockResolvedValueOnce(mockCamera);
      mockFrigateSyncService.syncCamera.mockResolvedValueOnce({
        success: true,
        cameraId: mockCamera.id,
        configVersion: 3,
        syncStatus: 'SYNCED',
      });

      const res = await service.retryFrigateSync(mockCamera.id, 'ADMIN');
      expect(res.syncStatus).toBe('SYNCED');
      expect(res.configVersion).toBe(3);
    });

    it('getCameraZones tra ve danh sach polygon zones cua camera', async () => {
      repository.findById.mockResolvedValueOnce(mockCamera);
      const mockZones = [
        {
          id: 'z1',
          cameraId: mockCamera.id,
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
      repository.findZonesByCameraId.mockResolvedValueOnce(mockZones);

      const res = await service.getCameraZones(mockCamera.id);
      expect(res).toEqual(mockZones);
      expect(repository.findZonesByCameraId).toHaveBeenCalledWith(mockCamera.id);
    });
  });
});
