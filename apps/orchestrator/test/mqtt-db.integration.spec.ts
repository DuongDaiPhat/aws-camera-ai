import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import mqtt, { MqttClient } from 'mqtt';
import { Pool } from 'pg';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { EventsRepository } from '../src/events/events.repository';
import { MqttConsumerService } from '../src/ingestion/mqtt-consumer.service';
import { EventMediaRepository } from '../src/media/event-media.repository';
import { MediaService } from '../src/media/media.service';
import { FrigateDetectionTrackerService } from '../src/frigate/frigate-detection-tracker.service';
import {
  IStorageService,
  PresignedUrlResult,
  UploadResult,
} from '../src/storage/storage.interface';

const MQTT_PORT = 1883;
const MQTT_TOPIC_FRIGATE = 'frigate/events';
const POSTGRES_PORT = 5432;
const ACCEPTANCE_TIMEOUT_MS = 3000;
const CONTAINER_STARTUP_TIMEOUT_MS = 120000;

interface EventCountRow {
  count: number;
}

interface IdRow {
  id: string;
}

interface PersistedEventRow {
  event_type: string;
  status: string;
  priority: string;
  source: string;
  track_id: string;
  dedup_key: string;
  confidence: string;
  camera_id: string | null;
  detected_at: Date;
}

class UnusedStorageService implements IStorageService {
  upload(_key: string, _body: Buffer, _contentType: string): Promise<UploadResult> {
    throw new Error('Storage không được gọi trong integration test US-08');
  }

  getPresignedUrl(_key: string, _expiresInSeconds?: number): Promise<PresignedUrlResult> {
    throw new Error('Storage không được gọi trong integration test US-08');
  }
}

async function runMigrations(pool: Pool): Promise<void> {
  const migrationsDirectory = resolve(__dirname, '../../../db/migrations');
  const migrationFiles = (await readdir(migrationsDirectory))
    .filter((fileName) => fileName.endsWith('.sql'))
    .sort();

  for (const migrationFile of migrationFiles) {
    const sql = await readFile(resolve(migrationsDirectory, migrationFile), 'utf8');
    await pool.query(sql);
  }
}

async function seedTestCamera(pool: Pool): Promise<string> {
  const userResult = await pool.query<IdRow>(
    `INSERT INTO users (email, password_hash, full_name, role)
     VALUES ($1, $2, $3, $4)
     RETURNING id;`,
    ['us08@example.test', 'test-only-password-hash', 'US-08 Test User', 'ADMIN'],
  );
  const ownerUserId = userResult.rows[0]?.id;
  if (!ownerUserId) {
    throw new Error('Không tạo được user fixture cho US-08');
  }

  const deviceResult = await pool.query<IdRow>(
    `INSERT INTO devices (owner_user_id, name, device_type, status)
     VALUES ($1, $2, $3, $4)
     RETURNING id;`,
    [ownerUserId, 'US-08 Test Gateway', 'EDGE_GATEWAY', 'ONLINE'],
  );
  const deviceId = deviceResult.rows[0]?.id;
  if (!deviceId) {
    throw new Error('Không tạo được device fixture cho US-08');
  }

  const cameraResult = await pool.query<IdRow>(
    `INSERT INTO cameras (device_id, name, slug, rtsp_url)
     VALUES ($1, $2, $3, $4)
     RETURNING id;`,
    [deviceId, 'Phòng khách', 'cam_living_room', 'rtsp://mediamtx:8554/cam_living_room'],
  );
  const cameraId = cameraResult.rows[0]?.id;
  if (!cameraId) {
    throw new Error('Không tạo được camera fixture cho US-08');
  }

  return cameraId;
}

async function connectMqttClient(brokerUrl: string): Promise<MqttClient> {
  return await new Promise<MqttClient>((resolveConnection, rejectConnection) => {
    const client = mqtt.connect(brokerUrl, {
      clientId: `us08-publisher-${randomUUID()}`,
      reconnectPeriod: 0,
    });

    client.once('connect', () => resolveConnection(client));
    client.once('error', rejectConnection);
  });
}

