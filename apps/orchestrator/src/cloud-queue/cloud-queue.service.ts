import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  BadRequestException,
  NotFoundException,
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  SQSClient,
  SendMessageCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
} from '@aws-sdk/client-sqs';
import { DatabaseService } from '../database/database.service';
import { FrigateMediaAdapter } from '../media/frigate-media.adapter';
import { STORAGE_SERVICE, IStorageService } from '../storage/storage.interface';
import { AiResultsService } from '../ai-results/ai-results.service';
import { SubmitAiResultDto } from '../ai-results/dto/submit-ai-result.dto';
import { readCloudConfig } from './cloud-config';
import { Envelope, FaceJobEnvelope, parseEnvelope } from './queue-contract';

@Injectable()
export class CloudQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CloudQueueService.name);
  private readonly settings;
  private readonly sqs?: SQSClient;
  private stopped = false;
  private running?: Promise<void>;
  private delay?: ReturnType<typeof setTimeout>;
  private wake?: () => void;
  constructor(
    config: ConfigService,
    private readonly db: DatabaseService,
    private readonly media: FrigateMediaAdapter,
    @Inject(STORAGE_SERVICE) private readonly storage: IStorageService,
    private readonly ai: AiResultsService,
  ) {
    this.settings = readCloudConfig(config);
    if (this.settings.mode === 'sqs')
      this.sqs = new SQSClient({ region: this.settings.region, maxAttempts: 3 });
  }
  async onModuleInit() {
    const result = await this.db.query('SELECT mode FROM cloud_transport_mode WHERE singleton');
    if (result.rows[0]?.mode !== this.settings.mode)
      throw new Error(
        'FACE_JOB_TRANSPORT differs from DB cloud_transport_mode; stop all instances before changing transport',
      );
    if (this.sqs) this.running = this.loop();
  }
  async onModuleDestroy() {
    this.stopped = true;
    if (this.delay) clearTimeout(this.delay);
    this.wake?.();
    await this.running;
    this.sqs?.destroy();
  }
  private async loop() {
    while (!this.stopped) {
      let operation = 'dispatch';
      try {
        await this.dispatchOne();
        operation = 'receive-results';
        await this.consumeOnce();
      } catch (error) {
        const code =
          error instanceof Error ? ('code' in error ? error.code : error.name) : undefined;
        const safeCode =
          typeof code === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(code) ? code : 'unknown';
        this.logger.error(
          `Cloud queue iteration failed (${operation}, ${safeCode}); retrying without acknowledging input`,
        );
      }
      if (!this.stopped)
        await new Promise<void>((resolve) => {
          this.wake = resolve;
          this.delay = setTimeout(resolve, 1000);
        });
    }
  }
  async dispatchOne() {
    if (!this.sqs || this.settings.mode !== 'sqs') return;
    const settings = this.settings;
    await this.db.transaction(async (client) => {
      const selected =
        await client.query(`SELECT j.*, e.track_id, e.detected_at, camera.slug AS camera_slug, c.collection_id, c.version
    FROM cloud_jobs j JOIN events e ON e.id=j.event_id
    JOIN cameras camera ON camera.id=e.camera_id
    LEFT JOIN cloud_face_collections c ON c.owner_user_id=j.owner_user_id
    WHERE j.status IN ('PREPARING','PENDING') AND j.available_at <= now()
    ORDER BY j.created_at LIMIT 1 FOR UPDATE OF j SKIP LOCKED`);
      const job = selected.rows[0];
      if (!job) return;
      try {
        if (!job.envelope) {
          if (job.kind !== 'face.job' || !job.collection_id)
            throw new Error('Face collection registry missing');
          const crop = await this.media.getCroppedSnapshot(job.track_id);
          if (!crop) throw new Error('Face crop unavailable');
          const key = `owners/${job.owner_user_id}/cameras/${job.camera_id}/events/${job.event_id}/face/${job.id}.jpg`;
          const image = await this.storage.upload(key, crop, 'image/jpeg');
          if (image.bucket !== settings.bucket) throw new Error('Unexpected upload bucket');
          job.envelope = parseEnvelope({
            schemaVersion: 1,
            type: 'face.job',
            messageId: job.id,
            correlationId: job.event_id,
            occurredAt: job.created_at.toISOString(),
            payload: {
              jobId: job.id,
              resultId: job.result_id,
              eventId: job.event_id,
              cameraId: job.camera_id,
              ownerScopeId: job.owner_user_id,
              trackId: job.track_id,
              sourceSessionId: `${job.camera_slug}:${(job.detected_at.getTime() / 1000).toFixed(6)}`,
              observationId: `track:${job.track_id}:face`,
              revision: 1,
              collectionVersion: job.version,
              collectionId: job.collection_id,
              image: { bucket: image.bucket, key: image.key },
            },
          });
          // Persist before sending. Next iteration sends exactly this envelope.
          await client.query(
            `UPDATE cloud_jobs SET envelope=$2,status='PENDING',attempts=0,last_error=NULL WHERE id=$1`,
            [job.id, JSON.stringify(job.envelope)],
          );
          return;
        }
        await this.sqs!.send(
          new SendMessageCommand({
            QueueUrl: job.kind === 'face.job' ? settings.faceQueue : settings.notificationQueue,
            MessageBody: JSON.stringify(job.envelope),
          }),
        );
        await client.query(`UPDATE cloud_jobs SET status='SENT',last_error=NULL WHERE id=$1`, [
          job.id,
        ]);
      } catch (error) {
        const knownReasons = [
          'Face collection registry missing',
          'Face crop unavailable',
          'Unexpected upload bucket',
        ];
        const reason =
          error instanceof Error && knownReasons.includes(error.message)
            ? error.message
            : 'PREPARE_OR_SEND_FAILED';
        this.logger.warn({ jobId: job.id, reason }, 'Cloud job retained for retry');
        await client.query(
          `UPDATE cloud_jobs SET attempts=attempts+1,status=CASE WHEN attempts>=4 THEN 'FAILED' ELSE status END,
     last_error=$2,available_at=now()+interval '30 seconds' WHERE id=$1`,
          [job.id, reason],
        );
      }
    });
  }
  async consumeOnce() {
    if (!this.sqs || this.settings.mode !== 'sqs' || !this.settings.consumerEnabled) return;
    const response = await this.sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: this.settings.resultsQueue,
        MaxNumberOfMessages: 5,
        WaitTimeSeconds: 2,
        VisibilityTimeout: 120,
      }),
    );
    for (const item of response.Messages ?? []) {
      try {
        await this.applyResult(parseEnvelope(JSON.parse(item.Body ?? '')));
        await this.sqs.send(
          new DeleteMessageCommand({
            QueueUrl: this.settings.resultsQueue,
            ReceiptHandle: item.ReceiptHandle,
          }),
        );
      } catch {
        this.logger.warn({ messageId: item.MessageId }, 'Results input retained for retry/redrive');
      }
    }
  }
  async applyResult(message: Envelope) {
    if (message.type !== 'face.result' && message.type !== 'notification.outcome')
      throw new Error('Unexpected Results type');
    await this.db.transaction(async (client) => {
      const p = message.payload;
      const jobId =
        message.type === 'face.result' ? message.payload.jobId : message.payload.notificationId;
      const found = await client.query(
        `SELECT j.*, d.owner_user_id AS current_owner, c.version AS current_collection_version
    FROM cloud_jobs j JOIN events e ON e.id=j.event_id
    JOIN cameras camera ON camera.id=e.camera_id JOIN devices d ON d.id=camera.device_id
    LEFT JOIN cloud_face_collections c ON c.owner_user_id=j.owner_user_id
    WHERE j.id=$1 FOR UPDATE OF j`,
        [jobId],
      );
      const job = found.rows[0];
      if (
        !job ||
        job.owner_user_id !== p.ownerScopeId ||
        job.current_owner !== p.ownerScopeId ||
        job.event_id !== message.correlationId
      )
        throw new Error('Result ownership/job mismatch');
      const receipt = await client.query(
        'SELECT envelope=$2::jsonb AS identical FROM cloud_result_receipts WHERE id=$1',
        [message.messageId, JSON.stringify(message)],
      );
      if (receipt.rows.length) {
        if (!receipt.rows[0].identical) throw new Error('Result ID payload conflict');
        return;
      }
      let disposition = 'PROCESSED';
      if (message.type === 'face.result') {
        const p = message.payload;
        const body = p.body as SubmitAiResultDto;
        const sent = job.envelope?.payload;
        if (
          job.kind !== 'face.job' ||
          !sent ||
          job.result_id !== body.resultId ||
          job.camera_id !== p.cameraId ||
          body.eventId !== job.event_id ||
          body.observationId !== sent.observationId ||
          body.revision !== sent.revision ||
          body.collectionVersion !== sent.collectionVersion
        )
          throw new Error('Face result job/version mismatch');
        // Require the durable, first-writer-wins worker result; blocks envelope tampering.
        const same = await client.query(
          'SELECT cached_result=$2::jsonb AS identical FROM cloud_jobs WHERE id=$1',
          [job.id, JSON.stringify(message)],
        );
        if (!same.rows[0]?.identical) throw new Error('Result differs from durable worker result');
        disposition =
          body.collectionVersion === job.current_collection_version
            ? (await this.ai.submit(body.eventId, body, client)).disposition
            : 'STALE';
      } else if (job.kind !== 'notification.job') throw new Error('Notification job mismatch');
      await client.query(
        'INSERT INTO cloud_result_receipts(id,job_id,envelope,disposition) VALUES($1,$2,$3,$4)',
        [message.messageId, job.id, JSON.stringify(message), disposition],
      );
      if (message.type === 'notification.outcome') {
        const p = message.payload;
        await client.query(
          `INSERT INTO cloud_notification_outcomes(outcome_id,notification_id,attempt_id,status,provider_called,provider_id,reason)
     VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [
            p.outcomeId,
            p.notificationId,
            p.attemptId,
            p.status,
            p.providerCalled,
            p.providerId,
            p.reason,
          ],
        );
      }
    });
  }
  // Call inside the transaction creating the notification intent. The caller owns
  // claim/lease/cap policy; this transport never grants permission to contact anyone.
  async enqueueNotification(
    client: PoolClient,
    input: {
      notificationId: string;
      eventId: string;
      ownerScopeId: string;
      expectedEventVersion: number;
      channel: 'SNS_EMAIL' | 'SNS_SMS' | 'CONNECT_CALL';
    },
  ) {
    if (this.settings.mode !== 'sqs') throw new Error('Notification SQS transport not enabled');
    const envelope = parseEnvelope({
      schemaVersion: 1,
      type: 'notification.job',
      messageId: input.notificationId,
      correlationId: input.eventId,
      occurredAt: new Date().toISOString(),
      payload: input,
    });
    const result = await client.query(
      `INSERT INTO cloud_jobs(id,result_id,event_id,kind,owner_user_id,camera_id,envelope,status)
   SELECT $1,$2,e.id,'notification.job',$3,e.camera_id,$4,'PENDING'
   FROM events e JOIN cameras c ON c.id=e.camera_id JOIN devices d ON d.id=c.device_id
   WHERE e.id=$5 AND d.owner_user_id=$3 AND e.aggregate_version=$6
   ON CONFLICT(id) DO NOTHING RETURNING id`,
      [
        input.notificationId,
        randomUUID(),
        input.ownerScopeId,
        JSON.stringify(envelope),
        input.eventId,
        input.expectedEventVersion,
      ],
    );
    if (!result.rows.length)
      throw new Error('Notification intent duplicate or ownership/version mismatch');
  }
  async faceContext(id: string) {
    const result = await this.db.query(
      `SELECT j.envelope,j.cached_result FROM cloud_jobs j
   JOIN cameras c ON c.id=j.camera_id JOIN devices d ON d.id=c.device_id
   JOIN cloud_face_collections fc ON fc.owner_user_id=j.owner_user_id
   WHERE j.id=$1 AND j.kind='face.job' AND d.owner_user_id=j.owner_user_id
    AND fc.version=(j.envelope->'payload'->>'collectionVersion')::integer`,
      [id],
    );
    if (!result.rows[0]?.envelope) throw new NotFoundException('Face job missing or stale');
    const mappings = await this.db.query(
      `SELECT m.face_id,m.known_face_id FROM cloud_face_mappings m
   JOIN known_faces k ON k.id=m.known_face_id
   JOIN cloud_jobs j ON j.owner_user_id=m.owner_user_id
   WHERE j.id=$1 AND k.owner_user_id=m.owner_user_id AND k.is_active`,
      [id],
    );
    return {
      envelope: result.rows[0].envelope as FaceJobEnvelope,
      cached_result: result.rows[0].cached_result as Envelope | null,
      mappings: Object.fromEntries(mappings.rows.map((row) => [row.face_id, row.known_face_id])),
    };
  }
  async cacheFaceResult(id: string, value: unknown) {
    let message: Envelope;
    try {
      message = parseEnvelope(value);
    } catch {
      throw new BadRequestException('Invalid queue result contract');
    }
    const context = await this.faceContext(id);
    if (
      message.type !== 'face.result' ||
      message.payload.jobId !== id ||
      message.payload.body.resultId !== context.envelope.payload.resultId ||
      message.payload.body.eventId !== context.envelope.payload.eventId ||
      message.payload.body.observationId !== context.envelope.payload.observationId ||
      message.payload.body.revision !== context.envelope.payload.revision ||
      message.payload.body.collectionVersion !== context.envelope.payload.collectionVersion ||
      message.correlationId !== context.envelope.correlationId ||
      message.payload.ownerScopeId !== context.envelope.payload.ownerScopeId ||
      message.payload.cameraId !== context.envelope.payload.cameraId
    )
      throw new BadRequestException('Worker result mismatch');
    const result = await this.db.query(
      `UPDATE cloud_jobs SET cached_result=COALESCE(cached_result,$2::jsonb) WHERE id=$1 RETURNING cached_result`,
      [id, JSON.stringify(message)],
    );
    return result.rows[0]!.cached_result;
  }
}
