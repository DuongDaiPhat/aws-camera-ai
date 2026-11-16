import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import pg from 'pg';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
let locked = false;
try {
  const lock = await client.query('SELECT pg_try_advisory_lock(701103) AS acquired');
  locked = lock.rows[0].acquired;
  if (!locked) throw new Error('Another migration is running');
  const state = await client.query(`SELECT
    to_regclass('public.users') IS NOT NULL AS has_app,
    to_regclass('public.cd_schema_migrations') IS NOT NULL AS has_history`);
  if (state.rows[0].has_app && !state.rows[0].has_history) {
    throw new Error('Existing DB needs reviewed baseline; do not replay initial schema');
  }
  await client.query(`CREATE TABLE IF NOT EXISTS cd_schema_migrations (
    filename text PRIMARY KEY, sha256 text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now())`);
  const applied = await client.query('SELECT filename, sha256 FROM cd_schema_migrations');
  const history = new Map(applied.rows.map((row) => [row.filename, row.sha256]));
  const directory = '/workspace/db/migrations';
  const files = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = (await readFile(`${directory}/${file}`, 'utf8')).replace(/\r\n/g, '\n');
    const hash = createHash('sha256').update(sql).digest('hex');
    if (history.has(file)) {
      if (history.get(file) !== hash) throw new Error(`Applied SQL changed: ${file}`);
      continue;
    }
    const begins = [...sql.matchAll(/^BEGIN;[ \t]*$/gim)].length;
    const commits = [...sql.matchAll(/^COMMIT;[ \t]*$/gim)].length;
    if (!((begins === 0 && commits === 0) || (begins === 1 && commits === 1))) {
      throw new Error(`Review transaction structure: ${file}`);
    }
    const body = sql.replace(/^BEGIN;[ \t]*$/im, '').replace(/^COMMIT;[ \t]*$/im, '');
    await client.query('BEGIN');
    try {
      await client.query(body);
      await client.query('INSERT INTO cd_schema_migrations(filename, sha256) VALUES ($1, $2)', [
        file,
        hash,
      ]);
      await client.query('COMMIT');
      console.log(`Applied ${file}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
} finally {
  if (locked) await client.query('SELECT pg_advisory_unlock(701103)');
  await client.end();
}
