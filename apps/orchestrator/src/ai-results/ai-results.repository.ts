import { Injectable } from '@nestjs/common';
import type { EventStatus, EventType, PersonStatus, PriorityLevel } from '@cam/contracts';
import type { PoolClient, QueryResultRow } from 'pg';
import { DatabaseService } from '../database/database.service';
import { aggregateAiResult } from './ai-result.aggregator';
import type {
  AiResultProjectionItem,
  ApplyAiResultResult,
  EscalationRulePriority,
  ValidatedAiResultSubmission,
} from './ai-result.types';

interface AiEventRow extends QueryResultRow {
  id: string;
  camera_id: string | null;
  zone_id: string | null;
  event_type: EventType;
  status: EventStatus;
  priority: PriorityLevel;
  track_id: string | null;
  ai_label: string | null;
  confidence: string | null;
  ai_model_version: string | null;
  ai_processed_at: Date | null;
  ai_results: unknown;
  person_status: PersonStatus | null;
  matched_known_face_id: string | null;
  aggregate_version: string;
  correlation_id: string;
}

interface ReceiptRow extends QueryResultRow {
  event_id: string;
  payload_hash: string;
  status: 'PENDING' | 'PROCESSED' | 'IGNORED';
}

interface RevisionRow extends QueryResultRow {
  revision: number;
}

interface BooleanRow extends QueryResultRow {
  exists: boolean;
}

interface UpdatedEventRow extends QueryResultRow {
  aggregate_version: string;
}

export interface AiResultOutboxRow extends QueryResultRow {
  id: string;
  event_id: string;
  aggregate_version: string;
  message_type: 'event.updated' | 'evaluate-escalation';
  payload: unknown;
}

export interface AiEscalationSnapshot extends QueryResultRow {
  event_type: EventType;
  status: EventStatus;
  detected_at: Date;
  confidence: string | null;
  ai_label: string | null;
  aggregate_version: string;
}

export class AiResultEventNotFoundError extends Error {}
export class AiResultIdempotencyConflictError extends Error {}

function parseProjectionItems(value: unknown): AiResultProjectionItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is AiResultProjectionItem => {
    if (!item || typeof item !== 'object') return false;
    const candidate = item as Partial<AiResultProjectionItem>;
    return (
      typeof candidate.resultId === 'string' &&
      typeof candidate.observationId === 'string' &&
      typeof candidate.revision === 'number' &&
      typeof candidate.module === 'string' &&
      typeof candidate.modelVersion === 'string' &&
      typeof candidate.processedAt === 'string' &&
      (candidate.status === 'SUCCESS' || candidate.status === 'ERROR')
    );
  });
}

@Injectable()
export class AiResultsRepository {
  constructor(private readonly database: DatabaseService) {}

  async applyResult(
    submission: ValidatedAiResultSubmission,
    payloadHash: string,
    payload: Record<string, unknown>,
  ): Promise<ApplyAiResultResult> {
    return await this.database.transaction(async (client) => {
      const event = await this.lockEvent(client, submission.eventId);
      if (!event) throw new AiResultEventNotFoundError(submission.eventId);

      const receiptInserted = await this.insertReceipt(client, submission, payloadHash, payload);
      if (!receiptInserted) {
        return await this.resolveDuplicate(client, submission, payloadHash, event);
      }

      const staleReason = await this.getStaleReason(client, event, submission);
      if (staleReason) {
        await this.markReceiptIgnored(client, submission.resultId, staleReason);
        return this.result(submission, event, 'STALE');
      }

      const rules = await this.listRulePriorities(client);
      const currentResults = parseProjectionItems(event.ai_results);
      const projection = aggregateAiResult(
        {
          eventType: event.event_type,
          status: event.status,
          priority: event.priority,
          aiLabel: event.ai_label,
          confidence: event.confidence === null ? null : Number(event.confidence),
          aiModelVersion: event.ai_model_version,
          aiProcessedAt: event.ai_processed_at?.toISOString() ?? null,
          aiResults: currentResults,
        },
        submission.results,
        rules,
      );
      const nextStatus = this.nextStatus(event.status, submission, projection.candidates.length);
      const updatedVersion = await this.updateEvent(
        client,
        event,
        submission,
        projection,
        nextStatus,
      );
      await this.writeStatusHistory(client, event, nextStatus, submission.resultId);
      await this.insertOutboxMessages(
        client,
        submission.eventId,
        updatedVersion,
        projection.candidates,
      );
      await this.markReceiptProcessed(client, submission.resultId);

      return {
        resultId: submission.resultId,
        disposition: 'ACCEPTED',
        aggregateVersion: updatedVersion,
        eventId: submission.eventId,
        correlationId: event.correlation_id,
      };
    });
  }

