import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import type { PoolClient } from 'pg';
import type { SubmitAiResultDto } from '../ai-results/dto/submit-ai-result.dto';
import type { ConfirmedFireResponse } from './fire.dto';

interface CameraRow {
  id: string;
}
interface IncidentRow {
  id: string;
  event_id: string;
  camera_id: string;
  confirmed_at: Date;
}
export interface FireIncident {
  id: string;
  eventId: string;
  cameraId: string;
  created: boolean;
}
export interface FirePendingDelivery {
  id: string;
  event_id: string;
  pending_payload: unknown;
  lease_token: string;
}
export interface FireClearProof {
  startedAt: Date;
  observedAt: Date;
}
export interface FireMediaWork {
  id: string;
  event_id: string;
  camera_slug: string;
  confirmed_at: Date;
  first_qualified_at: Date;
}

@Injectable()
export class FireIncidentsRepository {
  constructor(private readonly database: DatabaseService) {}

  async listEnabledCameras(limit: number): Promise<{ slug: string }[]> {
    const result = await this.database.query<{ slug: string }>(
      'SELECT slug FROM cameras WHERE is_enabled AND detection_enabled ORDER BY slug LIMIT $1',
      [limit],
    );
    return result.rows;
  }

  async findEnabledCamera(slug: string): Promise<string | null> {
    const result = await this.database.query<CameraRow>(
      'SELECT id FROM cameras WHERE slug = $1 AND is_enabled AND detection_enabled',
      [slug],
    );
    return result.rows[0]?.id ?? null;
  }

