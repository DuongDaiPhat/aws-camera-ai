#!/usr/bin/env node
/**
 * Kiem tra config Frigate bang CHINH validator cua image dang ghim trong docker-compose.yml.
 *
 *   pnpm frigate:validate                                      # config.yml, khong co thi file mau
 *   pnpm frigate:validate -- infra/frigate/config.example.yml
 *
 * Unit test (pnpm test:tools) chi kiem rang buoc cua du an; schema that cua Frigate
 * chi image Frigate moi biet. Khong can container Frigate dang chay.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

import { phanTichKetQuaValidate } from './lib/frigate-config.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
// Lan dau phai tai image Frigate vai GB
const THOI_GIAN_CHO_TOI_DA_MS = 10 * 60 * 1000;

const laFile = (duongDan) => existsSync(duongDan) && statSync(duongDan).isFile();

function chonFileConfig(doiSo) {
  if (doiSo) return resolve(doiSo);
  const configMay = join(ROOT, 'infra', 'frigate', 'config.yml');
  return laFile(configMay) ? configMay : join(ROOT, 'infra', 'frigate', 'config.example.yml');
}

const [doiSoFile] = process.argv.slice(2).filter((doiSo) => doiSo !== '--');
const fileConfig = chonFileConfig(doiSoFile);
if (!laFile(fileConfig)) {
  console.error(`\n  Khong tim thay file config: ${fileConfig}\n`);
  process.exit(1);
}

const compose = parse(readFileSync(join(ROOT, 'docker-compose.yml'), 'utf8'));
const image = compose.services.frigate.image;
console.log(`\n  Kiem tra ${relative(ROOT, fileConfig)} bang ${image} ...\n`);

const ketQua = spawnSync(
  'docker',
  [
    'run',
    '--rm',
    '--entrypoint',
    'sh',
    '-v',
    `${fileConfig}:/config/config.yml:ro`,
    image,
    '-c',
    'cd /opt/frigate && python3 -u -m frigate --validate-config 2>&1',
  ],
  { encoding: 'utf8', timeout: THOI_GIAN_CHO_TOI_DA_MS },
);

if (ketQua.error) {
  console.error(`  Khong chay duoc docker: ${ketQua.error.message}\n`);
  process.exit(1);
}

const output = `${ketQua.stdout}${ketQua.stderr}`;
const { hopLe, loi } = phanTichKetQuaValidate(output);
if (hopLe) {
  console.log('  HOP LE: Frigate chap nhan cau hinh.\n');
  process.exit(0);
}

console.error('  KHONG HOP LE:');
for (const { dong, khoa, giaTri, thongDiep } of loi) {
  console.error(`    - dong ${dong} · ${khoa} = ${giaTri} -> ${thongDiep}`);
}
// Khong tach duoc loi (docker/image hong) -> in phan cuoi output de tu doc
if (loi.length === 0) console.error(output.slice(-2000));
console.error('');
process.exit(1);
