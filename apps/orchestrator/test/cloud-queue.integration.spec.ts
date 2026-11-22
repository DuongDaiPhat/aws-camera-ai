import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { AiResultsService } from '../src/ai-results/ai-results.service';
import { CloudQueueService } from '../src/cloud-queue/cloud-queue.service';
import { DatabaseService } from '../src/database/database.service';
import { KnownFacesRepository } from '../src/known-faces/known-faces.repository';
import { FrigateMediaAdapter } from '../src/media/frigate-media.adapter';
import { IStorageService, S3_EXPIRE_7D_TAG } from '../src/storage/storage.interface';

jest.setTimeout(180000);
describe('cloud queue PostgreSQL migration and atomic intent', () => {
  let container: StartedTestContainer | undefined;
  let pool: Pool;
  const owner = randomUUID(),
    device = randomUUID(),
    camera = randomUUID();
  beforeAll(async () => {
    container = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({ POSTGRES_USER: 'test', POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'test' })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
      .start();
    pool = new Pool({
      host: container.getHost(),
      port: container.getMappedPort(5432),
      user: 'test',
      password: 'test',
      database: 'test',
    });
    const dir = resolve(__dirname, '../../../db/migrations');
    for (const file of readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort())
      await pool.query(readFileSync(resolve(dir, file), 'utf8'));
    await pool.query(
      `INSERT INTO users(id,email,password_hash,full_name,role) VALUES($1,'cloud@example.test','hash','Cloud','ADMIN')`,
      [owner],
    );
    await pool.query(
      `INSERT INTO devices(id,owner_user_id,name,status) VALUES($1,$2,'cloud','ONLINE')`,
      [device, owner],
    );
    await pool.query(
      `INSERT INTO cameras(id,device_id,name,slug,rtsp_url) VALUES($1,$2,'cloud','cloud','rtsp://example.test/cloud')`,
      [camera, device],
    );
  });
  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });
  async function insertEvent(id: string) {
    await pool.query(
      `INSERT INTO events(id,camera_id,event_type,priority,detected_at,track_id) VALUES($1,$2,'PERSON_DETECTED','P2',now(),$3)`,
      [id, camera, id],
    );
  }
  it('local event does not create a cloud job', async () => {
    const id = randomUUID();
    await insertEvent(id);
    expect(
      (await pool.query('SELECT * FROM cloud_jobs WHERE event_id=$1', [id])).rows,
    ).toHaveLength(0);
  });
  it('0024 drops automatic cloud_face_intent trigger on raw INSERT into events', async () => {
    await pool.query("UPDATE cloud_transport_mode SET mode='sqs'");
    const id = randomUUID();
    await insertEvent(id);
    expect(
      (await pool.query('SELECT * FROM cloud_jobs WHERE event_id=$1', [id])).rows,
    ).toHaveLength(0);

    const triggerCheck = await pool.query(
      `SELECT 1 FROM pg_trigger WHERE tgname = 'cloud_face_intent' AND NOT tgisinternal`,
    );
    expect(triggerCheck.rows).toHaveLength(0);
  });
  it('enqueueFaceJob enforces (event_id, revision) uniqueness while allowing revision 2', async () => {
    await pool.query("UPDATE cloud_transport_mode SET mode='sqs'");
    await pool.query(
      `INSERT INTO cloud_face_collections(owner_user_id,collection_id,version)
       VALUES($1,$2,1)
       ON CONFLICT(owner_user_id) DO UPDATE SET collection_id=EXCLUDED.collection_id,version=1`,
      [owner, `camerai-s4-dev-owner-${owner}`],
    );

    const eventId = randomUUID();
    await insertEvent(eventId);
    const storage = {
      upload: jest.fn(async (key: string) => ({
        bucket: 'test-bucket',
        key,
        sizeBytes: 4,
        contentType: 'image/jpeg',
      })),
    };
    const queues = new CloudQueueService(
      new ConfigService({
        FACE_JOB_TRANSPORT: 'sqs',
        APPLICATION_RESULTS_CONSUMER_ENABLED: 'true',
        AWS_REGION: 'ap-southeast-1',
        STORAGE_PROVIDER: 's3',
        S3_BUCKET: 'test-bucket',
        FACE_JOBS_QUEUE_URL: 'https://sqs.ap-southeast-1.amazonaws.com/123456789012/face',
        NOTIFICATION_JOBS_QUEUE_URL:
          'https://sqs.ap-southeast-1.amazonaws.com/123456789012/notification',
        APPLICATION_RESULTS_QUEUE_URL:
          'https://sqs.ap-southeast-1.amazonaws.com/123456789012/results',
      }),
      new DatabaseService(pool),
      {} as FrigateMediaAdapter,
      storage as unknown as IStorageService,
      { submit: jest.fn() } as unknown as AiResultsService,
    );

    const rev1 = await queues.enqueueFaceJob({
      eventId,
      cameraId: camera,
      ownerScopeId: owner,
      trackId: eventId,
      sourceSessionId: 'cloud:1700000000.000000',
      revision: 1,
      imageBuffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    });
    expect(rev1).toMatchObject({ created: true, status: 'PENDING' });
    expect(storage.upload).toHaveBeenCalledWith(
      `owners/${owner}/cameras/${camera}/events/${eventId}/face/${rev1.jobId}.jpg`,
      expect.any(Buffer),
      'image/jpeg',
      { tags: S3_EXPIRE_7D_TAG },
    );

    // Duplicate (event_id, revision=1) is ignored idempotently via ON CONFLICT DO NOTHING.
    const dupRev1 = await queues.enqueueFaceJob({
      eventId,
      cameraId: camera,
      ownerScopeId: owner,
      trackId: eventId,
      sourceSessionId: 'cloud:1700000000.000000',
      revision: 1,
      imageBuffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    });
    expect(dupRev1).toEqual({ created: false, jobId: null, status: null });

    // Revision 2 for the same event_id is allowed!
    const rev2 = await queues.enqueueFaceJob({
      eventId,
      cameraId: camera,
      ownerScopeId: owner,
      trackId: eventId,
      sourceSessionId: 'cloud:1700000000.000000',
      revision: 2,
      imageBuffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    });
    expect(rev2).toMatchObject({ created: true, status: 'PENDING' });
    expect(rev2.jobId).not.toBe(rev1.jobId);

    const rows = await pool.query(
      'SELECT id, revision, status FROM cloud_jobs WHERE event_id=$1 ORDER BY revision ASC',
      [eventId],
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[0]).toMatchObject({ id: rev1.jobId, revision: 1, status: 'PENDING' });
    expect(rows.rows[1]).toMatchObject({ id: rev2.jobId, revision: 2, status: 'PENDING' });

    const ctx = await queues.faceContext(rev2.jobId!);
    expect(ctx.envelope.payload.revision).toBe(2);
    expect(ctx.collection_face_count).toBe(0);
  });

  it('0023 migration allows valid environment collection prefixes and enforces per-owner scope', async () => {
    for (const prefix of [
      'camerai-s4-dev-owner-',
      'argusai-staging-owner-',
      'argusai-production-owner-',
    ]) {
      await pool.query(
        `INSERT INTO cloud_face_collections (owner_user_id, collection_id, version)
         VALUES ($1, $2, 1)
         ON CONFLICT (owner_user_id) DO UPDATE SET collection_id = EXCLUDED.collection_id, version = cloud_face_collections.version + 1`,
        [owner, `${prefix}${owner}`],
      );
    }

    await expect(
      pool.query(`UPDATE cloud_face_collections SET collection_id = $2 WHERE owner_user_id = $1`, [
        owner,
        `invalid-prefix-${owner}`,
      ]),
    ).rejects.toThrow();

    await expect(
      pool.query(`UPDATE cloud_face_collections SET collection_id = $2 WHERE owner_user_id = $1`, [
        owner,
        `argusai-staging-owner-${randomUUID()}`,
      ]),
    ).rejects.toThrow();
  });

  it('persists Rekognition enrollment mappings and increments collection version on create/update/remove', async () => {
    const repo = new KnownFacesRepository(new DatabaseService(pool));
    const collectionId = `argusai-staging-owner-${owner}`;
    const before = await pool.query<{ version: number }>(
      'SELECT version FROM cloud_face_collections WHERE owner_user_id = $1',
      [owner],
    );
    const startVersion = before.rows[0]?.version ?? 0;

    const knownFaceId = await repo.createRekognition(
      owner,
      { personName: 'Staging Member', relationship: 'Family' },
      {
        collectionId,
        faceIds: ['rek-int-face-1', 'rek-int-face-2'],
        modelVersion: 'rekognition-7.0',
        sourceImageCount: 2,
      },
    );

    const listed = await repo.list(owner);
    const created = listed.find((item) => item.id === knownFaceId);
    expect(created).toMatchObject({
      provider: 'REKOGNITION',
      recognitionStatus: 'READY',
      sourceImageCount: 2,
    });

    const afterCreate = await pool.query<{ version: number }>(
      'SELECT version FROM cloud_face_collections WHERE owner_user_id = $1',
      [owner],
    );
    expect(afterCreate.rows[0]?.version).toBe(startVersion + 1);

    const mappings = await pool.query<{ face_id: string }>(
      'SELECT face_id FROM cloud_face_mappings WHERE owner_user_id = $1 AND known_face_id = $2 ORDER BY face_id',
      [owner, knownFaceId],
    );
    expect(mappings.rows.map((row) => row.face_id)).toEqual(['rek-int-face-1', 'rek-int-face-2']);

    await repo.update(owner, knownFaceId, { personName: 'Staging Member Renamed' }, owner);
    const afterUpdate = await pool.query<{ version: number }>(
      'SELECT version FROM cloud_face_collections WHERE owner_user_id = $1',
      [owner],
    );
    expect(afterUpdate.rows[0]?.version).toBe(startVersion + 2);

    await repo.removeRekognition(owner, knownFaceId, collectionId, '127.0.0.1', 'jest');
    const afterDelete = await pool.query<{ version: number }>(
      'SELECT version FROM cloud_face_collections WHERE owner_user_id = $1',
      [owner],
    );
    expect(afterDelete.rows[0]?.version).toBe(startVersion + 3);
    expect(
      (
        await pool.query('SELECT * FROM cloud_face_mappings WHERE known_face_id = $1', [
          knownFaceId,
        ])
      ).rows,
    ).toHaveLength(0);
  });
});
