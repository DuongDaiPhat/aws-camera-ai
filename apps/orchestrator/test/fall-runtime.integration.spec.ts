import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { connectAsync, MqttClient } from 'mqtt';
import { Pool } from 'pg';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { AiResultValidator } from '../src/ai-results/ai-result.validator';
import { AiResultOutboxService } from '../src/ai-results/ai-result-outbox.service';
import { AiResultsRepository } from '../src/ai-results/ai-results.repository';
import { AiResultsService } from '../src/ai-results/ai-results.service';
import { CamerasRepository } from '../src/cameras/cameras.repository';
import { DatabaseService } from '../src/database/database.service';
import { EscalationEngineService } from '../src/escalation/escalation-engine.service';
import { EscalationRepository } from '../src/escalation/escalation.repository';
import { EscalationRulesRepository } from '../src/escalation-rules/escalation-rules.repository';
import { EventsRepository } from '../src/events/events.repository';
import { EventsService } from '../src/events/events.service';
import { PoseInferenceAdapter } from '../src/fall-detection/adapter/pose-inference.adapter';
import { PoseFrameConsumer } from '../src/fall-detection/consumer/pose-frame.consumer';
import { FallIncidentCoordinator } from '../src/fall-detection/coordinator/fall-incident.coordinator';
import { RestAreaEvaluator } from '../src/fall-detection/evaluator/rest-area.evaluator';
import { FallDeliveryWorker } from '../src/fall-detection/fall-delivery.worker';
import { FallIncidentRepository } from '../src/fall-detection/repository/fall-incident.repository';
import { EventMediaRepository } from '../src/media/event-media.repository';
import { MediaService } from '../src/media/media.service';
import { MinioStorageService } from '../src/storage/minio-storage.service';
import { ZonesRepository } from '../src/zones/zones.repository';