  async claimOutboxMessage(leaseSeconds: number): Promise<AiResultOutboxRow | null> {
    return await this.database.transaction(async (client) => {
      const result = await client.query<AiResultOutboxRow>(
        `WITH next_message AS (
           SELECT candidate.id
           FROM outbox_messages candidate
           WHERE candidate.message_type IN ('event.updated', 'evaluate-escalation')
             AND candidate.available_at <= now()
             AND (
               candidate.status = 'PENDING' OR
               (candidate.status = 'PROCESSING' AND candidate.leased_until < now())
             )
             AND NOT EXISTS (
               SELECT 1
               FROM outbox_messages earlier
               WHERE earlier.event_id = candidate.event_id
                 AND earlier.message_type = 'evaluate-escalation'
                 AND earlier.status <> 'PROCESSED'
                 AND (
                   earlier.aggregate_version < candidate.aggregate_version OR
                   (earlier.aggregate_version = candidate.aggregate_version
                    AND candidate.message_type = 'event.updated')
                 )
             )
           ORDER BY candidate.created_at ASC, candidate.id ASC
           LIMIT 1
           FOR UPDATE SKIP LOCKED
         )
         UPDATE outbox_messages outbox
         SET status = 'PROCESSING',
             attempt_count = attempt_count + 1,
             leased_until = now() + ($1 * interval '1 second')
         FROM next_message
         WHERE outbox.id = next_message.id
         RETURNING outbox.id, outbox.event_id, outbox.aggregate_version,
                   outbox.message_type, outbox.payload;`,
        [leaseSeconds],
      );
      return result.rows[0] ?? null;
    });
  }

  async findEscalationSnapshot(eventId: string): Promise<AiEscalationSnapshot | null> {
    const result = await this.database.query<AiEscalationSnapshot>(
      `SELECT event_type, status, detected_at, confidence, ai_label, aggregate_version
       FROM events
       WHERE id = $1
       LIMIT 1;`,
      [eventId],
    );
    return result.rows[0] ?? null;
  }

  async markOutboxProcessed(messageId: string): Promise<void> {
    await this.database.query(
      `UPDATE outbox_messages
       SET status = 'PROCESSED', processed_at = now(), leased_until = NULL, last_error = NULL
       WHERE id = $1;`,
      [messageId],
    );
  }

  async releaseOutboxMessage(
    messageId: string,
    retrySeconds: number,
    error: string,
  ): Promise<void> {
    await this.database.query(
      `UPDATE outbox_messages
       SET status = 'PENDING',
           available_at = now() + ($2 * interval '1 second'),
           leased_until = NULL,
           last_error = $3
       WHERE id = $1;`,
      [messageId, retrySeconds, error.slice(0, 500)],
    );
  }

  private async lockEvent(client: PoolClient, eventId: string): Promise<AiEventRow | null> {
    const result = await client.query<AiEventRow>(
      `SELECT id,
              camera_id,
              zone_id,
              event_type,
              status,
              priority,
              track_id,
              ai_label,
              confidence,
              ai_model_version,
              ai_processed_at,
              ai_results,
              person_status,
              matched_known_face_id,
              aggregate_version,
              correlation_id
       FROM events
       WHERE id = $1
       LIMIT 1
       FOR UPDATE;`,
      [eventId],
    );
    return result.rows[0] ?? null;
  }

  private async insertReceipt(
    client: PoolClient,
    submission: ValidatedAiResultSubmission,
    payloadHash: string,
    payload: Record<string, unknown>,
  ): Promise<boolean> {
    const result = await client.query(
      `INSERT INTO event_ai_result_receipts (
         result_id, event_id, request_id, module, observation_id, revision, payload_hash, payload
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (result_id) DO NOTHING
       RETURNING result_id;`,
      [
        submission.resultId,
        submission.eventId,
        submission.requestId,
        submission.module,
        submission.observationId,
        submission.revision,
        payloadHash,
        JSON.stringify(payload),
      ],
    );
    return result.rowCount === 1;
  }