  async confirm(
    cameraId: string,
    evidence: ConfirmedFireResponse,
    payload: SubmitAiResultDto,
  ): Promise<FireIncident | null> {
    return this.database.transaction(async (client) => {
      const camera = await client.query<CameraRow>(
        'SELECT id FROM cameras WHERE id = $1 AND is_enabled AND detection_enabled FOR UPDATE',
        [cameraId],
      );
      if (!camera.rows[0]) return null;
      const existing = await client.query<IncidentRow>(
        `SELECT id, event_id, camera_id, confirmed_at FROM fire_incidents
         WHERE camera_id = $1 AND (observed_clear_at IS NULL OR (source_session_id = $2 AND episode_id = $3))
         ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
        [cameraId, evidence.sourceSessionId, evidence.episodeId],
      );
      const previous = existing.rows[0];
      if (previous)
        return { id: previous.id, eventId: previous.event_id, cameraId, created: false };
      const stale = await client.query<{ found: boolean }>(
        'SELECT true AS found FROM fire_incidents WHERE camera_id = $1 AND observed_clear_at >= $2 LIMIT 1',
        [cameraId, evidence.firstQualifiedAt],
      );
      if (stale.rows[0]) return null;
      return this.insertIncident(client, cameraId, evidence, payload);
    });
  }

  private async insertIncident(
    client: PoolClient,
    cameraId: string,
    evidence: ConfirmedFireResponse,
    payload: SubmitAiResultDto,
  ): Promise<FireIncident> {
    await client.query(
      `INSERT INTO events (id, camera_id, event_type, priority, source, detected_at, dedup_key)
         VALUES ($1, $2, 'FIRE_SMOKE_DETECTED', 'P0', 'AI_SERVICE', $3, $4)`,
      [
        payload.eventId,
        cameraId,
        evidence.confirmedAt,
        `fire:${cameraId}:${evidence.sourceSessionId}:${evidence.episodeId}`,
      ],
    );
    const id = randomUUID();
    await client.query(
      `INSERT INTO fire_incidents (id, camera_id, source_session_id, episode_id, event_id,
           first_qualified_at, confirmed_at, model_version, rule_snapshot, result_id, pending_payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11::jsonb)`,
      [
        id,
        cameraId,
        evidence.sourceSessionId,
        evidence.episodeId,
        payload.eventId,
        evidence.firstQualifiedAt,
        evidence.confirmedAt,
        evidence.modelVersion,
        JSON.stringify({
          thresholdUsed: evidence.thresholdUsed,
          requiredFrames: evidence.requiredFrames,
          windowSeconds: evidence.windowSeconds,
          maxFrameGapSeconds: evidence.maxFrameGapSeconds,
          confidencePolicyVersion: evidence.confidencePolicyVersion,
        }),
        payload.resultId,
        JSON.stringify(payload),
      ],
    );
    await client.query(
      `INSERT INTO event_status_history (event_id, from_status, to_status, actor_type, reason)
        VALUES ($1, NULL, 'DETECTED', 'SYSTEM', 'Confirmed camera fire/smoke episode')`,
      [payload.eventId],
    );
    return { id, eventId: payload.eventId, cameraId, created: true };
  }

  async clearActive(cameraId: string, proof: FireClearProof): Promise<void> {
    await this.database.transaction(async (client) => {
      const camera = await client.query<CameraRow>(
        'SELECT id FROM cameras WHERE id = $1 AND is_enabled AND detection_enabled FOR UPDATE',
        [cameraId],
      );
      if (!camera.rows[0]) return;
      await client.query(
        `UPDATE fire_incidents SET observed_clear_at = $2
        WHERE camera_id = $1 AND observed_clear_at IS NULL AND confirmed_at <= $3`,
        [cameraId, proof.observedAt, proof.startedAt],
      );
    });
  }

  async claim(leaseSeconds: number): Promise<FirePendingDelivery | null> {
    const token = randomUUID();
    const result = await this.database.query<FirePendingDelivery>(
      `WITH next_incident AS (
         SELECT id FROM fire_incidents WHERE available_at <= now()
           AND (delivery_status = 'PENDING' OR (delivery_status = 'PROCESSING' AND leased_until < now()))
         ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
       UPDATE fire_incidents i SET delivery_status = 'PROCESSING', leased_until = now() + $1 * interval '1 second',
         lease_token = $2, attempt_count = attempt_count + 1 FROM next_incident n WHERE i.id = n.id
       RETURNING i.id, i.event_id, i.pending_payload, i.lease_token`,
      [leaseSeconds, token],
    );
    return result.rows[0] ?? null;
  }

  async claimMedia(
    readySeconds: number,
    retrySeconds: number,
    maxAgeDays: number,
  ): Promise<FireMediaWork | null> {
    const result = await this.database.query<FireMediaWork>(
      `WITH next_media AS (
        SELECT i.id, c.slug AS camera_slug FROM fire_incidents i JOIN cameras c ON c.id=i.camera_id
        WHERE i.delivery_status='APPLIED' AND i.available_at <= now()
          AND i.confirmed_at <= now() - $1 * interval '1 second'
          AND i.confirmed_at >= now() - $3 * interval '1 day'
          AND (NOT EXISTS (SELECT 1 FROM event_media m WHERE m.event_id=i.event_id AND m.media_type='CLIP')
            OR NOT EXISTS (SELECT 1 FROM event_media m WHERE m.event_id=i.event_id AND m.media_type='SNAPSHOT'))
        ORDER BY i.available_at, i.created_at LIMIT 1 FOR UPDATE OF i SKIP LOCKED)
       UPDATE fire_incidents i SET available_at=now() + $2 * interval '1 second'
       FROM next_media n WHERE i.id=n.id RETURNING i.id, i.event_id, i.first_qualified_at, i.confirmed_at, n.camera_slug`,
      [readySeconds, retrySeconds, maxAgeDays],
    );
    return result.rows[0] ?? null;
  }

  async applied(work: FirePendingDelivery): Promise<void> {
    await this.database.query(
      `UPDATE fire_incidents SET delivery_status = 'APPLIED', applied_at = now(),
      leased_until = NULL, lease_token = NULL, last_error = NULL WHERE id = $1 AND lease_token = $2`,
      [work.id, work.lease_token],
    );
  }

  async retry(work: FirePendingDelivery, retrySeconds: number, code: string): Promise<void> {
    await this.database.query(
      `UPDATE fire_incidents SET delivery_status = 'PENDING', leased_until = NULL,
      lease_token = NULL, available_at = now() + $3 * interval '1 second', last_error = $4
      WHERE id = $1 AND lease_token = $2`,
      [work.id, work.lease_token, retrySeconds, code],
    );
  }
}
