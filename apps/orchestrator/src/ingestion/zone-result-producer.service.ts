import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AiResultsService } from '../ai-results/ai-results.service';
import type { SubmitAiResultDto } from '../ai-results/dto/submit-ai-result.dto';
import type { CameraRecord, EventRecord, ZoneRecord } from '../events/events.repository';
import type { FrigateEventAfterDto } from './dto/frigate-event.dto';

const MAX_RECEIPT_REVISION = 2_147_483_647;
const ZONE_RULE_VERSION = 'frigate-loitering-v1';
const UUID_NAMESPACE = Buffer.from('6ba7b8109dad11d180b400c04fd430c8', 'hex');

export interface ZoneResultContext {
  camera: CameraRecord;
  zones: ZoneRecord[];
}

function resultUuid(identity: string): string {
  const bytes = createHash('sha1').update(UUID_NAMESPACE).update(identity).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

@Injectable()
export class ZoneResultProducerService {
  constructor(private readonly aiResultsService: AiResultsService) {}

  async submit(
    event: EventRecord,
    after: FrigateEventAfterDto,
    context: ZoneResultContext | null,
  ): Promise<void> {
    if (!context || context.zones.length === 0) return;
    const { camera, zones } = context;
    const configVersion = camera.zone_config_version;
    if (camera.zone_config_applied !== true || !configVersion) {
      throw new Error('Chưa xác minh version cấu hình Frigate để gửi receipt M4.');
    }
    // Revision theo thời gian track, không dùng epoch milliseconds vượt INTEGER của DB.
    const revision = Math.round(after.frame_time * 1_000 - event.detected_at.getTime()) + 1;
    if (!Number.isSafeInteger(revision) || revision < 1 || revision > MAX_RECEIPT_REVISION) {
      throw new Error('Thời gian observation M4 nằm ngoài phạm vi revision hợp lệ.');
    }
    for (const zone of zones) {
      const dto = this.toSubmission(event, after, camera, zone, configVersion, revision);
      await this.aiResultsService.submit(event.id, dto);
    }
  }

  private toSubmission(
    event: EventRecord,
    after: FrigateEventAfterDto,
    camera: CameraRecord,
    zone: ZoneRecord,
    configVersion: number,
    revision: number,
  ): SubmitAiResultDto {
    const observationId = `zone:${zone.id}`;
    const resultId = resultUuid(`${event.id}:${observationId}:${revision}:${configVersion}`);
    return {
      schemaVersion: 1,
      resultId,
      eventId: event.id,
      observationId,
      revision,
      module: 'M4_ZONE',
      modelVersion: `${ZONE_RULE_VERSION}:config-${configVersion}`,
      processedAt: new Date(after.frame_time * 1_000).toISOString(),
      results: [
        {
          module: 'M4_ZONE',
          label: 'RESTRICTED_ZONE',
          confidence: after.score,
          boundingBox: null,
          metadata: {
            cameraId: camera.id,
            zoneId: zone.id,
            zoneNameSnapshot: zone.name,
            trackId: after.id,
            observedAt: new Date(after.frame_time * 1_000).toISOString(),
            enteredAt: null,
            dwellSeconds: null,
            dwellEvidence: 'FRIGATE_CURRENT_ZONE_LOITERING',
            minDwellSeconds: zone.min_dwell_seconds,
            scheduleActive: true,
            zoneConfigVersion: configVersion,
            scoreSource: 'FRIGATE_PERSON_DETECTION',
          },
        },
      ],
      error: null,
    };
  }
}
