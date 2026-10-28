import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'node:child_process';
import type { IAlertImageRenderer } from './alert-image-renderer.interface';
import { fireBoxFilter, fireImageDetections } from './fire-image-evidence';

function jpegAnnotationArguments(filter: string): string[] {
  return [
    '-nostdin',
    '-hide_banner',
    '-loglevel',
    'error',
    '-threads',
    '1',
    '-f',
    'image2pipe',
    '-vcodec',
    'mjpeg',
    '-i',
    'pipe:0',
    '-vf',
    filter,
    '-frames:v',
    '1',
    '-threads',
    '1',
    '-q:v',
    '3',
    '-f',
    'image2pipe',
    '-vcodec',
    'mjpeg',
    'pipe:1',
  ];
}

@Injectable()
export class FfmpegAlertImageRenderer implements IAlertImageRenderer {
  private readonly timeoutMs: number;
  private readonly maxBytes: number;
  private readonly maxBoxes: number;
  private readonly thickness: number;
  constructor(config: ConfigService) {
    this.timeoutMs = positive(config, 'TELEGRAM_IMAGE_RENDER_TIMEOUT_MS', 1500);
    this.maxBytes = positive(config, 'TELEGRAM_IMAGE_RENDER_MAX_BYTES', 2097152);
    this.maxBoxes = positive(config, 'TELEGRAM_IMAGE_RENDER_MAX_BOXES', 32);
    this.thickness = positive(config, 'TELEGRAM_IMAGE_BOX_THICKNESS', 5);
  }
  async render(image: Buffer, metadata: unknown): Promise<Buffer | null> {
    const items = fireImageDetections(metadata, this.maxBoxes);
    if (!items.length) return null;
    const filter = fireBoxFilter(items, this.thickness);
    return new Promise((resolve, reject) => {
      const child = spawn('ffmpeg', jpegAnnotationArguments(filter), {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const chunks: Buffer[] = [];
      let size = 0;
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('Fire image annotation timed out'));
      }, this.timeoutMs);
      child.stdout.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > this.maxBytes) {
          child.kill('SIGKILL');
          reject(new Error('Fire annotation output exceeds byte budget'));
        } else chunks.push(chunk);
      });
      child.stderr.resume();
      // A decoder failure can close stdin early; the process exit path reports it.
      child.stdin.on('error', () => {});
      child.on('error', () => {
        clearTimeout(timer);
        reject(new Error('Fire image renderer unavailable'));
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        const output = Buffer.concat(chunks);
        if (code !== 0 || output.length < 4 || output.readUInt16BE(0) !== 0xffd8)
          reject(new Error('Fire image annotation failed'));
        else resolve(output);
      });
      child.stdin.end(image);
    });
  }
}
function positive(config: ConfigService, key: string, fallback: number): number {
  const value = Number(config.get<string | number>(key, fallback));
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid ${key}`);
  return value;
}
