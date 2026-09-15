#!/usr/bin/env node
/**
 * Nap du lieu mau cho moi truong dev (US-07).
 *
 *   node tools/scripts/seed.mjs
 *
 * SKELETON Sprint 0: chay file db/seeds/*.sql theo thu tu.
 * Sprint 1 (US-07) se bo sung:
 *   - 1 admin, 1 caregiver
 *   - 2 camera, 3 zone
 *   - 5 known_face (can AI service de sinh embedding -> lam sau)
 *   - 20 su kien mau du cac loai
 *
 * Mat khau trong seed la mat khau DEV. Khong bao gio dung o moi truong that.
 */

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SEEDS_DIR = join(ROOT, 'db', 'seeds');

if (process.env.NODE_ENV === 'production') {
  console.error('Tu choi chay seed o moi truong production.');
  process.exit(1);
}

const url = process.env.DATABASE_URL;
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

try {
  const files = (await readdir(SEEDS_DIR)).filter((f) => f.endsWith('.sql')).sort();

  if (files.length === 0) {
    console.log('Chua co file seed nao trong db/seeds/.');
  }

  for (const file of files) {
    console.log(`--> ${file}`);
    await client.query(await readFile(join(SEEDS_DIR, file), 'utf8'));
  }

  console.log('Seed xong.');
} finally {
  await client.end();
}
