import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import pg from 'pg';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const url = process.env.US20_MIGRATION_DATABASE_URL;
if (
  !url ||
  new URL(url).pathname !== '/qa_us20_upgrade' ||
  !['127.0.0.1', 'localhost'].includes(new URL(url).hostname)
)
  throw new Error('A fresh disposable loopback qa_us20_upgrade database is required.');
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const tables = await client.query(
    "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'",
  );
  assert.equal(tables.rows[0].count, '0', 'Gate refuses a nonempty database');
  await client.query(
    'CREATE TABLE schema_migrations(filename TEXT PRIMARY KEY,applied_at TIMESTAMPTZ NOT NULL DEFAULT now())',
  );
  const files = (await readdir(resolve(root, 'db/migrations')))
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const filename of files.filter((f) => f < '0016')) {
    await client.query(await readFile(resolve(root, 'db/migrations', filename), 'utf8'));
    await client.query('INSERT INTO schema_migrations(filename) VALUES($1)', [filename]);
  }
  const user = (
    await client.query(
      "INSERT INTO users(email,password_hash,full_name,role) VALUES('upgrade@qa.local','fixture','Legacy resident QA','VIEWER') RETURNING id",
    )
  ).rows[0].id;
  const schedule = (
    await client.query(
      "INSERT INTO wellness_schedules(resident_user_id,name,check_at,days_of_week,lookback_hours,grace_seconds,timezone) VALUES($1,'Legacy retained','10:17','{1,3,5}',7,123,'Asia/Ho_Chi_Minh') RETURNING *",
      [user],
    )
  ).rows[0];
  const original = JSON.stringify(schedule);
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = spawnSync(process.execPath, ['tools/scripts/migrate.mjs', 'up'], {
      cwd: root,
      env: { ...process.env, DATABASE_URL: url },
      encoding: 'utf8',
    });
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    assert.equal(result.status, 0);
    assert.equal(
      JSON.stringify(
        (await client.query('SELECT * FROM wellness_schedules WHERE id=$1', [schedule.id])).rows[0],
      ),
      original,
    );
  }
  assert.equal(
    (await client.query('SELECT count(*) FROM schema_migrations')).rows[0].count,
    String(files.length),
  );
  assert.equal(
    (await client.query('SELECT count(*) FROM resident_wellness_source_evidence')).rows[0].count,
    '0',
  );
  assert.equal(
    (await client.query('SELECT count(*) FROM resident_wellness_track_links')).rows[0].count,
    '0',
  );
  console.log(
    JSON.stringify(
      {
        result: 'Passed',
        migrations: files.length,
        upgrade: '0015→0016',
        replay: 'no new migration',
        legacySchedule: 'unchanged',
        fresh: 'also covered by Testcontainers integration suites',
      },
      null,
      2,
    ),
  );
} finally {
  await client.end();
}
