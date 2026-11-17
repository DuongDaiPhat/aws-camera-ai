import { playbackLimit } from './playback-config';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PlaybackRepository } from './playback.repository';
import {
  RECORDING_ARCHIVE,
  type RecordingArchive,
  type PlaybackActor,
  type PlaybackCamera,
  type ArchiveCamera,
  type RecordingDay,
  type RecordingSegment,
  type ArchiveInterval,
} from './playback.types';
import { recordingDayBounds } from './playback-time';
export function recordingSegments(
  intervals: ArchiveInterval[],
  start: number,
  end: number,
  maxSeconds: number,
): RecordingSegment[] {
  const merged: ArchiveInterval[] = [];
  for (const raw of intervals) {
    const item = { ...raw, start: Math.max(start, raw.start), end: Math.min(end, raw.end) };
    if (item.start >= item.end) continue;
    const previous = merged[merged.length - 1];
    if (previous && item.start <= previous.end) {
      previous.end = Math.max(previous.end, item.end);
      previous.motion ||= item.motion;
    } else merged.push(item);
  }
  const segments: RecordingSegment[] = [];
  for (const item of merged)
    for (let at = item.start; at < item.end; at += maxSeconds) {
      const to = Math.min(at + maxSeconds, item.end);
      segments.push({
        id: String(at),
        startAt: new Date(at * 1000).toISOString(),
        endAt: new Date(to * 1000).toISOString(),
        durationSeconds: to - at,
        hasMotion: item.motion,
      });
    }
  return segments;
}
@Injectable()
export class PlaybackService {
  constructor(
    private readonly repo: PlaybackRepository,
    @Inject(RECORDING_ARCHIVE) private readonly archive: RecordingArchive,
    private readonly config: ConfigService,
  ) {}
  async cameras(actor: PlaybackActor): Promise<{ data: PlaybackCamera[] }> {
    const rows = await this.repo.cameras(actor);
    return { data: rows.map(({ slug: _slug, ...camera }) => camera) };
  }
  async authorizedCamera(actor: PlaybackActor, id: string): Promise<ArchiveCamera> {
    const [camera] = await this.repo.cameras(actor, id);
    if (!camera) throw new NotFoundException('Không tìm thấy camera được phép xem lại.');
    return camera;
  }
  async day(actor: PlaybackActor, id: string, date: string): Promise<RecordingDay> {
    const camera = await this.authorizedCamera(actor, id);
    const { start, end } = recordingDayBounds(date, camera.timeZone);
    const now = Date.now() / 1000;
    const records =
      start > now ? [] : await this.archive.list(camera.slug, start, Math.min(end, now));
    const receiving = this.archive.receivingFrames
      ? await this.archive.receivingFrames(camera.slug).catch(() => null)
      : null;
    return {
      sourceStatus: receiving === null ? 'unavailable' : receiving ? 'receiving' : 'no_frames',
      recordingEnabled: camera.recordingEnabled,
      retentionDays: camera.retentionDays,
      isFutureDate: start > now,
      cameraId: id,
      date,
      timeZone: camera.timeZone,
      dayStartAt: new Date(start * 1000).toISOString(),
      dayEndAt: new Date(end * 1000).toISOString(),
      segments: recordingSegments(
        records,
        start,
        Math.min(end, now),
        playbackLimit(this.config, 'PLAYBACK_MAX_CLIP_SECONDS', 120),
      ),
    };
  }
  async clip(actor: PlaybackActor, id: string, startAt: string, endAt: string): Promise<Buffer> {
    const camera = await this.authorizedCamera(actor, id);
    const start = Date.parse(startAt) / 1000,
      end = Date.parse(endAt) / 1000;
    const max = playbackLimit(this.config, 'PLAYBACK_MAX_CLIP_SECONDS', 120);
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start >= end ||
      end - start > max ||
      end > Date.now() / 1000
    )
      throw new BadRequestException('Khoảng phát lại không hợp lệ.');
    const rows = await this.archive.list(camera.slug, start, end);
    let covered = start;
    for (const row of rows) {
      if (row.start > covered) break;
      covered = Math.max(covered, row.end);
      if (covered >= end) break;
    }
    // ISO dates have millisecond precision; accept only sub-millisecond rounding, never a recording gap.
    const ROUNDING_SECONDS = 0.001;
    if (covered + ROUNDING_SECONDS < end)
      throw new NotFoundException('Khoảng này không có đủ bản ghi hoặc đã hết thời gian lưu.');
    return this.archive.clip(camera.slug, start, end);
  }
}
