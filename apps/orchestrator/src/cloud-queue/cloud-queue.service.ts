import { imageFormat } from '../media/image-format';
import type { PoolClient } from 'pg';
import {
  BadRequestException,
  NotFoundException,
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  SQSClient,
  SQSServiceException,
  SendMessageCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
} from '@aws-sdk/client-sqs';
import { DatabaseService } from '../database/database.service';
import { FrigateMediaAdapter } from '../media/frigate-media.adapter';
import { IStorageService, S3_EXPIRE_7D_TAG, STORAGE_SERVICE } from '../storage/storage.interface';
import { buildRekognitionCollectionId } from '../known-faces/face-config';
import { AiResultsService } from '../ai-results/ai-results.service';
import { SubmitAiResultDto } from '../ai-results/dto/submit-ai-result.dto';
import { readCloudConfig } from './cloud-config';
import { Envelope, FaceJobEnvelope, parseEnvelope } from './queue-contract';
import { NotificationCloudService } from '../notification-cloud/notification-cloud.service';

const SQS_SEND_REJECTED = 'SQS_SEND_REJECTED';

function isDefiniteSqsRejection(error: unknown): boolean {
  // A final denial after SDK retries does not rule out acceptance of an earlier request.
  return (
    error instanceof SQSServiceException &&
    error.$fault === 'client' &&
    error.$metadata.attempts === 1 &&
    [400, 403].includes(error.$metadata.httpStatusCode ?? 0) &&
    ['AccessDenied', 'AccessDeniedException'].includes(error.name)
  );
}

export interface RecognitionResultNotification {
  eventId: string;
  cameraSlug?: string;
  cameraId?: string;
  ownerScopeId: string;
  trackId: string;
  collectionVersion: number;
  revision: number;
  personStatus: 'KNOWN' | 'UNKNOWN' | 'UNDETERMINED';
  matchedKnownFaceId?: string | null;
  matchedPersonName?: string | null;
  similarity?: number | null;
  errorCode?: string | null;
  disposition?: 'ACCEPTED' | 'DUPLICATE' | 'STALE';
}

export interface FaceRecognitionResultListener {
  onRecognitionResult(result: RecognitionResultNotification): void | Promise<void>;
}

export interface EnqueueFaceJobInput {
  eventId: string;
  cameraId: string;
  ownerScopeId: string;
  trackId: string;
  sourceSessionId: string;
  revision: number;
  imageBuffer?: Buffer;
}

export interface EnqueueFaceJobResult {
  created: boolean;
  jobId: string | null;
  status: 'PREPARING' | 'PENDING' | null;
}

