import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { components } from '@cam/contracts';
import { PlaybackService } from './playback.service';
import { PlaybackFramesRepository, type HistoricalEvent } from './playback-frames.repository';
import { normalizedBox, isRecord } from './playback-frame.codec';
import { playbackLimit } from './playback-config';
import type { PlaybackActor } from './playback.types';
type Metadata = components['schemas']['PlaybackMetadata'];
function incidentFrame(item: unknown): Metadata['frames'][number] | null {
  if (!isRecord(item) || item.status !== 'SUCCESS' || !isRecord(item.metadata)) return null;
  const kind =
    item.label === 'FALL_DETECTED' ? 'fall' : item.label === 'FIRE_SMOKE_DETECTED' ? 'fire' : null;
  const at = item.metadata.confirmedAt;
  if (!kind || typeof at !== 'string' || !Number.isFinite(Date.parse(at))) return null;
  const box = normalizedBox(item.boundingBox, kind, item.confidence);
  return box ? { at, boxes: [box] } : null;
}
export function incidentMetadata(rows: HistoricalEvent[]): Metadata {
  const output: Metadata = { frames: [], events: [], toleranceMs: 0 };
  for (const row of rows) {
    const label =
      row.event_type === 'FALL_DETECTED'
        ? 'fall'
        : row.event_type === 'FIRE_SMOKE_DETECTED'
          ? 'fire'
          : 'person';
    output.events.push({ id: row.id, label, at: row.detected_at.toISOString() });
    if (!Array.isArray(row.ai_results)) continue;
    for (const item of row.ai_results) {
      const frame = incidentFrame(item);
      if (frame) output.frames.push(frame);
    }
  }
  return output;
}
@Injectable()
export class PlaybackMetadataService {
  constructor(
    private readonly playback: PlaybackService,
    private readonly repo: PlaybackFramesRepository,
    private readonly config: ConfigService,
  ) {}
  async interval(
    actor: PlaybackActor,
    id: string,
    startAt: string,
    endAt: string,
  ): Promise<Metadata> {
    await this.playback.authorizedCamera(actor, id);
    const start = Date.parse(startAt),
      end = Date.parse(endAt),
      max = playbackLimit(this.config, 'PLAYBACK_MAX_CLIP_SECONDS', 120) * 1000;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end || end - start > max)
      throw new BadRequestException('Khoảng nhận diện không hợp lệ.');
    const toleranceMs = playbackLimit(this.config, 'PLAYBACK_METADATA_TOLERANCE_MS', 600);
    const [frames, events] = await Promise.all([
      this.repo.frames(
        id,
        start - toleranceMs,
        end + toleranceMs,
        playbackLimit(this.config, 'PLAYBACK_METADATA_QUERY_LIMIT', 1000),
      ),
      this.repo.events(
        id,
        start - toleranceMs,
        end + toleranceMs,
        playbackLimit(this.config, 'PLAYBACK_METADATA_EVENT_LIMIT', 200),
      ),
    ]);
    const incidents = incidentMetadata(events);
    return {
      toleranceMs,
      events: incidents.events,
      frames: [
        ...frames.map((frame) => ({ at: frame.at.toISOString(), boxes: frame.boxes })),
        ...incidents.frames,
      ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)),
    };
  }
}