// Positive HTTP inference is scripted here; real-model clips are evaluated separately.
describe('US16/17 production pipeline with PostgreSQL16, MQTT and MinIO', () => {
  jest.setTimeout(120_000);
  const containers: StartedTestContainer[] = [];
  let pool: Pool;
  let mqtt: MqttClient;
  let server: Server;
  let storage: MinioStorageService;
  let media: MediaService;
  let repository: FallIncidentRepository;
  let ai: AiResultsService;
  let coordinator: FallIncidentCoordinator;
  let outbox: AiResultOutboxService;
  let consumer: PoseFrameConsumer;
  let cameraId: string;
  let response: Record<string, unknown>;
  let s3: S3Client;
  const jpeg = Buffer.from(
    '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAb/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCVAJb/2Q==',
    'base64',
  );

  beforeAll(async () => {
    const postgres = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({
        POSTGRES_DB: 'fall_test',
        POSTGRES_USER: 'qa',
        POSTGRES_PASSWORD: 'qa-test-only',
      })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start();
    containers.push(postgres);
    pool = new Pool({
      host: postgres.getHost(),
      port: postgres.getMappedPort(5432),
      database: 'fall_test',
      user: 'qa',
      password: 'qa-test-only',
    });
    const directory = resolve(__dirname, '../../../db/migrations');
    for (const file of (await readdir(directory)).filter((f) => f.endsWith('.sql')).sort()) {
      await pool.query(await readFile(resolve(directory, file), 'utf8'));
    }
    const minio = await new GenericContainer('quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z')
      .withEnvironment({ MINIO_ROOT_USER: 'fall-test', MINIO_ROOT_PASSWORD: 'fall-test-password' })
      .withCommand(['server', '/data'])
      .withExposedPorts(9000)
      .withWaitStrategy(Wait.forHttp('/minio/health/live', 9000))
      .start();
    containers.push(minio);
    const broker = await new GenericContainer('eclipse-mosquitto:2')
      .withCopyContentToContainer([
        {
          content: 'listener 1883 0.0.0.0\nallow_anonymous true\npersistence false\n',
          target: '/mosquitto/config/mosquitto.conf',
        },
      ])
      .withExposedPorts(1883)
      .withWaitStrategy(Wait.forLogMessage(/mosquitto version .* running/))
      .start();
    containers.push(broker);
    const endpoint = `http://${minio.getHost()}:${minio.getMappedPort(9000)}`;
    s3 = new S3Client({
      endpoint,
      region: 'us-east-1',
      forcePathStyle: true,
      credentials: { accessKeyId: 'fall-test', secretAccessKey: 'fall-test-password' },
    });
    await s3.send(new CreateBucketCommand({ Bucket: 'fall-evidence' }));
    server = createServer((request, reply) => {
      request.resume();
      request.on('end', () => {
        reply.writeHead(200, { 'Content-Type': 'application/json' });
        reply.end(JSON.stringify(response));
      });
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const config = new ConfigService({
      M2A_ENABLED: 'true',
      FALL_IMMOBILITY_SECONDS: 3,
      AI_SERVICE_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      MINIO_ENDPOINT: endpoint,
      MINIO_ROOT_USER: 'fall-test',
      MINIO_ROOT_PASSWORD: 'fall-test-password',
      STORAGE_BUCKET: 'fall-evidence',
      STORAGE_PROVIDER: 'minio',
      AI_RESULT_MAX_ITEMS: '20',
      AI_RESULT_MAX_METADATA_BYTES: '16384',
      AI_RESULT_MAX_METADATA_DEPTH: '5',
      AI_RESULT_MAX_FUTURE_SECONDS: '300',
      AI_RESULT_OUTBOX_POLL_MS: '1000',
      AI_RESULT_OUTBOX_LEASE_SECONDS: '30',
      AI_RESULT_OUTBOX_RETRY_SECONDS: '1',
    });
    storage = new MinioStorageService(config);
    media = new MediaService(config, new EventMediaRepository(pool), storage);
    const eventsRepository = new EventsRepository(pool);
    const engine = new EscalationEngineService(
      new EscalationRepository(pool),
      new EscalationRulesRepository(pool),
    );
    const events = new EventsService(eventsRepository, media, engine, storage, {
      issueTokenPair: () => {
        throw new Error('Unused');
      },
      verifyRefreshToken: () => {
        throw new Error('Unused');
      },
      verifyAccessToken: () => ({
        sub: randomUUID(),
        email: 'qa@example.invalid',
        role: 'ADMIN',
        tokenType: 'access',
        jti: randomUUID(),
      }),
    });
    jest.spyOn(events, 'emitEvent');
    const results = new AiResultsRepository(new DatabaseService(pool));
    outbox = new AiResultOutboxService(config, results, eventsRepository, events, engine);
    ai = new AiResultsService(new AiResultValidator(config), results, outbox);
    repository = new FallIncidentRepository(pool);
    coordinator = new FallIncidentCoordinator(
      config,
      new RestAreaEvaluator(new ZonesRepository(pool)),
      new PoseInferenceAdapter(config),
      repository,
      ai,
      media,
    );
    consumer = new PoseFrameConsumer(config, new CamerasRepository(pool), coordinator);
    mqtt = await connectAsync(`mqtt://${broker.getHost()}:${broker.getMappedPort(1883)}`);
    const owner = randomUUID(),
      device = randomUUID();
    cameraId = randomUUID();
    await pool.query(
      "INSERT INTO users(id,email,full_name,role,password_hash) VALUES($1,'fall-qa@example.invalid','Fall QA','ADMIN','unused')",
      [owner],
    );
    await pool.query(
      "INSERT INTO devices(id,owner_user_id,name,status) VALUES($1,$2,'QA','ONLINE')",
      [device, owner],
    );
    await pool.query(
      "INSERT INTO cameras(id,device_id,name,slug,rtsp_url) VALUES($1,$2,'QA','fall_qa','rtsp://127.0.0.1/qa')",
      [cameraId, device],
    );
    // Keep the real SSE emitter observable for the assertions below.
    emitted = jest.mocked(events.emitEvent);
  });
  let emitted: jest.SpiedFunction<EventsService['emitEvent']>;

  async function drainOutbox(): Promise<void> {
    for (let attempt = 0; attempt < 500; attempt++) {
      await outbox.dispatchAvailable();
      const pending = await pool.query(
        "SELECT id FROM outbox_messages WHERE status <> 'PROCESSED'",
      );
      if (pending.rows.length === 0) return;
      await new Promise((done) => setTimeout(done, 20));
    }
    throw new Error('Outbox did not drain');
  }

  afterEach(async () => {
    if (pool && outbox) await drainOutbox();
  });

  afterAll(async () => {
    await mqtt?.endAsync();
    if (server) await new Promise<void>((done) => server.close(() => done()));
    s3?.destroy();
    await pool?.end();
    for (const container of containers.reverse()) await container.stop();
  });

  function context() {
    const now = new Date();
    response = {
      trackId: 'person',
      cameraSlug: 'fall_qa',
      sourceSessionId: 'session',
      frameId: randomUUID(),
      observedAt: now.toISOString(),
      poseAvailable: true,
      state: 'CONFIRMED',
      reason: 'IMMOBILE_CONFIRMED',
      episodeId: randomUUID(),
      candidateStartedAt: new Date(now.getTime() - 3200).toISOString(),
      confirmedAt: now.toISOString(),
      processedAt: now.toISOString(),
      modelVersion: 'scripted-evidence-v1',
      thresholdSeconds: 3,
      immobileSeconds: 3.2,
      torsoAngleDeg: 10,
      confidence: 1,
      error: null,
    };
    return {
      cameraId,
      cameraSlug: 'fall_qa',
      sourceSessionId: 'session',
      frameId: String(response.frameId),
      frameTimestamp: now,
      imageBytes: jpeg,
      persons: [
        {
          trackId: 'person',
          observedAt: now.getTime() / 1000,
          boundingBox: { x: 0.1, y: 0.1, width: 0.4, height: 0.8 },
        },
      ],
    };
  }

  it('MQTT envelope → HTTP adapter → incident/receipt/outbox → P1 + SSE + real snapshot URL', async () => {
    const input = context();
    const header = Buffer.from(
      JSON.stringify({
        schemaVersion: 1,
        cameraSlug: input.cameraSlug,
        sourceSessionId: input.sourceSessionId,
        frameId: input.frameId,
        frameTimestamp: input.frameTimestamp.getTime() / 1000,
        frameWidth: 640,
        frameHeight: 480,
        persons: input.persons,
      }),
    );
    const length = Buffer.alloc(4);
    length.writeUInt32BE(header.length);
    await mqtt.subscribeAsync('fall/frames');
    const handled = new Promise<void>((done, reject) =>
      mqtt.once('message', (_topic, bytes) => {
        void consumer.handlePoseFrame(bytes).then(done, reject);
      }),
    );
    await mqtt.publishAsync('fall/frames', Buffer.concat([length, header, jpeg]), {
      qos: 0,
      retain: false,
    });
    await handled;
    await drainOutbox();
    const incident = (
      await pool.query('SELECT * FROM fall_incidents WHERE episode_id=$1', [response.episodeId])
    ).rows[0];
    expect(incident.delivery_status).toBe('APPLIED');
    const event = (await pool.query('SELECT * FROM events WHERE id=$1', [incident.event_id]))
      .rows[0];
    expect(event.event_type).toBe('FALL_DETECTED');
    expect(event.priority).toBe('P1');
    expect(event.status).toBe('NOTIFIED');
    expect(event.ai_label).toBe('FALL_DETECTED');
    expect(
      (await pool.query('SELECT * FROM event_ai_result_receipts WHERE event_id=$1', [event.id]))
        .rows,
    ).toHaveLength(1);
    expect(emitted).toHaveBeenCalledWith(
      expect.objectContaining({ id: event.id, eventType: 'FALL_DETECTED', priority: 'P1' }),
      'event.updated',
    );
    const snapshot = await new EventMediaRepository(pool).findMediaByEventIdAndType(
      event.id,
      'SNAPSHOT',
    );
    expect(snapshot).not.toBeNull();
    if (!snapshot) throw new Error('Missing real snapshot');
    expect(await storage.download(snapshot.object_key)).toEqual(jpeg);
    const url = await storage.getPresignedUrl(snapshot.object_key);
    expect(Buffer.from(await (await fetch(url.url)).arrayBuffer())).toEqual(jpeg);
    await coordinator.processFrame(input);
    await drainOutbox();
    expect(
      (await pool.query('SELECT * FROM notifications WHERE event_id=$1', [event.id])).rows,
    ).toHaveLength(1);
    expect(
      (await pool.query('SELECT * FROM fall_incidents WHERE episode_id=$1', [response.episodeId]))
        .rows,
    ).toHaveLength(1);
    expect(
      (await pool.query('SELECT * FROM event_media WHERE event_id=$1', [event.id])).rows,
    ).toHaveLength(1);
  });

  it('restarts pending delivery with the exact immutable payload even without another camera frame', async () => {
    const input = context();
    const failure = jest
      .spyOn(ai, 'submit')
      .mockRejectedValueOnce(new Error('Transient submit failure'));
    await coordinator.processFrame(input);
    const row = (
      await pool.query('SELECT * FROM fall_incidents WHERE episode_id=$1', [response.episodeId])
    ).rows[0];
    expect(row.delivery_status).toBe('PENDING');
    failure.mockRestore();
    const submit = jest.spyOn(ai, 'submit');
    await new FallDeliveryWorker(new FallIncidentRepository(pool), ai).tick();
    expect(submit).toHaveBeenCalledWith(row.event_id, row.pending_payload);
    expect(
      (await pool.query('SELECT delivery_status FROM fall_incidents WHERE id=$1', [row.id])).rows[0]
        .delivery_status,
    ).toBe('APPLIED');
    submit.mockRestore();
  });

  it('serializes concurrent first delivery and preserves one event and one original resultId', async () => {
    const input = context();
    await Promise.all([
      coordinator.processFrame(input),
      coordinator.processFrame(input),
      coordinator.processFrame(input),
    ]);
    const rows = (
      await pool.query('SELECT * FROM fall_incidents WHERE episode_id=$1', [response.episodeId])
    ).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].delivery_status).toBe('APPLIED');
    expect(
      (
        await pool.query('SELECT * FROM event_ai_result_receipts WHERE event_id=$1', [
          rows[0].event_id,
        ])
      ).rows,
    ).toHaveLength(1);
  });

  it('reclaims an expired lease after crash and keeps evidence immutable', async () => {
    const input = context();
    const failure = jest.spyOn(ai, 'submit').mockRejectedValueOnce(new Error('Interrupted'));
    await coordinator.processFrame(input);
    failure.mockRestore();
    const claimed = await repository.claimPending();
    expect(claimed).not.toBeNull();
    if (!claimed) throw new Error('Missing pending incident');
    await pool.query(
      "UPDATE fall_incidents SET leased_until=now()-interval '1 second' WHERE id=$1",
      [claimed.id],
    );
    await new FallDeliveryWorker(repository, ai).tick();
    expect(
      (
        await pool.query('SELECT delivery_status, leased_until FROM fall_incidents WHERE id=$1', [
          claimed.id,
        ])
      ).rows[0],
    ).toEqual({ delivery_status: 'APPLIED', leased_until: null });
    await expect(
      pool.query("UPDATE fall_incidents SET pending_payload='{}'::jsonb WHERE id=$1", [claimed.id]),
    ).rejects.toThrow('immutable');
  });
});