async function publish(client: MqttClient, topic: string, payload: string): Promise<void> {
  await new Promise<void>((resolvePublish, rejectPublish) => {
    client.publish(topic, payload, { qos: 1 }, (error) => {
      if (error) {
        rejectPublish(error);
        return;
      }
      resolvePublish();
    });
  });
}

async function closeMqttClient(client: MqttClient): Promise<void> {
  await new Promise<void>((resolveClose, rejectClose) => {
    client.end(false, {}, (error) => {
      if (error) {
        rejectClose(error);
        return;
      }
      resolveClose();
    });
  });
}

async function waitUntil(
  condition: () => boolean | Promise<boolean>,
  failureMessage: string,
  timeoutMs = ACCEPTANCE_TIMEOUT_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await condition()) {
      return;
    }
    await delay(50);
  }

  throw new Error(failureMessage);
}

function loggerContains(spy: jest.SpyInstance, expectedMessage: string): boolean {
  return spy.mock.calls.some((call: unknown[]) =>
    call.some((value: unknown) => typeof value === 'string' && value.includes(expectedMessage)),
  );
}

describe('US-08 - Integration MQTT đến PostgreSQL', () => {
  let postgresContainer: StartedTestContainer;
  let mosquittoContainer: StartedTestContainer;
  let pool: Pool;
  let brokerUrl: string;
  let cameraId: string;
  let consumer: MqttConsumerService | null = null;
  let publisher: MqttClient | null = null;
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  jest.setTimeout(CONTAINER_STARTUP_TIMEOUT_MS);

  beforeAll(async () => {
    [postgresContainer, mosquittoContainer] = await Promise.all([
      new GenericContainer('postgres:16-alpine')
        .withEnvironment({
          POSTGRES_DB: 'camerai_test',
          POSTGRES_USER: 'camerai_test',
          POSTGRES_PASSWORD: 'camerai_test_password',
        })
        .withExposedPorts(POSTGRES_PORT)
        .withHealthCheck({
          test: ['CMD-SHELL', 'pg_isready -U camerai_test -d camerai_test'],
          interval: 1000,
          timeout: 3000,
          retries: 30,
        })
        // PostgreSQL khởi động một server tạm để init rồi restart sang server chính.
        // Chờ lần "ready" thứ hai để migration không rơi đúng lúc kết nối bị ngắt.
        .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
        .withStartupTimeout(CONTAINER_STARTUP_TIMEOUT_MS)
        .start(),
      new GenericContainer('eclipse-mosquitto:2')
        .withCopyContentToContainer([
          {
            content: [
              'listener 1883 0.0.0.0',
              'allow_anonymous true',
              'persistence false',
              'log_dest stdout',
              'log_type all',
            ].join('\n'),
            target: '/mosquitto/config/mosquitto.conf',
          },
        ])
        .withExposedPorts(MQTT_PORT)
        .withWaitStrategy(Wait.forLogMessage(/mosquitto version .* running/))
        .withStartupTimeout(CONTAINER_STARTUP_TIMEOUT_MS)
        .start(),
    ]);

    pool = new Pool({
      host: postgresContainer.getHost(),
      port: postgresContainer.getMappedPort(POSTGRES_PORT),
      database: 'camerai_test',
      user: 'camerai_test',
      password: 'camerai_test_password',
      max: 5,
    });
    brokerUrl = `mqtt://${mosquittoContainer.getHost()}:${mosquittoContainer.getMappedPort(MQTT_PORT)}`;

    await runMigrations(pool);
    cameraId = await seedTestCamera(pool);
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE TABLE events CASCADE;');
    logSpy = jest.spyOn(Logger.prototype, 'log');
    warnSpy = jest.spyOn(Logger.prototype, 'warn');
  });

  afterEach(async () => {
    consumer?.disconnect();
    consumer = null;

    if (publisher) {
      await closeMqttClient(publisher);
      publisher = null;
    }

    logSpy?.mockRestore();
    warnSpy?.mockRestore();
  });

  afterAll(async () => {
    await pool?.end();

    const stopContainers: Promise<unknown>[] = [];
    if (postgresContainer) {
      stopContainers.push(postgresContainer.stop());
    }
    if (mosquittoContainer) {
      stopContainers.push(mosquittoContainer.stop());
    }
    await Promise.all(stopContainers);
  });

  function startConsumer(): void {
    const configService = new ConfigService({
      MQTT_URL: brokerUrl,
      MQTT_CLIENT_ID: `us08-consumer-${randomUUID()}`,
      MQTT_TOPIC_FRIGATE,
    });
    const eventsRepository = new EventsRepository(pool);
    const eventMediaRepository = new EventMediaRepository(pool);
    const mediaService = new MediaService(
      configService,
      eventMediaRepository,
      new UnusedStorageService(),
    );
    const detectionTracker = new FrigateDetectionTrackerService(configService);

    consumer = new MqttConsumerService(
      configService,
      eventsRepository,
      eventMediaRepository,
      mediaService,
      detectionTracker,
    );
    consumer.connect();
  }

  async function waitForSubscription(): Promise<void> {
    await waitUntil(
      () => loggerContains(logSpy, `Da subscribe topic ${MQTT_TOPIC_FRIGATE}`),
      `Consumer không subscribe topic ${MQTT_TOPIC_FRIGATE} trong ${ACCEPTANCE_TIMEOUT_MS} ms`,
    );
  }

  async function countEventsByTrackId(trackId: string): Promise<number> {
    const result = await pool.query<EventCountRow>(
      `SELECT COUNT(*)::int AS count
       FROM events
       WHERE track_id = $1;`,
      [trackId],
    );
    return result.rows[0]?.count ?? 0;
  }

  it('tạo đúng một bản ghi trong vòng 3 giây khi publish message Frigate hợp lệ', async () => {
    // Arrange
    const trackId = `us08-track-${randomUUID()}`;
    const frameTime = Date.now() / 1000;
    const payload = JSON.stringify({
      type: 'new',
      after: {
        id: trackId,
        camera: 'cam_living_room',
        frame_time: frameTime,
        label: 'person',
        score: 0.84,
        current_zones: [],
        has_snapshot: false,
        has_clip: false,
      },
    });

    publisher = await connectMqttClient(brokerUrl);
    startConsumer();
    await waitForSubscription();

    // Act
    const publishedAt = Date.now();
    await publish(publisher, MQTT_TOPIC_FRIGATE, payload);
    await waitUntil(
      async () => (await countEventsByTrackId(trackId)) === 1,
      `Không tìm thấy event ${trackId} trong ${ACCEPTANCE_TIMEOUT_MS} ms`,
    );

    // Assert
    expect(Date.now() - publishedAt).toBeLessThan(ACCEPTANCE_TIMEOUT_MS);

    await publish(publisher, MQTT_TOPIC_FRIGATE, payload);
    await waitUntil(
      () => loggerContains(logSpy, 'Da cap nhat su kien theo vong doi Frigate track'),
      'Consumer không ghi nhận việc khử trùng lặp',
    );

    const result = await pool.query<PersistedEventRow>(
      `SELECT event_type,
              status,
              priority,
              source,
              track_id,
              dedup_key,
              confidence,
              camera_id,
              detected_at
       FROM events
       WHERE track_id = $1
       LIMIT 2;`,
      [trackId],
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      event_type: 'PERSON_DETECTED',
      status: 'DETECTED',
      priority: 'P3',
      source: 'FRIGATE',
      track_id: trackId,
      camera_id: cameraId,
    });
    expect(result.rows[0]?.dedup_key).toBe(`frigate:cam_living_room:${trackId}`);
    expect(Number(result.rows[0]?.confidence)).toBe(0.84);
    expect(result.rows[0]?.detected_at.getTime()).toBeCloseTo(frameTime * 1000, 0);
  });

  it('giữ một bản ghi trong suốt vòng đời new-update-end qua ranh giới 10 giây', async () => {
    const trackId = `us08-lifecycle-${randomUUID()}`;
    const startTime = Math.floor(Date.now() / 10_000) * 10 + 9.5;
    publisher = await connectMqttClient(brokerUrl);
    startConsumer();
    await waitForSubscription();

    const createPayload = (
      type: 'new' | 'update' | 'end',
      offsetSeconds: number,
      score: number,
    ): string =>
      JSON.stringify({
        type,
        after: {
          id: trackId,
          camera: 'cam_living_room',
          frame_time: startTime + offsetSeconds,
          start_time: startTime,
          end_time: type === 'end' ? startTime + offsetSeconds : null,
          label: 'person',
          score,
          current_zones: [],
          has_snapshot: false,
          has_clip: false,
        },
      });

    await publish(publisher, MQTT_TOPIC_FRIGATE, createPayload('new', 0, 0.7));
    await publish(publisher, MQTT_TOPIC_FRIGATE, createPayload('update', 1, 0.9));
    await publish(publisher, MQTT_TOPIC_FRIGATE, createPayload('end', 12, 0.8));

    await waitUntil(async () => {
      const queryResult = await pool.query<{ confidence: string }>(
        'SELECT confidence FROM events WHERE track_id = $1;',
        [trackId],
      );
      return Number(queryResult.rows[0]?.confidence) === 0.9;
    }, 'Event khong duoc cap nhat confidence lon nhat');

    expect(await countEventsByTrackId(trackId)).toBe(1);
    const result = await pool.query<PersistedEventRow>(
      `SELECT event_type,
              status,
              priority,
              source,
              track_id,
              dedup_key,
              confidence,
              camera_id,
              detected_at
       FROM events
       WHERE track_id = $1;`,
      [trackId],
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.dedup_key).toBe(`frigate:cam_living_room:${trackId}`);
    expect(Number(result.rows[0]?.confidence)).toBe(0.9);
  });

  it('không ghi message lỗi và consumer vẫn xử lý message hợp lệ tiếp theo', async () => {
    // Arrange
    const recoveryTrackId = `us08-recovery-${randomUUID()}`;
    publisher = await connectMqttClient(brokerUrl);
    startConsumer();
    await waitForSubscription();

    const countBefore = await pool.query<EventCountRow>(
      'SELECT COUNT(*)::int AS count FROM events;',
    );

    // Act
    await publish(publisher, MQTT_TOPIC_FRIGATE, '{"type":"new","after":');
    await waitUntil(
      () => loggerContains(warnSpy, 'Dead-letter: Message MQTT'),
      'Consumer không ghi dead-letter log cho message sai định dạng',
    );

    // Assert
    const countAfterInvalid = await pool.query<EventCountRow>(
      'SELECT COUNT(*)::int AS count FROM events;',
    );
    expect(countAfterInvalid.rows[0]?.count).toBe(countBefore.rows[0]?.count);

    const recoveryPayload = JSON.stringify({
      type: 'new',
      after: {
        id: recoveryTrackId,
        camera: 'cam_living_room',
        frame_time: Date.now() / 1000,
        label: 'person',
        score: 0.91,
        current_zones: [],
        has_snapshot: false,
        has_clip: false,
      },
    });

    await publish(publisher, MQTT_TOPIC_FRIGATE, recoveryPayload);
    await waitUntil(
      async () => (await countEventsByTrackId(recoveryTrackId)) === 1,
      'Consumer không xử lý message hợp lệ sau message lỗi',
    );
    expect(await countEventsByTrackId(recoveryTrackId)).toBe(1);
  });
});
