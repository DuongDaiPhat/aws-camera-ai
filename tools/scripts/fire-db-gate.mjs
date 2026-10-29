/** Disposable US-18 PostgreSQL gate; never loads .env or touches application data. */
import { execFileSync, spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout } from 'node:timers/promises';
import pg from 'pg';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const container = `camerai-us18-db-${process.pid}`;
const image =
  'postgres:16-alpine@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea';
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8' }).trim();
let created = false;
let pool;
try {
  docker(
    'run',
    '-d',
    '--name',
    container,
    '-p',
    '127.0.0.1::5432',
    '-e',
    'POSTGRES_PASSWORD=us18-test-only',
    image,
  );
  created = true;
  const port = docker('port', container, '5432/tcp').split(':').at(-1);
  const url = `postgresql://postgres:us18-test-only@127.0.0.1:${port}/postgres`;
  pool = new pg.Pool({ connectionString: url });
  for (let attempt = 0; ; attempt++) {
    try {
      await pool.query('SELECT 1');
      break;
    } catch (error) {
      if (attempt >= 40) throw error;
      await setTimeout(1000);
    }
  }
  const environment = { ...process.env, DATABASE_URL: url, FIRE_TEST_DATABASE_URL: url };
  execFileSync(process.execPath, [join(root, 'tools/scripts/migrate.mjs'), 'up'], {
    cwd: root,
    env: environment,
    stdio: 'pipe',
  });
  await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        join(root, 'apps/orchestrator/node_modules/jest/bin/jest.js'),
        '--config',
        join(root, 'apps/orchestrator/jest.config.js'),
        '--runInBand',
        '--testRegex',
        'fire-db\\.integration\\.spec\\.ts$',
      ],
      { cwd: root, env: environment, stdio: 'inherit' },
    );
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`US18 DB gate exited ${code}`)),
    );
  });
} finally {
  if (pool) await pool.end();
  if (created) docker('rm', '-f', container);
}
