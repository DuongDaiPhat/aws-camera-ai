import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { FfmpegSourceRunnerService } from '../src/camera-sources/ffmpeg-source-runner.service';
import { MediaMtxService } from '../src/camera-sources/media-mtx.service';
import child_process from 'child_process';
import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';

jest.mock('child_process');
jest.mock('fs');

describe('FfmpegSourceRunnerService (Slice CAM)', () => {
  let service: FfmpegSourceRunnerService;

  const mockCameraId = 'c1111111-1111-1111-1111-111111111111';
  const mockSlug = 'cam_living_room';

  function mockSpawn(
    child: EventEmitter & { pid?: number; stderr?: EventEmitter; kill?: jest.Mock },
  ): void {
    (child_process.spawn as jest.Mock).mockReturnValue(child);
    void Promise.resolve().then(() => child.emit('spawn'));
  }

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
      getPublishRtspUrl: jest.fn((slug: string) => `rtsp://localhost:8554/${slug}`),
      createBrowserSession: jest.fn(),
    };

    // Mock fs
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.realpathSync as unknown as jest.Mock).mockImplementation((filePath: string) => filePath);
    (child_process.spawnSync as unknown as jest.Mock).mockReturnValue({
      status: 0,
      stdout: 'h264\n',
    });

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

    it('tu choi file symlink tro ra ngoai thu muc video duoc quan ly', async () => {
      (fs.realpathSync as unknown as jest.Mock).mockImplementation((filePath: string) =>
        filePath.endsWith('videos') ? filePath : path.resolve('outside', path.basename(filePath)),
      );

      const result = await service.start({
        cameraId: mockCameraId,
        slug: mockSlug,
        videoPath: 'linked.mp4',
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('SECURITY_VIOLATION');
    });
  });

  describe('Khoi chay FFmpeg thanh cong', () => {
    it('goi child_process.spawn voi copy video khi video la h264', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (child_process.spawnSync as unknown as jest.Mock).mockReturnValue({
        status: 0,
        stdout: 'h264\n',
      });

      const mockChild = new EventEmitter() as any;
      mockChild.pid = 9999;
      mockChild.kill = jest.fn();
      mockChild.stderr = new EventEmitter();

      mockSpawn(mockChild);

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

    it('transcode sang libx264 neu video khong phai h264 (vi du HEVC/H.265)', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (child_process.spawnSync as unknown as jest.Mock).mockReturnValue({
        status: 0,
        stdout: 'hevc\n',
      });

      const mockChild = new EventEmitter() as any;
      mockChild.pid = 9998;
      mockChild.kill = jest.fn();
      mockChild.stderr = new EventEmitter();

      mockSpawn(mockChild);

      const result = await service.start({
        cameraId: mockCameraId,
        slug: mockSlug,
        videoPath: 'sample_hevc.mp4',
        loop: true,
      });

      expect(result.success).toBe(true);
      expect(result.pid).toBe(9998);

      expect(child_process.spawn).toHaveBeenCalledWith(
        'ffmpeg',
        expect.arrayContaining([
          '-re',
          '-stream_loop',
          '-1',
          '-i',
          expect.stringContaining('sample_hevc.mp4'),
          '-c:v',
          'libx264',
          '-preset',
          'ultrafast',
          '-tune',
          'zerolatency',
          '-pix_fmt',
          'yuv420p',
          '-c:a',
          'aac',
          '-f',
          'rtsp',
          'rtsp://localhost:8554/cam_living_room',
        ]),
        expect.any(Object),
      );
    });

    it('fallback sang libx264 neu ffprobe loi hoac khong phat hien duoc codec', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (child_process.spawnSync as unknown as jest.Mock).mockReturnValue({
        status: 1,
        stdout: '',
      });

      const mockChild = new EventEmitter() as any;
      mockChild.pid = 9997;
      mockChild.kill = jest.fn();
      mockChild.stderr = new EventEmitter();

      mockSpawn(mockChild);

      const result = await service.start({
        cameraId: mockCameraId,
        slug: mockSlug,
        videoPath: 'unknown.mp4',
        loop: true,
      });

      expect(result.success).toBe(true);
      expect(child_process.spawn).toHaveBeenCalledWith(
        'ffmpeg',
        expect.arrayContaining([
          '-c:v',
          'libx264',
          '-preset',
          'ultrafast',
          '-tune',
          'zerolatency',
          '-pix_fmt',
          'yuv420p',
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

      mockSpawn(mockChild);

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

    it('huy retry timer va khong restart khi duoc stop', async () => {
      jest.useFakeTimers();
      (fs.existsSync as jest.Mock).mockReturnValue(true);

      const mockChild = new EventEmitter() as any;
      mockChild.pid = 7777;
      mockChild.kill = jest.fn();
      mockChild.stderr = new EventEmitter();

      mockSpawn(mockChild);

      await service.start({
        cameraId: mockCameraId,
        slug: mockSlug,
        videoPath: 'sample.mp4',
      });

      // Giả lập crash bất ngờ code = 1
      mockChild.emit('exit', 1, null);

      // Chủ động stop trong lúc đang hẹn giờ retry
      await service.stop(mockCameraId);

      // Chạy hết timers
      jest.runAllTimers();

      // Spawn không được gọi thêm lần nào nữa (chỉ 1 lần đầu)
      expect(child_process.spawn).toHaveBeenCalledTimes(1);
      jest.useRealTimers();
    });

    it('loc credential trong stderr buffer an toan', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);

      const mockChild = new EventEmitter() as any;
      mockChild.pid = 6666;
      mockChild.kill = jest.fn();
      mockChild.stderr = new EventEmitter();

      mockSpawn(mockChild);

      await service.start({
        cameraId: mockCameraId,
        slug: mockSlug,
        videoPath: 'sample.mp4',
      });

      // Phát stderr chứa mật khẩu rtsp
      mockChild.stderr.emit(
        'data',
        Buffer.from('Connecting to rtsp://admin:super_secret_pw@192.168.1.1:554/live failed\n'),
      );

      // Stop service
      await service.stop(mockCameraId);
      expect(true).toBe(true);
    });
  });
});
