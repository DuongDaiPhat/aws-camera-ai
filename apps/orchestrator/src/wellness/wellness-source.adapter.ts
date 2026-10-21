import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import type { SubmitAiResultDto } from '../ai-results/dto/submit-ai-result.dto';
import { WellnessRepository } from './wellness.repository';
import { WellnessService } from './wellness.service';
import { wellnessInteger } from './wellness-policy';
import type { WellnessObservationDto } from './dto';

interface Boundary {
  cameraSlug: string;
  boundaryId: string;
  axis: 'x' | 'y';
  position: number;
  inside: 'less' | 'greater';
  policyVersion: string;
}
interface Side {
  inside: boolean;
  pending: boolean;
  count: number;
  at: number;
}
export function sourceObservationId(value: string): string {
  const h = createHash('sha256').update(value).digest('hex');
  return (
    h.slice(0, 8) +
    '-' +
    h.slice(8, 12) +
    '-5' +
    h.slice(13, 16) +
    '-a' +
    h.slice(17, 20) +
    '-' +
    h.slice(20, 32)
  );
}
@Injectable()
export class WellnessSourceAdapter {
  private readonly logger = new Logger(WellnessSourceAdapter.name);
  private readonly ttl: number;
  private readonly boundaries: Boundary[];
  private readonly sides = new Map<string, Side>();
  private pending: unknown[] = [];
  private draining = false;
  private lastPrunedAt = 0;
  private readonly maxAgeSeconds: number;
  private readonly clockSkewMs: number;
  private readonly directionSamples: number;
  private readonly boundaryMargin: number;
  private readonly maxStates: number;
  private readonly maxPendingFrames: number;
  private readonly maxObjects: number;
  private readonly pruneIntervalMs: number;
  private readonly pruneBatchSize: number;
  constructor(
    private readonly repository: WellnessRepository,
    private readonly wellness: WellnessService,
    config: ConfigService,
  ) {
    this.ttl = wellnessInteger(config, 'WELLNESS_IDENTITY_LINK_TTL_SECONDS', 30, 300);
    this.maxAgeSeconds = wellnessInteger(config, 'WELLNESS_OBSERVATION_MAX_AGE_SECONDS', 86400);
    this.clockSkewMs = wellnessInteger(config, 'WELLNESS_CLOCK_SKEW_SECONDS', 5, 60) * 1000;
    this.directionSamples = wellnessInteger(config, 'WELLNESS_DIRECTION_SAMPLES', 2, 10);
    this.boundaryMargin = Number(config.get('WELLNESS_BOUNDARY_MARGIN', 0.01));
    if (
      !Number.isFinite(this.boundaryMargin) ||
      this.boundaryMargin <= 0 ||
      this.boundaryMargin >= 0.25
    )
      throw new Error('WELLNESS_BOUNDARY_MARGIN must be >0 and <0.25.');
    this.maxStates = wellnessInteger(config, 'WELLNESS_MAX_TRACK_STATES', 2048, 100000);
    this.maxPendingFrames = wellnessInteger(config, 'WELLNESS_MAX_PENDING_FRAMES', 2, 50);
    this.maxObjects = wellnessInteger(config, 'WELLNESS_MAX_FRAME_OBJECTS', 64, 512);
    this.pruneIntervalMs = wellnessInteger(
      config,
      'WELLNESS_SOURCE_PRUNE_INTERVAL_MS',
      60000,
      3600000,
    );
    this.pruneBatchSize = wellnessInteger(
      config,
      'WELLNESS_SOURCE_PRUNE_BATCH_SIZE',
      10000,
      100000,
    );
    const parsed: unknown = JSON.parse(config.get<string>('WELLNESS_BOUNDARIES_JSON', '[]'));
    if (!Array.isArray(parsed) || parsed.length > 100)
      throw new Error('WELLNESS_BOUNDARIES_JSON must be an array of at most 100 boundaries.');
    for (const item of parsed)
      if (
        !item ||
        typeof item.cameraSlug !== 'string' ||
        typeof item.boundaryId !== 'string' ||
        !['x', 'y'].includes(item.axis) ||
        !['less', 'greater'].includes(item.inside) ||
        typeof item.policyVersion !== 'string' ||
        !Number.isFinite(item.position) ||
        item.position <= 0 ||
        item.position >= 1
      )
        throw new Error('Invalid wellness boundary configuration.');
    this.boundaries = parsed as Boundary[];
  }
  enqueueFrame(payload: unknown): void {
    // Independent bounded queue; live telemetry never waits for DB/identity work.
    if (this.pending.length >= this.maxPendingFrames) {
      this.pending.shift();
      this.logger.warn('Wellness metadata queue dropped an old frame');
    }
    this.pending.push(payload);
    if (!this.draining) void this.drain();
  }
  private async drain(): Promise<void> {
    this.draining = true;
    try {
      while (this.pending.length) {
        try {
          await this.acceptFrame(this.pending.shift());
        } catch (error) {
          this.logger.error('Wellness source metadata failed', error);
        }
      }
    } finally {
      this.draining = false;
    }
  }
  async associateIdentity(dto: SubmitAiResultDto): Promise<void> {
    if (
      dto.module !== 'M1_FACE' ||
      dto.personStatus !== 'KNOWN' ||
      dto.error ||
      !dto.matchedKnownFaceId
    )
      return;
    const session = dto.results[0]?.metadata?.sourceSessionId;
    if (typeof session !== 'string' || !session || session.length > 128) return;
    const associated = await this.repository.transaction(async (client) => {
      const row = (
        await client.query(
          `SELECT e.camera_id,e.track_id,e.person_status,d.owner_user_id,k.linked_user_id,k.id AS face_id
        FROM events e JOIN cameras c ON c.id=e.camera_id JOIN devices d ON d.id=c.device_id
        JOIN known_faces k ON k.id=$2 JOIN users u ON u.id=k.linked_user_id
        WHERE e.id=$1 AND e.person_status='KNOWN' AND e.matched_known_face_id=k.id AND k.owner_user_id=d.owner_user_id
          AND k.is_active AND u.is_active AND c.is_enabled`,
          [dto.eventId, dto.matchedKnownFaceId],
        )
      ).rows[0];
      if (!row) return null;
      const now = await this.repository.databaseNow(client),
        observed = new Date(dto.processedAt);
      if (
        !Number.isFinite(observed.getTime()) ||
        observed.getTime() > now.getTime() + this.clockSkewMs ||
        now.getTime() - observed.getTime() > this.ttl * 1000
      )
        return null;
      await client.query(
        `INSERT INTO resident_wellness_track_links(camera_id,source_session_id,track_id,owner_user_id,
        resident_user_id,known_face_id,identity_event_id,observed_at,valid_until)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT(camera_id,source_session_id,track_id) DO UPDATE SET owner_user_id=EXCLUDED.owner_user_id,
          resident_user_id=EXCLUDED.resident_user_id,known_face_id=EXCLUDED.known_face_id,identity_event_id=EXCLUDED.identity_event_id,
          observed_at=EXCLUDED.observed_at,valid_until=EXCLUDED.valid_until
        WHERE EXCLUDED.observed_at>resident_wellness_track_links.observed_at`,
        [
          row.camera_id,
          session,
          row.track_id,
          row.owner_user_id,
          row.linked_user_id,
          row.face_id,
          dto.eventId,
          observed,
          new Date(observed.getTime() + this.ttl * 1000),
        ],
      );
      return { camera: row.camera_id as string, track: row.track_id as string };
    });
    if (associated) await this.flush(associated.camera, session, associated.track);
  }
  private direction(key: string, inside: boolean, at: number): 'ARRIVAL' | 'DEPARTURE' | null {
    const previous = this.sides.get(key);
    if (previous && at <= previous.at) return null;
    if (!previous) {
      while (this.sides.size >= this.maxStates) this.sides.delete(this.sides.keys().next().value!);
      this.sides.set(key, { inside, pending: inside, count: 0, at });
      return null;
    }
    previous.at = at;
    if (previous.inside === inside) {
      previous.count = 0;
      return null;
    }
    previous.count = previous.pending === inside ? previous.count + 1 : 1;
    previous.pending = inside;
    if (previous.count < this.directionSamples) return null;
    previous.inside = inside;
    previous.count = 0;
    return inside ? 'ARRIVAL' : 'DEPARTURE';
  }
  async acceptFrame(payload: unknown): Promise<void> {
    if (!payload || typeof payload !== 'object') return;
    const data = payload as Record<string, unknown>;
    if (
      typeof data.camera !== 'string' ||
      !Array.isArray(data.objects) ||
      data.objects.length > this.maxObjects
    )
      return;
    const context = await this.repository.transaction(async (client) => {
      const camera = (
        await client.query(
          `SELECT c.id,c.detect_width,c.detect_height FROM cameras c
        JOIN devices d ON d.id=c.device_id WHERE c.slug=$1 AND c.is_enabled`,
          [data.camera],
        )
      ).rows[0];
      return { camera, now: await this.repository.databaseNow(client) };
    });
    if (!context.camera) return;
    const now = context.now.getTime();
    if (now - this.lastPrunedAt >= this.pruneIntervalMs) {
      await this.repository.transaction(async (client) => {
        await client.query(
          `DELETE FROM resident_wellness_source_evidence WHERE observation_id IN
          (SELECT observation_id FROM resident_wellness_source_evidence WHERE observed_at<$1 ORDER BY observed_at LIMIT $2)`,
          [new Date(now - this.maxAgeSeconds * 1000), this.pruneBatchSize],
        );
        await client.query(
          `DELETE FROM resident_wellness_track_links WHERE (camera_id,source_session_id,track_id) IN
          (SELECT camera_id,source_session_id,track_id FROM resident_wellness_track_links WHERE valid_until<$1 ORDER BY valid_until LIMIT $2)`,
          [new Date(now - this.maxAgeSeconds * 1000), this.pruneBatchSize],
        );
      });
      this.lastPrunedAt = now;
    }
    for (const [key, value] of this.sides)
      if (now - value.at > this.ttl * 1000) this.sides.delete(key);
    while (this.sides.size > this.maxStates) this.sides.delete(this.sides.keys().next().value!);
    for (const raw of data.objects) {
      if (!raw || typeof raw !== 'object') continue;
      const object = raw as Record<string, unknown>;
      const observed = Number(object.observedAt) * 1000;
      if (
        object.label !== 'person' ||
        object.isMoving !== true ||
        typeof object.id !== 'string' ||
        typeof object.sourceSessionId !== 'string' ||
        !object.sourceSessionId ||
        object.sourceSessionId.length > 128 ||
        !Number.isFinite(observed) ||
        observed > now + this.clockSkewMs ||
        observed < now - this.ttl * 1000
      )
        continue;
      const kinds: {
        kind: 'MOTION' | 'ARRIVAL' | 'DEPARTURE';
        directionalEvidence?: {
          boundaryId: string;
          direction: 'ENTER' | 'EXIT';
          policyVersion: string;
        };
      }[] = [];
      if (
        Array.isArray(object.box) &&
        object.box.length === 4 &&
        object.box.every((v) => typeof v === 'number' && Number.isFinite(v))
      ) {
        const values = object.box as number[];
        const normalized = values.every((v) => v >= 0 && v <= 1);
        const x =
          (values[0] + values[2]) / 2 / (normalized ? 1 : Number(context.camera.detect_width));
        const y =
          (values[1] + values[3]) / 2 / (normalized ? 1 : Number(context.camera.detect_height));
        for (const boundary of this.boundaries.filter((b) => b.cameraSlug === data.camera)) {
          const position = boundary.axis === 'x' ? x : y;
          if (
            !Number.isFinite(position) ||
            position < 0 ||
            position > 1 ||
            Math.abs(position - boundary.position) < this.boundaryMargin
          )
            continue;
          const inside =
            boundary.inside === 'less'
              ? position < boundary.position
              : position > boundary.position;
          const kind = this.direction(
            [context.camera.id, object.sourceSessionId, object.id, boundary.boundaryId].join(':'),
            inside,
            observed,
          );
          if (kind)
            kinds.push({
              kind,
              directionalEvidence: {
                boundaryId: boundary.boundaryId,
                direction: kind === 'ARRIVAL' ? 'ENTER' : 'EXIT',
                policyVersion: boundary.policyVersion,
              },
            });
        }
      }
      if (!kinds.length) kinds.push({ kind: 'MOTION' });
      for (const entry of kinds)
        await this.repository.transaction(async (client) => {
          const id = sourceObservationId(
            JSON.stringify([
              context.camera.id,
              object.sourceSessionId,
              object.id,
              observed,
              entry.kind,
              entry.directionalEvidence?.boundaryId ?? null,
            ]),
          );
          await client.query(
            `INSERT INTO resident_wellness_source_evidence(observation_id,camera_id,source_session_id,track_id,kind,observed_at,evidence)
          VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT(observation_id) DO NOTHING`,
            [
              id,
              context.camera.id,
              object.sourceSessionId,
              object.id,
              entry.kind,
              new Date(observed),
              JSON.stringify({
                source: 'FRIGATE_METADATA',
                isMoving: true,
                ...(entry.directionalEvidence
                  ? { directionalEvidence: entry.directionalEvidence }
                  : {}),
              }),
            ],
          );
        });
      await this.flush(context.camera.id, object.sourceSessionId, object.id);
    }
  }
  private async flush(camera: string, session: string, track: string): Promise<void> {
    const records = await this.repository.transaction(
      async (client) =>
        (
          await client.query(
            `SELECT s.*,l.owner_user_id,l.resident_user_id,l.known_face_id,l.identity_event_id
      FROM resident_wellness_source_evidence s JOIN resident_wellness_track_links l
        ON l.camera_id=s.camera_id AND l.source_session_id=s.source_session_id AND l.track_id=s.track_id
      WHERE s.camera_id=$1 AND s.source_session_id=$2 AND s.track_id=$3 AND s.observed_at BETWEEN l.observed_at AND l.valid_until
        AND NOT EXISTS(SELECT 1 FROM resident_wellness_observations o WHERE o.observation_id=s.observation_id)
      ORDER BY s.observed_at LIMIT 100`,
            [camera, session, track],
          )
        ).rows,
    );
    for (const record of records)
      await this.wellness.submitObservation({
        observationId: record.observation_id,
        ownerUserId: record.owner_user_id,
        residentUserId: record.resident_user_id,
        knownFaceId: record.known_face_id,
        identityEventId: record.identity_event_id,
        cameraId: camera,
        sourceSessionId: session,
        trackId: track,
        kind: record.kind,
        observedAt: new Date(record.observed_at).toISOString(),
        ...(record.evidence.directionalEvidence
          ? { directionalEvidence: record.evidence.directionalEvidence }
          : {}),
      } as WellnessObservationDto);
  }
}
