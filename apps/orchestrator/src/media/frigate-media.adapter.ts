import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import sharp from 'sharp';
import { unpackPoseFrameEnvelope } from '../fall-detection/envelope/pose-frame-envelope';
import type { UnpackedPoseFrame } from '../fall-detection/dto/pose-frame.dto';

@Injectable()
export class FrigateMediaAdapter {
  private readonly logger = new Logger(FrigateMediaAdapter.name);
  private readonly frigateBaseUrl: string;
  private readonly timestampedFrames = new Map<string, UnpackedPoseFrame>();

  constructor(private readonly configService: ConfigService) {
    this.frigateBaseUrl = this.configService.get<string>('FRIGATE_URL', 'http://localhost:5000');
  }

  /** The bridge binds the JPEG and person boxes to the same captured frame. */
  acceptTimestampedFrame(envelope: Buffer, now = Date.now()): void {
    this.pruneTimestampedFrames(now);
    const frame = unpackPoseFrameEnvelope(envelope);
    if (
      !frame ||
      !/^[a-z][a-z0-9_]{2,63}$/.test(frame.header.cameraSlug) ||
      Math.abs(now - frame.header.frameTimestamp * 1000) > 2000
    )
      return;
    const previous = this.timestampedFrames.get(frame.header.cameraSlug);
    if (previous && previous.header.frameTimestamp >= frame.header.frameTimestamp) return;
    this.timestampedFrames.delete(frame.header.cameraSlug);
    this.timestampedFrames.set(frame.header.cameraSlug, frame);
    // The envelope parser limits each frame to 1 MiB; cap retained cameras too.
    while (this.timestampedFrames.size > 24)
      this.timestampedFrames.delete(this.timestampedFrames.keys().next().value!);
  }

  async getTimestampedPersonCrop(
    cameraSlug: string,
    trackId: string,
    now = Date.now(),
  ): Promise<Buffer | null> {
    this.pruneTimestampedFrames(now);
    const frame = this.timestampedFrames.get(cameraSlug);
    const person = frame?.header.persons.find((p) => p.trackId === trackId);
    if (!frame || !person || Math.abs(frame.header.frameTimestamp - person.observedAt) > 0.25)
      return null;
    const b = person.boundingBox;
    try {
      return await this.cropPersonFrame(
        frame.imageBytes,
        [b.x, b.y, b.x + b.width, b.y + b.height],
        frame.header.frameWidth,
        frame.header.frameHeight,
      );
    } catch {
      return null;
    }
  }

  private pruneTimestampedFrames(now: number): void {
    for (const [camera, frame] of this.timestampedFrames) {
      if (now - frame.header.frameTimestamp * 1000 > 2000) this.timestampedFrames.delete(camera);
    }
  }

  /** Sample the current person crop; an event snapshot is Frigate's historical
   * best person score and can remain back-facing throughout a clear-face window. */
  async getCurrentPersonCrop(
    cameraSlug: string,
    box: number[],
    frameWidth: number,
    frameHeight: number,
    observedAtSeconds: number,
  ): Promise<Buffer | null> {
    if (
      !/^[a-z][a-z0-9_]{2,63}$/.test(cameraSlug) ||
      box.length !== 4 ||
      !box.every(Number.isFinite) ||
      box[2]! <= box[0]! ||
      box[3]! <= box[1]! ||
      !Number.isSafeInteger(frameWidth) ||
      !Number.isSafeInteger(frameHeight) ||
      frameWidth < 1 ||
      frameHeight < 1 ||
      frameWidth * frameHeight > 12_000_000 ||
      !Number.isFinite(observedAtSeconds) ||
      Math.abs(Date.now() - observedAtSeconds * 1000) > 2000
    )
      return null;
    try {
      const response = await fetch(
        `${this.frigateBaseUrl}/api/${cameraSlug}/latest.jpg?height=${frameHeight}&quality=100&bbox=0&timestamp=0`,
        { signal: AbortSignal.timeout(2000) },
      );
      if (!response.ok || response.headers.get('X-Frigate-Offline') === 'true') return null;
      const frame = Buffer.from(await response.arrayBuffer());
      if (frame.length > 10 * 1024 * 1024) return null;
      return await this.cropPersonFrame(frame, box, frameWidth, frameHeight);
    } catch {
      this.logger.warn(`Current person frame unavailable camera=${cameraSlug}`);
      return null;
    }
  }

  private async cropPersonFrame(
    frame: Buffer,
    box: number[],
    frameWidth: number,
    frameHeight: number,
  ): Promise<Buffer | null> {
    const image = sharp(frame, { limitInputPixels: 12_000_000 });
    const meta = await image.metadata();
    if (!meta.width || !meta.height) return null;
    const normalized = box.every((v) => v >= 0 && v <= 1);
    const sx = meta.width / (normalized ? 1 : frameWidth);
    const sy = meta.height / (normalized ? 1 : frameHeight);
    const paddingX = (box[2]! - box[0]!) * sx * 0.04;
    const paddingY = (box[3]! - box[1]!) * sy * 0.04;
    const left = Math.max(0, Math.floor(box[0]! * sx - paddingX));
    const top = Math.max(0, Math.floor(box[1]! * sy - paddingY));
    const right = Math.min(meta.width, Math.ceil(box[2]! * sx + paddingX));
    const bottom = Math.min(meta.height, Math.ceil(box[3]! * sy + paddingY));
    if (right <= left || bottom <= top) return null;
    return await image
      .extract({ left, top, width: right - left, height: bottom - top })
      .jpeg({ quality: 95 })
      .toBuffer();
  }

  /**
   * Lấy ảnh crop khuôn mặt/người từ Frigate API.
   * Tham số crop=1 giúp Frigate trả về ảnh đã crop sát bounding box,
   * rất quan trọng để AI nhận diện khuôn mặt chính xác (US-10).
   */
  async getCroppedSnapshot(trackId: string): Promise<Buffer | null> {
    const url = `${this.frigateBaseUrl}/api/events/${trackId}/snapshot.jpg?crop=1&quality=100`;
    try {
      const response = await fetch(url);
      if (!response.ok) {
        this.logger.warn(
          `Không thể lấy ảnh crop từ Frigate cho trackId=${trackId} (${response.status})`,
        );
        return null;
      }
      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (error) {
      this.logger.error(`Lỗi kết nối Frigate khi lấy ảnh crop cho trackId=${trackId}`, error);
      return null;
    }
  }
}