  private async resolveDuplicate(
    client: PoolClient,
    submission: ValidatedAiResultSubmission,
    payloadHash: string,
    event: AiEventRow,
  ): Promise<ApplyAiResultResult> {
    const result = await client.query<ReceiptRow>(
      `SELECT event_id, payload_hash, status
       FROM event_ai_result_receipts
       WHERE result_id = $1
       LIMIT 1;`,
      [submission.resultId],
    );
    const receipt = result.rows[0];
    if (
      !receipt ||
      receipt.event_id !== submission.eventId ||
      receipt.payload_hash !== payloadHash
    ) {
      throw new AiResultIdempotencyConflictError(submission.resultId);
    }
    return this.result(submission, event, receipt.status === 'IGNORED' ? 'STALE' : 'DUPLICATE');
  }

  private async getStaleReason(
    client: PoolClient,
    event: AiEventRow,
    submission: ValidatedAiResultSubmission,
  ): Promise<string | null> {
    if (event.status === 'RESOLVED' || event.status === 'CLOSED') {
      return 'EVENT_TERMINAL';
    }
    const revisionResult = await client.query<RevisionRow>(
      `SELECT revision
       FROM event_ai_result_receipts
       WHERE event_id = $1
         AND module = $2
         AND observation_id = $3
         AND status = 'PROCESSED'
       ORDER BY revision DESC
       LIMIT 1;`,
      [submission.eventId, submission.module, submission.observationId],
    );
    if ((revisionResult.rows[0]?.revision ?? 0) >= submission.revision) {
      return 'STALE_REVISION';
    }
    if (submission.matchedKnownFaceId) {
      const faceIsAvailable = await this.knownFaceBelongsToEventOwner(
        client,
        submission.matchedKnownFaceId,
        event.camera_id,
      );
      if (!faceIsAvailable) return 'KNOWN_FACE_NOT_AVAILABLE';
    }
    if (submission.module === 'M4_ZONE') {
      return await this.validateZoneScope(client, event, submission);
    }
    return null;
  }

  private async knownFaceBelongsToEventOwner(
    client: PoolClient,
    knownFaceId: string,
    cameraId: string | null,
  ): Promise<boolean> {
    if (!cameraId) return false;
    const result = await client.query<BooleanRow>(
      `SELECT EXISTS (
         SELECT 1
         FROM known_faces kf
         JOIN cameras c ON c.id = $2
         JOIN devices d ON d.id = c.device_id
         WHERE kf.id = $1
           AND kf.owner_user_id = d.owner_user_id
           AND kf.is_active = true
       ) AS exists;`,
      [knownFaceId, cameraId],
    );
    return result.rows[0]?.exists ?? false;
  }

  private async validateZoneScope(
    client: PoolClient,
    event: AiEventRow,
    submission: ValidatedAiResultSubmission,
  ): Promise<string | null> {
    const metadata = submission.results[0]?.metadata;
    const zoneId = metadata?.zoneId;
    const cameraId = metadata?.cameraId;
    const trackId = metadata?.trackId;
    if (typeof zoneId !== 'string' || cameraId !== event.camera_id || trackId !== event.track_id) {
      return 'ZONE_SCOPE_MISMATCH';
    }
    const result = await client.query<BooleanRow>(
      `SELECT EXISTS (
         SELECT 1
         FROM zones
         WHERE id = $1
           AND camera_id = $2
           AND zone_type = 'RESTRICTED'
           AND is_enabled = true
       ) AS exists;`,
      [zoneId, cameraId],
    );
    return result.rows[0]?.exists ? null : 'ZONE_NOT_AVAILABLE';
  }

  private async listRulePriorities(client: PoolClient): Promise<EscalationRulePriority[]> {
    const result = await client.query<
      QueryResultRow & { event_type: EventType; priority: PriorityLevel }
    >(
      `SELECT event_type, priority
       FROM escalation_rules
       WHERE is_enabled = true
       ORDER BY event_type
       LIMIT 20;`,
    );
    return result.rows.map((row) => ({ eventType: row.event_type, priority: row.priority }));
  }

