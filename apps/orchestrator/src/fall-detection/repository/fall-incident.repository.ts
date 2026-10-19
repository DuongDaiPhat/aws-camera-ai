import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Pool } from 'pg';
import { PG_POOL } from '../../database/database.module';
import type { SubmitAiResultDto } from '../../ai-results/dto/submit-ai-result.dto';

export interface FallIncidentRecord {
  id: string;
  camera_id: string;
  source_session_id: string;
  track_id: string;
  episode_id: string;
  event_id: string;
  candidate_started_at: Date;
  confirmed_at: Date;
  model_version: string;
  rule_snapshot: Record<string, unknown>;
  result_id: string;
  pending_payload: SubmitAiResultDto;
  delivery_status: 'PENDING' | 'PROCESSING' | 'APPLIED';
  applied_at: Date | null;
}

export interface CreateFallIncidentInput {
  cameraId: string;
  sourceSessionId: string;
  trackId: string;
  episodeId: string;
  candidateStartedAt: Date;
  confirmedAt: Date;
  modelVersion: string;
  ruleSnapshot: Record<string, unknown>;
  resultId: string;
  pendingPayload: SubmitAiResultDto;
}

export interface SavedFallIncidentResult {
  eventId: string;
  fallIncidentId: string;
  resultId: string;
  isNew: boolean;
  pendingPayload: SubmitAiResultDto;
  deliveryStatus: FallIncidentRecord['delivery_status'];
}

@Injectable()
export class FallIncidentRepository {
  private readonly logger = new Logger(FallIncidentRepository.name);

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /**
   * Tạo sự kiện FALL_DETECTED P1 và lưu bản ghi fall_incidents trong cùng một transaction.
   * Khử trùng lặp an toàn theo episode (camera_id, source_session_id, track_id, episode_id).
   */
  async createConfirmedIncident(input: CreateFallIncidentInput): Promise<SavedFallIncidentResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Serialize the first insert too, when there is no incident row to lock yet.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        JSON.stringify([input.cameraId, input.sourceSessionId, input.trackId, input.episodeId]),
      ]);

      // Kiểm tra xem incident đã tồn tại hay chưa
      const existing = await client.query<FallIncidentRecord>(
        `SELECT id, event_id, result_id, pending_payload, delivery_status FROM fall_incidents
         WHERE camera_id = $1 AND source_session_id = $2 AND track_id = $3 AND episode_id = $4
         LIMIT 1 FOR UPDATE`,
        [input.cameraId, input.sourceSessionId, input.trackId, input.episodeId],
      );

      if (existing.rows.length > 0) {
        await client.query('COMMIT');
        return {
          eventId: existing.rows[0].event_id,
          fallIncidentId: existing.rows[0].id,
          resultId: existing.rows[0].result_id,
          isNew: false,
          pendingPayload: existing.rows[0].pending_payload,
          deliveryStatus: existing.rows[0].delivery_status,
        };
      }

      const candidateStartedAt = input.candidateStartedAt;
      if (input.confirmedAt.getTime() <= candidateStartedAt.getTime()) {
        throw new Error('Invalid fall evidence time order');
      }

      const dedupKey = `m2a-fall:${input.cameraId}:${input.sourceSessionId}:${input.trackId}:${input.episodeId}`;

      // 1. Tạo sự kiện FALL_DETECTED với Priority P1
      const eventInsertResult = await client.query<{ id: string }>(
        `INSERT INTO events (
           camera_id, event_type, status, priority, source, track_id,
           dedup_key, confidence, ai_results, detected_at, correlation_id
         ) VALUES (
           $1, 'FALL_DETECTED', 'DETECTED', 'P1', 'AI_SERVICE', $2,
           $3, 1.0, '[]'::jsonb, $4, gen_random_uuid()
         )
         ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL DO UPDATE SET updated_at = now()
         RETURNING id`,
        [input.cameraId, input.trackId, dedupKey, input.confirmedAt],
      );
      const eventId = eventInsertResult.rows[0].id;
      const pendingPayload: SubmitAiResultDto = { ...input.pendingPayload, eventId };

      // 2. Tạo bản ghi fall_incidents
      const incidentInsertResult = await client.query<{ id: string }>(
        `INSERT INTO fall_incidents (
           camera_id, source_session_id, track_id, episode_id, event_id,
           candidate_started_at, confirmed_at, model_version, rule_snapshot,
           result_id, pending_payload, delivery_status
         ) VALUES (
           $1, $2, $3, $4, $5,
           $6, $7, $8, $9::jsonb,
           $10, $11::jsonb, 'PENDING'
         )
         RETURNING id`,
        [
          input.cameraId,
          input.sourceSessionId,
          input.trackId,
          input.episodeId,
          eventId,
          candidateStartedAt,
          input.confirmedAt,
          input.modelVersion,
          JSON.stringify(input.ruleSnapshot),
          input.resultId,
          JSON.stringify(pendingPayload),
        ],
      );
      const fallIncidentId = incidentInsertResult.rows[0].id;

      await client.query('COMMIT');

      this.logger.log(
        `Đã tạo incident té ngã (event: ${eventId}, incident: ${fallIncidentId}, episode: ${input.episodeId})`,
      );

      return {
        eventId,
        fallIncidentId,
        resultId: input.resultId,
        isNew: true,
        pendingPayload,
        deliveryStatus: 'PENDING',
      };
    } catch (error) {
      await client.query('ROLLBACK');
      this.logger.error(`Lỗi transaction khi lưu confirmed fall incident:`, error);
      throw error;
    } finally {
      client.release();
    }
  }

  async markApplied(incidentId: string, leaseToken?: string): Promise<void> {
    await this.pool.query(
      `UPDATE fall_incidents
       SET delivery_status = 'APPLIED', applied_at = now(), updated_at = now(),
           leased_until = NULL, lease_token = NULL, last_error = NULL
       WHERE id = $1 AND ($2::uuid IS NULL OR lease_token = $2::uuid)`,
      [incidentId, leaseToken ?? null],
    );
  }

  async claimPending(): Promise<(FallIncidentRecord & { lease_token: string }) | null> {
    const result = await this.pool.query<FallIncidentRecord & { lease_token: string }>(
      `WITH next AS (
         SELECT id FROM fall_incidents
         WHERE (delivery_status = 'PENDING' AND available_at <= now())
            OR (delivery_status = 'PROCESSING' AND leased_until <= now())
         ORDER BY available_at, created_at LIMIT 1 FOR UPDATE SKIP LOCKED
       )
       UPDATE fall_incidents f
       SET delivery_status = 'PROCESSING', leased_until = now() + interval '30 seconds',
           lease_token = gen_random_uuid(), attempt_count = attempt_count + 1
       FROM next WHERE f.id = next.id
       RETURNING f.id, f.event_id, f.result_id, f.pending_payload, f.lease_token`,
    );
    return result.rows[0] ?? null;
  }

  async releaseForRetry(incidentId: string, leaseToken: string, error: string): Promise<void> {
    await this.pool.query(
      `UPDATE fall_incidents SET delivery_status = 'PENDING',
         available_at = now() + interval '5 seconds', leased_until = NULL,
         lease_token = NULL, last_error = $3
       WHERE id = $1 AND lease_token = $2 AND delivery_status = 'PROCESSING'`,
      [incidentId, leaseToken, error.slice(0, 500)],
    );
  }
}
