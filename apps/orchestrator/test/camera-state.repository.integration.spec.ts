import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { CameraSourcesRepository } from '../src/camera-sources/camera-sources.repository';
import { CamerasRepository } from '../src/cameras/cameras.repository';

const POSTGRES_PORT = 5432;
const CONTAINER_STARTUP_TIMEOUT_MS = 120000;

interface IdRow {
  id: string;
}

interface CameraStateRow {
  status: string;
  process_id: string | null;
  stopped_at: Date | null;
}

interface FrigateSyncRow {
  sync_status: string;
  sync_error_code: string | null;
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

async function seedCameraState(pool: Pool): Promise<string> {
  const userResult = await pool.query<IdRow>(
    `INSERT INTO users (email, password_hash, full_name, role)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    ['camera-state@example.test', 'test-only-password-hash', 'Camera State Test', 'ADMIN'],
  );
  const deviceResult = await pool.query<IdRow>(
    `INSERT INTO devices (owner_user_id, name, device_type, status)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [userResult.rows[0].id, 'Camera State Gateway', 'EDGE_GATEWAY', 'ONLINE'],
  );
  const cameraResult = await pool.query<IdRow>(
    `INSERT INTO cameras (device_id, name, slug, rtsp_url)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [deviceResult.rows[0].id, 'Camera State', 'cam_state_test', 'rtsp://mediamtx:8554/cam_state_test'],
  );
  const cameraId = cameraResult.rows[0].id;

  await pool.query(
    `INSERT INTO camera_sources (camera_id, source_type, status, process_id)
     VALUES ($1, 'RTSP', 'ONLINE', '1234')`,
    [cameraId],
  );
  await pool.query(
    `INSERT INTO camera_frigate_settings (
       camera_id, detect_width, detect_height, detect_fps,
       config_version, applied_version, sync_status
     ) VALUES ($1, 1280, 720, 5, 2, 1, 'PENDING')`,
    [cameraId],
  );

  return cameraId;
}

describe('Camera state repositories', () => {
  let postgresContainer: StartedTestContainer;
  let pool: Pool;
  let cameraId: string;
  let cameraSourcesRepository: CameraSourcesRepository;
  let camerasRepository: CamerasRepository;

  jest.setTimeout(CONTAINER_STARTUP_TIMEOUT_MS);

  beforeAll(async () => {
    postgresContainer = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({
        POSTGRES_DB: 'camerai_test',
        POSTGRES_PASSWORD: 'postgres',
        POSTGRES_USER: 'postgres',
      })
      .withExposedPorts(POSTGRES_PORT)
      .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
      .start();

    pool = new Pool({
      database: 'camerai_test',
      host: postgresContainer.getHost(),
      password: 'postgres',
      port: postgresContainer.getMappedPort(POSTGRES_PORT),
      user: 'postgres',
    });

    await runMigrations(pool);
    cameraId = await seedCameraState(pool);
    cameraSourcesRepository = new CameraSourcesRepository(pool);
    camerasRepository = new CamerasRepository(pool);
  });

  afterAll(async () => {
    await pool?.end();
    await postgresContainer?.stop();
  });

  it('updates source runtime status repeatedly without PostgreSQL parameter type errors', async () => {
    for (const status of ['STARTING', 'ONLINE', 'STOPPED', 'STARTING', 'OFFLINE'] as const) {
      await cameraSourcesRepository.updateRuntimeStatus(cameraId, status, 5678);
    }

    const result = await pool.query<CameraStateRow>(
      `SELECT status, process_id, stopped_at
       FROM camera_sources
       WHERE camera_id = $1`,
      [cameraId],
    );

    expect(result.rows[0]).toMatchObject({
      process_id: null,
      status: 'OFFLINE',
    });
    expect(result.rows[0].stopped_at).toBeInstanceOf(Date);
  });

  it('stores Frigate sync enum values when a state transition fails to synchronize', async () => {
    await camerasRepository.updateFrigateSettings(cameraId, {
      sync_error_code: 'FRIGATE_SYNC_FAILED',
      sync_error_message: 'Test synchronization failure',
      sync_status: 'FAILED',
    });

    const result = await pool.query<FrigateSyncRow>(
      `SELECT sync_status, sync_error_code
       FROM camera_frigate_settings
       WHERE camera_id = $1`,
      [cameraId],
    );

    expect(result.rows[0]).toEqual({
      sync_error_code: 'FRIGATE_SYNC_FAILED',
      sync_status: 'FAILED',
    });
  });
});
