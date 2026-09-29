import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn, spawnSync, type ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import type { ISourceRunner, SourceRunOptions, SourceRunResult } from './source-runner.interface';
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

  private readonly retryTimers = new Map<string, NodeJS.Timeout>();

  private readonly stopTimeoutMs: number;
  private readonly startTimeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly videoStoragePath: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly mediaMtxService: MediaMtxService,
  ) {
    this.stopTimeoutMs = Number(this.configService.get('CAMERA_SOURCE_STOP_TIMEOUT_MS', 5000));
    this.startTimeoutMs = Number(this.configService.get('CAMERA_SOURCE_START_TIMEOUT_MS', 5000));
    this.maxRetries = Number(this.configService.get('CAMERA_SOURCE_MAX_RETRIES', 3));
    this.retryDelayMs = Number(this.configService.get('CAMERA_SOURCE_RETRY_DELAY_MS', 2000));
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
      this.logger.warn(
        `Source runner cho camera ${slug} (${cameraId}) đang chạy, dừng trước khi chạy lại`,
      );
      await this.stop(cameraId);
    }

    const validation = this.validateSafeVideoPath(videoPath);
    if (validation.error) return validation.error;
    const resolvedFilePath = validation.safePath!;

    const outputRtspUrl = this.mediaMtxService.getPublishRtspUrl(slug);
    const args = this.buildFfmpegArgs(resolvedFilePath, outputRtspUrl, loop);

    this.logger.log(
      `Khởi chạy FFmpeg publisher cho camera ${slug} -> ${this.redactRtspUrl(outputRtspUrl)}`,
    );

    try {
      const child = spawn('ffmpeg', args, {
        stdio: ['ignore', 'ignore', 'pipe'],
      });

      await this.waitForSpawn(child);

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

  private waitForSpawn(child: ChildProcess): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.removeListener('spawn', onSpawn);
        child.removeListener('error', onError);
        try {
          child.kill('SIGKILL');
        } catch {
          /* process may already have exited */
        }
        reject(new Error(`FFmpeg did not spawn within ${this.startTimeoutMs}ms`));
      }, this.startTimeoutMs);
      const onSpawn = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.removeListener('error', onError);
        resolve();
      };
      const onError = (error: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.removeListener('spawn', onSpawn);
        reject(error);
      };
      child.once('spawn', onSpawn);
      child.once('error', onError);
    });
  }

  async stop(cameraId: string): Promise<boolean> {
    const retryTimer = this.retryTimers.get(cameraId);
    if (retryTimer) {
      clearTimeout(retryTimer);
      this.retryTimers.delete(cameraId);
    }
    this.retryCounters.delete(cameraId);

    const info = this.activeProcesses.get(cameraId);
    if (!info) return false;

    this.logger.log(`Dừng tiến trình FFmpeg (PID: ${info.pid}) cho camera ${info.slug}`);
    this.activeProcesses.delete(cameraId);

    return new Promise<boolean>((resolve) => {
      let isExited = false;
      let forceKillTimer: NodeJS.Timeout | undefined;

      const timer = setTimeout(() => {
        if (!isExited) {
          this.logger.warn(`Tiến trình ${info.pid} không phản hồi SIGTERM, gửi SIGKILL`);
          try {
            info.process.kill('SIGKILL');
          } catch {
            // bỏ qua nếu process đã chết
          }
          // Đợi thêm ngắn để tiến trình OS hoàn tất thu hồi tài nguyên
          forceKillTimer = setTimeout(() => resolve(false), 500);
        }
      }, this.stopTimeoutMs);

      info.process.once('exit', () => {
        isExited = true;
        clearTimeout(timer);
        if (forceKillTimer) clearTimeout(forceKillTimer);
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
    return Boolean(info && (info.process.exitCode === null || info.process.exitCode === undefined));
  }

  getPid(cameraId: string): number | undefined {
    return this.activeProcesses.get(cameraId)?.pid;
  }

  getStartTimeoutMs(): number {
    return this.startTimeoutMs;
  }

  async cleanup(): Promise<void> {
    const cameraIds = Array.from(this.activeProcesses.keys());
    await Promise.all(cameraIds.map((id) => this.stop(id)));
  }

  async onApplicationShutdown(): Promise<void> {
    this.logger.log('Đang dọn dẹp các tiến trình FFmpeg source runner trước khi tắt ứng dụng...');
    await this.cleanup();
  }

  private detectVideoCodec(filePath: string): string | null {
    try {
      const res = spawnSync(
        'ffprobe',
        [
          '-v',
          'error',
          '-select_streams',
          'v:0',
          '-show_entries',
          'stream=codec_name',
          '-of',
          'default=noprint_wrappers=1:nokey=1',
          filePath,
        ],
        { encoding: 'utf-8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] },
      );
      if (res.status === 0 && res.stdout) {
        return res.stdout.trim().toLowerCase() || null;
      }
      return null;
    } catch (err) {
      this.logger.warn(`Không thể phát hiện video codec của ${filePath} qua ffprobe:`, err);
      return null;
    }
  }

  private buildFfmpegArgs(inputPath: string, outputRtspUrl: string, loop: boolean): string[] {
    const args = ['-re'];
    if (loop) {
      args.push('-stream_loop', '-1');
    }
    args.push('-i', inputPath);

    const codec = this.detectVideoCodec(inputPath);
    if (codec === 'h264') {
      args.push('-c:v', 'copy');
    } else {
      this.logger.log(
        `Video codec là "${codec ?? 'unknown'}" (không phải H.264). Đang transcode sang libx264 để hỗ trợ WebRTC trình duyệt...`,
      );
      args.push(
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-tune',
        'zerolatency',
        '-pix_fmt',
        'yuv420p',
      );
    }

    args.push('-c:a', 'aac', '-f', 'rtsp', '-rtsp_transport', 'tcp', outputRtspUrl);
    return args;
  }

  private redactRtspUrl(url: string): string {
    return url.replace(/(rtsp:\/\/)[^:/@]+:[^@/]+@/i, '$1***:***@');
  }

  private setupProcessListeners(cameraId: string, info: ActiveProcessInfo): void {
    const { process, pid, slug, options } = info;

    process.stderr?.on('data', (chunk: Buffer) => {
      const remainingBytes = MAX_STDERR_BYTES - Buffer.byteLength(info.stderrBuffer);
      if (remainingBytes <= 0) return;
      const raw = chunk.toString('utf-8');
      const sanitized = raw.replace(/(rtsp:\/\/)[^:/@]+:[^@/]+@/gi, '$1***:***@');
      info.stderrBuffer += Buffer.from(sanitized).subarray(0, remainingBytes).toString('utf-8');
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
          const t = setTimeout(() => {
            this.retryTimers.delete(cameraId);
            void this.start(options);
          }, this.retryDelayMs);
          this.retryTimers.set(cameraId, t);
        } else {
          this.logger.error(
            `FFmpeg cho camera ${slug} đã vượt quá số lần thử lại tối đa (${this.maxRetries}). Dừng khởi động lại.`,
          );
          this.retryCounters.delete(cameraId);
        }
      }
    });
  }

  private validateSafeVideoPath(videoPath?: string): {
    safePath?: string;
    error?: SourceRunResult;
  } {
    if (!videoPath) {
      return {
        error: {
          success: false,
          errorCode: 'SOURCE_NOT_CONFIGURED',
          errorMessage: 'Thiếu đường dẫn file video đầu vào',
        },
      };
    }

    const managedRoot = fs.realpathSync(this.videoStoragePath);
    const requestedPath = path.resolve(managedRoot, path.basename(videoPath));
    let resolvedFilePath: string;
    try {
      resolvedFilePath = fs.realpathSync(requestedPath);
    } catch {
      resolvedFilePath = requestedPath;
    }
    const relativePath = path.relative(managedRoot, resolvedFilePath);
    if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
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
