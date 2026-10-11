import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CamerasRepository } from '../../cameras/cameras.repository';
import { FallIncidentCoordinator } from '../coordinator/fall-incident.coordinator';
import { unpackPoseFrameEnvelope } from '../envelope/pose-frame-envelope';

const DEFAULT_MAX_STALE_FRAME_SECONDS = 2.5;

@Injectable()
export class PoseFrameConsumer {
  private readonly logger = new Logger(PoseFrameConsumer.name);
  private readonly isM2aEnabled: boolean;
  private readonly maxStaleFrameSeconds: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly camerasRepository: CamerasRepository,
    private readonly fallIncidentCoordinator: FallIncidentCoordinator,
  ) {
    this.isM2aEnabled = this.configService.get<string>('M2A_ENABLED', 'true') === 'true';
    this.maxStaleFrameSeconds = Number(
      this.configService.get<string | number>(
        'POSE_MAX_STALE_FRAME_SECONDS',
        DEFAULT_MAX_STALE_FRAME_SECONDS,
      ),
    );
  }

  /**
   * Tiếp nhận và xử lý pose frame envelope từ MQTT topic frigate/camerai/pose/frames.
   */
  async handlePoseFrame(buffer: Buffer): Promise<void> {
    if (!this.isM2aEnabled) {
      return;
    }

    const unpacked = unpackPoseFrameEnvelope(buffer);
    if (!unpacked) {
      return;
    }

    const { header, imageBytes } = unpacked;

    // Kiểm tra độ tươi (freshness) của khung hình (bỏ qua frame cũ > threshold)
    const nowSeconds = Date.now() / 1000;
    if (nowSeconds - header.frameTimestamp > this.maxStaleFrameSeconds) {
      this.logger.debug(
        `Bỏ qua pose frame cũ: delay ${(nowSeconds - header.frameTimestamp).toFixed(2)}s > ${this.maxStaleFrameSeconds}s`,
      );
      return;
    }

    if (!header.persons || header.persons.length === 0) {
      return;
    }

    // Tra cứu camera theo slug
    const camera = await this.camerasRepository.findBySlug(header.cameraSlug);
    if (!camera || !camera.is_enabled) {
      return;
    }

    const frameTimestamp = new Date(header.frameTimestamp * 1000);

    try {
      await this.fallIncidentCoordinator.processFrame({
        cameraId: camera.id,
        cameraSlug: header.cameraSlug,
        sourceSessionId: header.sourceSessionId,
        frameId: header.frameId,
        frameTimestamp,
        imageBytes,
        persons: header.persons,
      });
    } catch (error) {
      this.logger.error(
        `Lỗi khi điều phối xử lý pose frame trên camera ${header.cameraSlug}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
