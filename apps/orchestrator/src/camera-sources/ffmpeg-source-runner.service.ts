import {
  Injectable,
  Logger,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn, type ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import type {
  ISourceRunner,
  SourceRunOptions,
  SourceRunResult,
} from './source-runner.interface';
import { MediaMtxService, SLUG_REGEX } from './media-mtx.service';

const MAX_STDERR_BYTES = 4096;

interface ActiveProcessInfo {
  process: ChildProcess;
  pid: number;
  slug: string;
  options: SourceRunOptions;
  stderrBuffer: string;
}

@Injectable()
export class FfmpegSourceRunnerService implements ISourceRunner, OnApplicationShutdown {
  private readonly logger = new Logger(FfmpegSourceRunnerService.name);
  private readonly activeProcesses = new Map<string, ActiveProcessInfo>();
  private readonly retryCounters = new Map<string, number>();

  private readonly stopTimeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly videoStoragePath: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly mediaMtxService: MediaMtxService,
  ) {
    this.stopTimeoutMs = Number(
      this.configService.get('CAMERA_SOURCE_STOP_TIMEOUT_MS', 5000),
    );
    this.maxRetries = Number(this.configService.get('CAMERA_SOURCE_MAX_RETRIES', 3));
    this.retryDelayMs = Number(
      this.configService.get('CAMERA_SOURCE_RETRY_DELAY_MS', 2000),
    );
    this.videoStoragePath = path.resolve(
      this.configService.get('CAMERA_VIDEO_STORAGE_PATH', './storage/videos'),
    );

    if (!fs.existsSync(this.videoStoragePath)) {
      try {
        fs.mkdirSync(this.videoStoragePath, { recursive: true });
      } catch (err) {
        this.logger.warn(`Không thể tạo thư mục lưu trữ video ${this.videoStoragePath}:`, err);
      }
    }
  }

  async start(options: SourceRunOptions): Promise<SourceRunResult> {
    const { cameraId, slug, videoPath, loop = true } = options;

    if (!SLUG_REGEX.test(slug)) {
      return {
        success: false,
        errorCode: 'INVALID_SLUG',
        errorMessage: `Slug camera không hợp lệ: "${slug}"`,
      };
    }

    if (this.isRunning(cameraId)) {
      this.logger.warn(`Source runner cho camera ${slug} (${cameraId}) đang chạy, dừng trước khi chạy lại`);
      await this.stop(cameraId);
    }

    const validation = this.validateSafeVideoPath(videoPath);
    if (validation.error) return validation.error;
    const resolvedFilePath = validation.safePath!;

    const outputRtspUrl = this.mediaMtxService.getPublishRtspUrl(slug);
    const args = this.buildFfmpegArgs(resolvedFilePath, outputRtspUrl, loop);

    this.logger.log(`Khởi chạy FFmpeg publisher cho camera ${slug} -> ${outputRtspUrl}`);

    try {
      const child = spawn('ffmpeg', args, {
        stdio: ['ignore', 'ignore', 'pipe'],
      });

      if (!child.pid) {
        return {
          success: false,
          errorCode: 'FFMPEG_START_FAILED',
          errorMessage: 'Không thể lấy PID của tiến trình FFmpeg',
        };
      }

      const processInfo: ActiveProcessInfo = {
        process: child,
        pid: child.pid,
        slug,
        options,
        stderrBuffer: '',
      };

      this.activeProcesses.set(cameraId, processInfo);
      this.setupProcessListeners(cameraId, processInfo);

      return {
        success: true,
        pid: child.pid,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Lỗi khi khởi chạy tiến trình FFmpeg';
      this.logger.error(`Lỗi spawn FFmpeg cho camera ${slug}:`, msg);
      return {
        success: false,
        errorCode: 'FFMPEG_START_FAILED',
        errorMessage: msg,
      };
    }
  }

  async stop(cameraId: string): Promise<boolean> {
    const info = this.activeProcesses.get(cameraId);
    if (!info) return false;

    this.logger.log(`Dừng tiến trình FFmpeg (PID: ${info.pid}) cho camera ${info.slug}`);
    this.activeProcesses.delete(cameraId);
    this.retryCounters.delete(cameraId);

    return new Promise<boolean>((resolve) => {
      let isExited = false;

      const timer = setTimeout(() => {
        if (!isExited) {
          this.logger.warn(`Tiến trình ${info.pid} không phản hồi SIGTERM, gửi SIGKILL`);
          try {
            info.process.kill('SIGKILL');
          } catch {
            // bỏ qua lỗi nếu process đã chết
          }
          resolve(true);
        }
      }, this.stopTimeoutMs);

      info.process.once('exit', () => {
        isExited = true;
        clearTimeout(timer);
        resolve(true);
      });

      try {
        info.process.kill('SIGTERM');
      } catch {
        clearTimeout(timer);
        resolve(true);
      }
    });
  }

  isRunning(cameraId: string): boolean {
    const info = this.activeProcesses.get(cameraId);
    return Boolean(info && !info.process.killed);
  }

  getPid(cameraId: string): number | undefined {
    return this.activeProcesses.get(cameraId)?.pid;
  }

  async cleanup(): Promise<void> {
    const cameraIds = Array.from(this.activeProcesses.keys());
    await Promise.all(cameraIds.map((id) => this.stop(id)));
  }

  async onApplicationShutdown(): Promise<void> {
    this.logger.log('Đang dọn dẹp các tiến trình FFmpeg source runner trước khi tắt ứng dụng...');
    await this.cleanup();
  }

  private buildFfmpegArgs(inputPath: string, outputRtspUrl: string, loop: boolean): string[] {
    const args = ['-re'];
    if (loop) {
      args.push('-stream_loop', '-1');
    }
    args.push(
      '-i',
      inputPath,
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-f',
      'rtsp',
      '-rtsp_transport',
      'tcp',
      outputRtspUrl,
    );
    return args;
  }

  private setupProcessListeners(cameraId: string, info: ActiveProcessInfo): void {
    const { process, pid, slug, options } = info;

    process.stderr?.on('data', (chunk: Buffer) => {
      if (info.stderrBuffer.length < MAX_STDERR_BYTES) {
        info.stderrBuffer += chunk.toString('utf-8');
      }
    });

    process.on('error', (err) => {
      this.logger.error(`Lỗi tiến trình FFmpeg (PID ${pid}, camera ${slug}):`, err);
    });

    process.on('exit', (code, signal) => {
      this.logger.log(
        `Tiến trình FFmpeg (PID ${pid}, camera ${slug}) kết thúc với code: ${code}, signal: ${signal}`,
      );

      // Nếu không còn trong activeProcesses tức là chủ động stop
      if (!this.activeProcesses.has(cameraId)) return;

      this.activeProcesses.delete(cameraId);

      // Xử lý crash và retry có giới hạn
      if (code !== 0 && signal !== 'SIGTERM' && signal !== 'SIGKILL') {
        const retries = (this.retryCounters.get(cameraId) ?? 0) + 1;
        this.retryCounters.set(cameraId, retries);

        if (retries <= this.maxRetries) {
          this.logger.warn(
            `FFmpeg crash cho camera ${slug}. Thử lại lần ${retries}/${this.maxRetries} sau ${this.retryDelayMs}ms...`,
          );
          setTimeout(() => {
            void this.start(options);
          }, this.retryDelayMs);
        } else {
          this.logger.error(
            `FFmpeg cho camera ${slug} đã vượt quá số lần thử lại tối đa (${this.maxRetries}). Dừng khởi động lại.`,
          );
          this.retryCounters.delete(cameraId);
        }
      }
    });
  }

  private validateSafeVideoPath(videoPath?: string): { safePath?: string; error?: SourceRunResult } {
    if (!videoPath) {
      return {
        error: {
          success: false,
          errorCode: 'SOURCE_NOT_CONFIGURED',
          errorMessage: 'Thiếu đường dẫn file video đầu vào',
        },
      };
    }

    const resolvedFilePath = path.resolve(this.videoStoragePath, path.basename(videoPath));
    if (!resolvedFilePath.startsWith(this.videoStoragePath)) {
      return {
        error: {
          success: false,
          errorCode: 'SECURITY_VIOLATION',
          errorMessage: 'Đường dẫn file video nằm ngoài thư mục quản lý an toàn',
        },
      };
    }

    if (!fs.existsSync(resolvedFilePath)) {
      return {
        error: {
          success: false,
          errorCode: 'VIDEO_NOT_FOUND',
          errorMessage: `Không tìm thấy file video: ${path.basename(videoPath)}`,
        },
      };
    }

    return { safePath: resolvedFilePath };
  }
}
