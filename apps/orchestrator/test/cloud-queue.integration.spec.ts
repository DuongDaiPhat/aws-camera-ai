import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { DatabaseService } from '../src/database/database.service';
import { KnownFacesRepository } from '../src/known-faces/known-faces.repository';

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
  it('cloud event creates a durable job, with stable IDs', async () => {
    await pool.query("UPDATE cloud_transport_mode SET mode='sqs'");
    const id = randomUUID();
    await insertEvent(id);
    const result = await pool.query('SELECT * FROM cloud_jobs WHERE event_id=$1', [id]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      kind: 'face.job',
      owner_user_id: owner,
      camera_id: camera,
      status: 'PREPARING',
    });
    await expect(
      pool.query(
        `INSERT INTO cloud_jobs(event_id,kind,owner_user_id,camera_id) VALUES($1,'face.job',$2,$3)`,
        [id, owner, camera],
      ),
    ).rejects.toThrow();
  });
  it('rolling back event creation rolls back the job too', async () => {
    const client = await pool.connect();
    const id = randomUUID();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO events(id,camera_id,event_type,priority,detected_at,track_id) VALUES($1,$2,'PERSON_DETECTED','P2',now(),$3)`,
        [id, camera, id],
      );
      expect(
        (await client.query('SELECT * FROM cloud_jobs WHERE event_id=$1', [id])).rows,
      ).toHaveLength(1);
      await client.query('ROLLBACK');
      expect(
        (await pool.query('SELECT * FROM cloud_jobs WHERE event_id=$1', [id])).rows,
      ).toHaveLength(0);
    } finally {
      client.release();
    }
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