  private nextStatus(
    currentStatus: EventStatus,
    submission: ValidatedAiResultSubmission,
    candidateCount: number,
  ): EventStatus {
    if (currentStatus === 'RESOLVED' || currentStatus === 'CLOSED') return currentStatus;
    if (submission.error && submission.module === 'M1_FACE' && candidateCount === 0) {
      return currentStatus === 'DETECTED' ? 'AI_FAILED' : currentStatus;
    }
    if (currentStatus === 'AI_FAILED' && !submission.error) return 'DETECTED';
    return currentStatus;
  }

  private async updateEvent(
    client: PoolClient,
    event: AiEventRow,
    submission: ValidatedAiResultSubmission,
    projection: ReturnType<typeof aggregateAiResult>,
    nextStatus: EventStatus,
  ): Promise<number> {
    const shouldUpdatePerson = submission.module === 'M1_FACE' && !submission.error;
    const result = await client.query<UpdatedEventRow>(
      `UPDATE events
       SET event_type = $2,
           status = $3,
           priority = $4,
           ai_label = $5,
           confidence = $6,
           ai_model_version = $7,
           ai_processed_at = $8,
           ai_results = $9,
           person_status = CASE WHEN $10 THEN $11::person_status ELSE person_status END,
           matched_known_face_id = CASE WHEN $10 THEN $12::uuid ELSE matched_known_face_id END,
           aggregate_version = aggregate_version + 1
       WHERE id = $1
       RETURNING aggregate_version;`,
      [
        event.id,
        projection.eventType,
        nextStatus,
        projection.priority,
        projection.aiLabel,
        projection.confidence,
        projection.aiModelVersion,
        projection.aiProcessedAt,
        JSON.stringify(projection.aiResults),
        shouldUpdatePerson,
        submission.personStatus,
        submission.matchedKnownFaceId,
      ],
    );
    return Number(result.rows[0]?.aggregate_version ?? Number(event.aggregate_version) + 1);
  }

  private async writeStatusHistory(
    client: PoolClient,
    event: AiEventRow,
    nextStatus: EventStatus,
    resultId: string,
  ): Promise<void> {
    if (event.status === nextStatus) return;
    await client.query(
      `INSERT INTO event_status_history (
         event_id, from_status, to_status, reason, actor_type, metadata
       ) VALUES ($1, $2, $3, 'AI_RESULT', 'SYSTEM', $4);`,
      [event.id, event.status, nextStatus, JSON.stringify({ resultId })],
    );
  }

  private async insertOutboxMessages(
    client: PoolClient,
    eventId: string,
    aggregateVersion: number,
    candidates: ReturnType<typeof aggregateAiResult>['candidates'],
  ): Promise<void> {
    const messages = [
      { messageType: 'event.updated', payload: { eventId, aggregateVersion } },
      {
        messageType: 'evaluate-escalation',
        payload: {
          schemaVersion: 1,
          evaluationId: `${eventId}:${aggregateVersion}`,
          eventId,
          aggregateVersion,
          candidates,
        },
      },
    ];
    for (const message of messages) {
      await client.query(
        `INSERT INTO outbox_messages (
           event_id, aggregate_version, message_type, payload
         ) VALUES ($1, $2, $3, $4)
         ON CONFLICT (event_id, aggregate_version, message_type) DO NOTHING;`,
        [eventId, aggregateVersion, message.messageType, JSON.stringify(message.payload)],
      );
    }
  }

  private async markReceiptProcessed(client: PoolClient, resultId: string): Promise<void> {
    await client.query(
      `UPDATE event_ai_result_receipts
       SET status = 'PROCESSED', processed_at = now()
       WHERE result_id = $1;`,
      [resultId],
    );
  }

  private async markReceiptIgnored(
    client: PoolClient,
    resultId: string,
    reason: string,
  ): Promise<void> {
    await client.query(
      `UPDATE event_ai_result_receipts
       SET status = 'IGNORED', ignored_reason = $2, processed_at = now()
       WHERE result_id = $1;`,
      [resultId, reason],
    );
  }

  private result(
    submission: ValidatedAiResultSubmission,
    event: AiEventRow,
    disposition: 'DUPLICATE' | 'STALE',
  ): ApplyAiResultResult {
    return {
      resultId: submission.resultId,
      disposition,
      aggregateVersion: Number(event.aggregate_version),
      eventId: submission.eventId,
      correlationId: event.correlation_id,
    };
  }
}
