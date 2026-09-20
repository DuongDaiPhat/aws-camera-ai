#!/usr/bin/env node
/**
 * Chay migration SQL theo thu tu tang dan.
 *
 *   node tools/scripts/migrate.mjs up      # chay cac migration chua chay
 *   node tools/scripts/migrate.mjs status  # xem migration nao da chay
 *   node tools/scripts/migrate.mjs reset   # XOA SACH schema roi chay lai tu dau
 *
 * Doc DATABASE_URL tu bien moi truong (hoac tu .env).
 * Yeu cau: `pnpm add -w pg` (them o Sprint 1 khi bat dau dung that).
 *
 * Luu y: khi khoi tao container Postgres lan dau, docker-entrypoint-initdb.d
 * da tu chay cac file trong db/migrations. Script nay danh cho truong hop
 * them migration MOI vao database dang chay.
 */

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIGRATIONS_DIR = join(ROOT, 'db', 'migrations');

const BANG_LICH_SU = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    filename   TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
`;

async function layDanhSachFile() {
  const files = await readdir(MIGRATIONS_DIR);
  return files.filter((f) => f.endsWith('.sql')).sort();
}

async function ketNoi() {
  const url = process.env.DATABASE_URL?.replace('@postgres:5432', '@localhost:5432');
  if (!url) {
    console.error('Thieu DATABASE_URL. Chay: cp .env.example .env');
    process.exit(1);
  }

  let pg;
  try {
    pg = await import('pg');
  } catch {
    console.error('Chua cai goi "pg". Chay: pnpm add -w pg');
    process.exit(1);
  }

  const client = new pg.default.Client({ connectionString: url });
  await client.connect();
  return client;
}

async function up(client) {
  await client.query(BANG_LICH_SU);
  const { rows } = await client.query('SELECT filename FROM schema_migrations');
  const daChay = new Set(rows.map((r) => r.filename));

  let soFileMoi = 0;
  for (const file of await layDanhSachFile()) {
    if (daChay.has(file)) continue;

    console.log(`--> ${file}`);
    const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
    soFileMoi += 1;
  }

  console.log(soFileMoi === 0 ? 'Khong co migration moi.' : `Da chay ${soFileMoi} migration.`);
}

async function status(client) {
  await client.query(BANG_LICH_SU);
  const { rows } = await client.query('SELECT filename, applied_at FROM schema_migrations');
  const daChay = new Map(rows.map((r) => [r.filename, r.applied_at]));

  for (const file of await layDanhSachFile()) {
    const thoiDiem = daChay.get(file);
    console.log(`${thoiDiem ? '[x]' : '[ ]'} ${file}${thoiDiem ? `  (${thoiDiem.toISOString()})` : ''}`);
  }
}

async function reset(client) {
  console.log('Xoa sach schema public...');
  await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await up(client);
}

const lenh = process.argv[2] ?? 'up';
const handlers = { up, status, reset };

if (!handlers[lenh]) {
  console.error(`Lenh khong hop le: ${lenh}. Dung: up | status | reset`);
  process.exit(1);
}

const client = await ketNoi();
try {
  await handlers[lenh](client);
} finally {
  await client.end();
}
