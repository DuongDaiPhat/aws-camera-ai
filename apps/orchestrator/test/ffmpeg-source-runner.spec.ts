import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { FfmpegSourceRunnerService } from '../src/camera-sources/ffmpeg-source-runner.service';
import { MediaMtxService } from '../src/camera-sources/media-mtx.service';
import child_process from 'child_process';
import fs from 'fs';
import { EventEmitter } from 'events';

jest.mock('child_process');
jest.mock('fs');

describe('FfmpegSourceRunnerService (Slice CAM)', () => {
  let service: FfmpegSourceRunnerService;

  const mockCameraId = 'c1111111-1111-1111-1111-111111111111';
  const mockSlug = 'cam_living_room';

  beforeEach(async () => {
    jest.clearAllMocks();

    const mockConfigService = {
      get: jest.fn((key: string, defaultVal: unknown) => {
        if (key === 'CAMERA_SOURCE_START_TIMEOUT_MS') return 5000;
        if (key === 'CAMERA_SOURCE_STOP_TIMEOUT_MS') return 1000;
        if (key === 'CAMERA_SOURCE_MAX_RETRIES') return 2;
        if (key === 'CAMERA_SOURCE_RETRY_DELAY_MS') return 100;
        if (key === 'CAMERA_VIDEO_STORAGE_PATH') return './storage/videos';
        return defaultVal;
      }),
    };

    const mockMediaMtx = {
      getPublishRtspUrl: jest.fn(
        (slug: string) => `rtsp://localhost:8554/${slug}`,
      ),
      createBrowserSession: jest.fn(),
    };

    // Mock fs
    (fs.existsSync as jest.Mock).mockReturnValue(true);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FfmpegSourceRunnerService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: MediaMtxService, useValue: mockMediaMtx },
      ],
    }).compile();

    service = module.get<FfmpegSourceRunnerService>(FfmpegSourceRunnerService);
  });

  describe('Validation an toàn', () => {
    it('tu choi neu slug khong hop le', async () => {
      const result = await service.start({
        cameraId: mockCameraId,
        slug: 'INVALID SLUG!',
        videoPath: 'demo.mp4',
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('INVALID_SLUG');
    });

    it('tu choi neu thieu duong dan video', async () => {
      const result = await service.start({
        cameraId: mockCameraId,
        slug: mockSlug,
        videoPath: undefined,
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('SOURCE_NOT_CONFIGURED');
    });

    it('tu choi neu file video khong ton tai', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      const result = await service.start({
        cameraId: mockCameraId,
        slug: mockSlug,
        videoPath: 'not_exist.mp4',
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('VIDEO_NOT_FOUND');
    });
  });

  describe('Khoi chay FFmpeg thanh cong', () => {
    it('goi child_process.spawn voi mang argument dung chuan', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);

      const mockChild = new EventEmitter() as any;
      mockChild.pid = 9999;
      mockChild.kill = jest.fn();
      mockChild.stderr = new EventEmitter();

      (child_process.spawn as jest.Mock).mockReturnValue(mockChild);

      const result = await service.start({
        cameraId: mockCameraId,
        slug: mockSlug,
        videoPath: 'sample.mp4',
        loop: true,
      });

      expect(result.success).toBe(true);
      expect(result.pid).toBe(9999);
      expect(service.isRunning(mockCameraId)).toBe(true);

      expect(child_process.spawn).toHaveBeenCalledWith(
        'ffmpeg',
        expect.arrayContaining([
          '-re',
          '-stream_loop',
          '-1',
          '-i',
          expect.stringContaining('sample.mp4'),
          '-c:v',
          'copy',
          '-c:a',
          'aac',
          '-f',
          'rtsp',
          'rtsp://localhost:8554/cam_living_room',
        ]),
        expect.any(Object),
      );
    });
  });

  describe('Dung tien trinh', () => {
    it('gui SIGTERM va giai phong process khoi active list', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);

      const mockChild = new EventEmitter() as any;
      mockChild.pid = 8888;
      mockChild.kill = jest.fn().mockImplementation((signal) => {
        if (signal === 'SIGTERM') {
          mockChild.emit('exit', 0, 'SIGTERM');
        }
      });
      mockChild.stderr = new EventEmitter();

      (child_process.spawn as jest.Mock).mockReturnValue(mockChild);

      await service.start({
        cameraId: mockCameraId,
        slug: mockSlug,
        videoPath: 'sample.mp4',
      });

      expect(service.isRunning(mockCameraId)).toBe(true);

      const stopped = await service.stop(mockCameraId);
      expect(stopped).toBe(true);
      expect(mockChild.kill).toHaveBeenCalledWith('SIGTERM');
      expect(service.isRunning(mockCameraId)).toBe(false);
    });
  });
});
