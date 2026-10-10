/** Disposable PostgreSQL 16 gate: actual migration runner, upgrade, replay and DB invariants. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout } from 'node:timers/promises';
import pg from 'pg';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const container = `camerai-sprint3-db-gate-${process.pid}`;
const image =
  'postgres:16-alpine@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea';
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8' }).trim();
const clients = [];
let created = false;
try {
  docker(
    'run',
    '-d',
    '--name',
    container,
    '-p',
    '127.0.0.1::5432',
    '-e',
    'POSTGRES_USER=camerai',
    '-e',
    'POSTGRES_PASSWORD=gate-only-test',
    image,
  );
  created = true;
  const port = docker('port', container, '5432/tcp').split(':').at(-1);
  const url = (name) => `postgresql://camerai:gate-only-test@127.0.0.1:${port}/${name}`;
  for (let i = 0; ; i++) {
    try {
      // The entrypoint's temporary init server only listens on a Unix socket.
      // Require TCP readiness so initialization cannot race the first client.
      docker('exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'camerai', '-d', 'postgres');
      break;
    } catch (error) {
      if (i >= 30) throw error;
      await setTimeout(1000);
    }
  }
  const admin = new pg.Client({ connectionString: url('postgres') });
  await admin.connect();
  clients.push(admin);
  await admin.query('CREATE DATABASE gate_fresh');
  await admin.query('CREATE DATABASE gate_upgrade');
  const migrations = (await readdir(join(root, 'db', 'migrations')))
    .filter((name) => name.endsWith('.sql'))
    .sort();
  const migrate = (name) =>
    execFileSync(process.execPath, [join(root, 'tools', 'scripts', 'migrate.mjs'), 'up'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, DATABASE_URL: url(name) },
    });
  for (const name of ['gate_fresh', 'gate_upgrade']) {
    const client = new pg.Client({ connectionString: url(name) });
    await client.connect();
    clients.push(client);
    let before;
    if (name === 'gate_upgrade') {
      await client.query(
        'CREATE TABLE schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())',
      );
      for (const filename of migrations.filter((file) => file < '0013')) {
        await client.query(await readFile(join(root, 'db', 'migrations', filename), 'utf8'));
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
      }
      for (const filename of (await readdir(join(root, 'db', 'seeds')))
        .filter((file) => file.endsWith('.sql'))
        .sort()) {
        await client.query(await readFile(join(root, 'db', 'seeds', filename), 'utf8'));
      }
      before = (
        await client.query(
          'SELECT id, event_type, status, priority, detected_at FROM events ORDER BY id',
        )
      ).rows;
      assert.ok(before.length > 0, 'Upgrade fixture must contain existing events');
    }
    migrate(name);
    assert.match(
      migrate(name),
      /Khong co migration moi/,
      'Second run must skip applied migrations',
    );
    assert.equal(
      Number((await client.query('SELECT count(*) FROM schema_migrations')).rows[0].count),
      migrations.length,
    );
    if (before)
      assert.deepEqual(
        (
          await client.query(
            'SELECT id, event_type, status, priority, detected_at FROM events ORDER BY id',
          )
        ).rows,
        before,
      );
    await client.query(await readFile(join(root, 'db', 'tests', 'sprint3-gate.sql'), 'utf8'));
    console.log(`${name}: migrations, replay and Sprint 3 constraint/immutability checks PASS`);
  }
} finally {
  await Promise.allSettled(clients.map((client) => client.end()));
  if (created) docker('rm', '-f', container);
}