const KNOWN_PREPARE_REASONS = [
  'Face collection registry missing',
  'Face collection prefix mismatch',
  'Face crop unavailable',
  'Unexpected upload bucket',
] as const;

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
    private readonly notifications: NotificationCloudService,
    @Optional() private coordinator?: FaceRecognitionResultListener,
  ) {
    this.settings = readCloudConfig(config);
    if (this.settings.enabled)
      this.sqs = new SQSClient({ region: this.settings.region, maxAttempts: 3 });
  }

  registerRecognitionResultListener(listener: FaceRecognitionResultListener): void {
    this.coordinator = listener;
  }

  private wakeLoop(): void {
    if (this.delay) {
      clearTimeout(this.delay);
      this.delay = undefined;
    }
    this.wake?.();
  }
  async onModuleInit() {
    const result = await this.db.query(
      'SELECT mode, notification_driver FROM cloud_transport_mode WHERE singleton',
    );
    if (result.rows[0]?.mode !== this.settings.mode)
      throw new Error(
        'FACE_JOB_TRANSPORT differs from DB cloud_transport_mode; stop all instances before changing transport',
      );
    if ((result.rows[0]?.notification_driver ?? 'local') !== this.settings.notificationDriver)
      throw new Error(
        'NOTIFICATION_DRIVER differs from DB cloud_transport_mode; stop all instances before changing transport',
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
  private async buildUploadedFaceJobEnvelope(input: {
    jobId: string;
    resultId: string;
    eventId: string;
    cameraId: string;
    ownerScopeId: string;
    trackId: string;
    sourceSessionId: string;
    revision: number;
    collectionId: string | null | undefined;
    collectionVersion: number;
    retain: boolean;
    createdAt: Date;
    crop: Buffer;
  }): Promise<FaceJobEnvelope> {
    if (!this.settings.enabled || this.settings.mode !== 'sqs')
      throw new Error('Face SQS transport not enabled');
    const settings = this.settings;
    if (!input.collectionId) {
      throw new Error('Face collection registry missing');
    }
    const expectedCollectionId = buildRekognitionCollectionId(
      settings.rekognitionCollectionPrefix,
      input.ownerScopeId,
    );
    if (input.collectionId !== expectedCollectionId) {
      throw new Error('Face collection prefix mismatch');
    }
    const format = imageFormat(input.crop);
    // The queue contract fixes this key suffix; MIME describes the actual bytes.
    const key = `owners/${input.ownerScopeId}/cameras/${input.cameraId}/events/${input.eventId}/face/${input.jobId}.jpg`;
    const image = await this.storage.upload(
      key,
      input.crop,
      format.contentType,
      input.retain ? { retain: true } : { tags: S3_EXPIRE_7D_TAG },
    );
    if (image.bucket !== settings.bucket) throw new Error('Unexpected upload bucket');
    return parseEnvelope({
      schemaVersion: 1,
      type: 'face.job',
      messageId: input.jobId,
      correlationId: input.eventId,
      occurredAt: input.createdAt.toISOString(),
      payload: {
        jobId: input.jobId,
        resultId: input.resultId,
        eventId: input.eventId,
        cameraId: input.cameraId,
        ownerScopeId: input.ownerScopeId,
        trackId: input.trackId,
        sourceSessionId: input.sourceSessionId,
        observationId: `track:${input.trackId}:face`,
        revision: input.revision,
        collectionVersion: input.collectionVersion,
        collectionId: input.collectionId,
        image: { bucket: image.bucket, key: image.key },
      },
    }) as FaceJobEnvelope;
  }

  private toPrepareFailureReason(error: unknown): string {
    return error instanceof Error &&
      (KNOWN_PREPARE_REASONS as readonly string[]).includes(error.message)
      ? error.message
      : 'PREPARE_OR_SEND_FAILED';
  }

  async enqueueFaceJob(input: EnqueueFaceJobInput): Promise<EnqueueFaceJobResult> {
    if (this.settings.mode !== 'sqs') throw new Error('Face SQS transport not enabled');
    const hasBestShot = Boolean(input.imageBuffer && input.imageBuffer.length > 0);
    const inserted = await this.db.query(
      `INSERT INTO cloud_jobs(event_id,kind,owner_user_id,camera_id,revision,available_at)
       VALUES($1,'face.job',$2,$3,$4,CASE WHEN $5 THEN now() + interval '15 seconds' ELSE now() END)
       ON CONFLICT(event_id,revision) WHERE kind='face.job' DO NOTHING
       RETURNING *`,
      [input.eventId, input.ownerScopeId, input.cameraId, input.revision, hasBestShot],
    );
    const job = inserted.rows[0];
    if (!job) {
      return { created: false, jobId: null, status: null };
    }
    if (!hasBestShot || !input.imageBuffer) {
      this.wakeLoop();
      return { created: true, jobId: job.id as string, status: 'PREPARING' };
    }

    try {
      const meta = await this.db.query(
        `SELECT c.collection_id, c.version, e.retain
         FROM events e
         LEFT JOIN cloud_face_collections c ON c.owner_user_id = $2
         WHERE e.id = $1
         LIMIT 1`,
        [input.eventId, input.ownerScopeId],
      );
      const row = meta.rows[0];
      const createdAt =
        job.created_at instanceof Date ? job.created_at : new Date(job.created_at ?? Date.now());
      const envelope = await this.buildUploadedFaceJobEnvelope({
        jobId: job.id as string,
        resultId: job.result_id as string,
        eventId: input.eventId,
        cameraId: input.cameraId,
        ownerScopeId: input.ownerScopeId,
        trackId: input.trackId,
        sourceSessionId: input.sourceSessionId,
        revision: input.revision,
        collectionId: row?.collection_id as string | null | undefined,
        collectionVersion: Number(row?.version ?? 1),
        retain: Boolean(row?.retain),
        createdAt,
        crop: input.imageBuffer,
      });
      await this.db.query(
        `UPDATE cloud_jobs
         SET envelope=$2,status='PENDING',available_at=now(),attempts=0,last_error=NULL
         WHERE id=$1`,
        [job.id, JSON.stringify(envelope)],
      );
      this.wakeLoop();
      return { created: true, jobId: job.id as string, status: 'PENDING' };
    } catch (error) {
      const reason = this.toPrepareFailureReason(error);
      this.logger.warn({ jobId: job.id, reason }, 'Face job preparation deferred to retry');
      await this.db.query(
        `UPDATE cloud_jobs
         SET last_error=$2,available_at=now()+interval '30 seconds'
         WHERE id=$1`,
        [job.id, reason],
      );
      return { created: true, jobId: job.id as string, status: 'PREPARING' };
    }
  }

  async dispatchOne() {
    if (!this.sqs || !this.settings.enabled) return;
    const settings = this.settings;
    await this.db.transaction(async (client) => {
      const selected = await client.query(
        `SELECT j.*, e.track_id, e.detected_at, e.retain, camera.slug AS camera_slug, c.collection_id, c.version
    FROM cloud_jobs j JOIN events e ON e.id=j.event_id
    JOIN cameras camera ON camera.id=e.camera_id
    LEFT JOIN cloud_face_collections c ON c.owner_user_id=j.owner_user_id
    WHERE j.status IN ('PREPARING','PENDING') AND j.available_at <= now()
      AND ((j.kind='face.job' AND $1::boolean) OR (j.kind='notification.job' AND $2::boolean))
    ORDER BY j.created_at LIMIT 1 FOR UPDATE OF j SKIP LOCKED`,
        [settings.mode === 'sqs', settings.notificationDriver === 'sqs'],
      );
      const job = selected.rows[0];
      if (!job) return;
      try {
        if (!job.envelope) {
          if (job.kind !== 'face.job' || !job.collection_id)
            throw new Error('Face collection registry missing');
          const crop = await this.media.getCroppedSnapshot(job.track_id);
          if (!crop) throw new Error('Face crop unavailable');
          job.envelope = await this.buildUploadedFaceJobEnvelope({
            jobId: job.id,
            resultId: job.result_id,
            eventId: job.event_id,
            cameraId: job.camera_id,
            ownerScopeId: job.owner_user_id,
            trackId: job.track_id,
            sourceSessionId: `${job.camera_slug}:${(job.detected_at.getTime() / 1000).toFixed(6)}`,
            revision: Number(job.revision ?? 1),
            collectionId: job.collection_id,
            collectionVersion: job.version,
            retain: Boolean(job.retain),
            createdAt: job.created_at,
            crop,
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
          'Face collection prefix mismatch',
          'Face crop unavailable',
          'Unexpected upload bucket',
        ];
        const rejected =
          job.kind === 'notification.job' &&
          (job.attempts === 0 || job.last_error === SQS_SEND_REJECTED) &&
          isDefiniteSqsRejection(error);
        let reason = 'PREPARE_OR_SEND_FAILED';
        if (error instanceof Error && knownReasons.includes(error.message)) reason = error.message;
        if (rejected) reason = SQS_SEND_REJECTED;
        const updated = await client.query<{ status: string }>(
          `UPDATE cloud_jobs SET attempts=attempts+1,status=CASE WHEN attempts>=4 THEN 'FAILED' ELSE status END,
     last_error=$2,available_at=now()+interval '30 seconds' WHERE id=$1 RETURNING status`,
          [job.id, reason],
        );
        const exhausted = updated.rows[0]?.status === 'FAILED';
        if (exhausted && job.kind === 'notification.job') {
          // A worker that already claimed the job may still report its outcome.
          await client.query(
            `WITH delivery AS (
               SELECT $2::boolean AND NOT EXISTS (
                 SELECT 1 FROM cloud_notification_attempts WHERE notification_id = $1
               ) AS rejected
             )
             UPDATE notifications n
             SET status = CASE WHEN delivery.rejected THEN 'FAILED' ELSE 'PENDING' END::notification_status,
                 error_code = CASE WHEN delivery.rejected THEN 'SQS_SEND_REJECTED' ELSE 'UNCERTAIN' END,
                 failed_at = CASE WHEN delivery.rejected THEN clock_timestamp() ELSE NULL END,
                 next_retry_at = NULL
             FROM delivery
             WHERE n.id = $1 AND n.delivery_driver = 'sqs'
               AND n.status = 'PENDING' AND n.error_code IS NULL`,
            [job.id, rejected],
          );
        }
        this.logger.warn(
          { jobId: job.id, reason },
          exhausted ? 'Cloud job exhausted dispatch retries' : 'Cloud job retained for retry',
        );
      }
    });
  }
  async consumeOnce() {
    if (!this.sqs || !this.settings.enabled || !this.settings.consumerEnabled) return;
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
    if (message.type === 'notification.outcome') {
      await this.notifications.applyResult(message);
      return;
    }
    if (message.type !== 'face.result') throw new Error('Unexpected Results type');
    let faceNotification: RecognitionResultNotification | null = null;
    await this.db.transaction(async (client) => {
      const p = message.payload;
      const jobId = message.payload.jobId;
      const found = await client.query(
        `SELECT j.*, d.owner_user_id AS current_owner, c.version AS current_collection_version,
           camera.slug AS camera_slug
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
      const disposition =
        body.collectionVersion === job.current_collection_version
          ? (await this.ai.submit(body.eventId, body, client)).disposition
          : 'STALE';
      const trackIdFromObs =
        typeof sent.observationId === 'string' &&
        sent.observationId.startsWith('track:') &&
        sent.observationId.endsWith(':face')
          ? sent.observationId.slice(6, -5)
          : '';
      const cameraSlugFromSession =
        typeof sent.sourceSessionId === 'string' && sent.sourceSessionId.includes(':')
          ? sent.sourceSessionId.split(':')[0]
          : undefined;
      const firstResult = body.results?.[0];
      const similarity =
        firstResult &&
        typeof firstResult.metadata?.similarity === 'number' &&
        Number.isFinite(firstResult.metadata.similarity)
          ? firstResult.metadata.similarity
          : null;
      faceNotification = {
        eventId: body.eventId,
        cameraSlug: typeof job.camera_slug === 'string' ? job.camera_slug : cameraSlugFromSession,
        cameraId: p.cameraId,
        ownerScopeId: p.ownerScopeId,
        trackId: typeof sent.trackId === 'string' && sent.trackId ? sent.trackId : trackIdFromObs,
        collectionVersion: body.collectionVersion ?? sent.collectionVersion,
        revision: body.revision,
        personStatus: body.personStatus ?? 'UNDETERMINED',
        matchedKnownFaceId: body.matchedKnownFaceId ?? null,
        similarity,
        errorCode: body.error?.code ?? null,
        disposition: disposition as 'ACCEPTED' | 'DUPLICATE' | 'STALE',
      };
      await client.query(
        'INSERT INTO cloud_result_receipts(id,job_id,envelope,disposition) VALUES($1,$2,$3,$4)',
        [message.messageId, job.id, JSON.stringify(message), disposition],
      );
    });
    if (faceNotification && this.coordinator) {
      try {
        await this.coordinator.onRecognitionResult(faceNotification);
      } catch (error) {
        this.logger.warn(
          {
            eventId: (faceNotification as RecognitionResultNotification).eventId,
            error: error instanceof Error ? error.message : 'unknown',
          },
          'Failed to notify face coordinator after result commit',
        );
      }
    }
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
    await this.notifications.enqueueNotification(client, input);
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
      collection_face_count: mappings.rows.length,
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
