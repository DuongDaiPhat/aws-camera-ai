import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'child_process';

const MAX_PROBE_STDERR_BYTES = 2048;

export interface RtspProbeOutput {
  success: boolean;
  stderr: string;
}

export interface RtspConnectionTestResult {
  success: boolean;
  message: string;
  latencyMs: number | null;
}

@Injectable()
export class RtspSourceTesterService {
  private readonly timeoutMs: number;

  constructor(configService: ConfigService) {
    this.timeoutMs = Number(configService.get('CAMERA_RTSP_TEST_TIMEOUT_MS', 8000));
  }

  async test(rtspUrl: string, transport: 'TCP' | 'UDP'): Promise<RtspConnectionTestResult> {
    this.assertRtspUrl(rtspUrl);
    const startedAt = Date.now();
    const output = await this.executeProbe(this.buildProbeArgs(rtspUrl, transport));

    if (!output.success) {
      return {
        success: false,
        message: 'Không thể kết nối tới nguồn RTSP. Hãy kiểm tra URL, tài khoản và mạng.',
        latencyMs: null,
      };
    }

    return {
      success: true,
      message: 'Kết nối RTSP thành công.',
      latencyMs: Date.now() - startedAt,
    };
  }

  protected buildProbeArgs(rtspUrl: string, transport: 'TCP' | 'UDP'): string[] {
    return [
      '-v',
      'error',
      '-rtsp_transport',
      transport.toLowerCase(),
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=codec_name,width,height',
      '-of',
      'json',
      rtspUrl,
    ];
  }

  protected executeProbe(args: string[]): Promise<RtspProbeOutput> {
    return new Promise((resolve) => {
      const child = spawn('ffprobe', args, { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      let settled = false;

      const finish = (output: RtspProbeOutput): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(output);
      };

      const timeout = setTimeout(() => {
        child.kill('SIGKILL');
        finish({ success: false, stderr: 'RTSP probe timeout' });
      }, this.timeoutMs);

      child.stderr?.on('data', (chunk: Buffer) => {
        if (Buffer.byteLength(stderr) >= MAX_PROBE_STDERR_BYTES) return;
        stderr += chunk.toString('utf8').slice(0, MAX_PROBE_STDERR_BYTES - stderr.length);
      });
      child.once('error', () => finish({ success: false, stderr: 'ffprobe unavailable' }));
      child.once('close', (code) => finish({ success: code === 0, stderr }));
    });
  }

  private assertRtspUrl(rtspUrl: string): void {
    let parsed: URL;
    try {
      parsed = new URL(rtspUrl);
    } catch {
      throw this.invalidRtspUrl();
    }
    if (!['rtsp:', 'rtsps:'].includes(parsed.protocol)) throw this.invalidRtspUrl();
  }

  private invalidRtspUrl(): BadRequestException {
    return new BadRequestException({
      error: {
        code: 'SOURCE_UNAVAILABLE',
        message: 'URL nguồn phát phải sử dụng giao thức RTSP hoặc RTSPS.',
      },
    });
  }
}
