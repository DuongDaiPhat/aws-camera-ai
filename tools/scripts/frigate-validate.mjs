#!/usr/bin/env node
/**
 * Kiểm tra config Frigate bằng CHÍNH validator của image đang ghim trong docker-compose.yml.
 *
 *   pnpm frigate:validate                                      # config.yml, không có thì file mẫu
 *   pnpm frigate:validate -- infra/frigate/config.example.yml
 *
 * Unit test (pnpm test:tools) chỉ kiểm ràng buộc của dự án; schema thật của Frigate
 * chỉ image Frigate mới biết. Không cần container Frigate đang chạy.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

import { parseValidationOutput } from './lib/frigate-config.mjs';

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
// Lần đầu phải tải image Frigate vài GB
const DOCKER_RUN_TIMEOUT_MS = 10 * 60 * 1000;
// Không tách được lỗi (docker/image hỏng) thì in phần cuối output để tự đọc
const RAW_OUTPUT_TAIL_CHARS = 2000;

const isFile = (path) => existsSync(path) && statSync(path).isFile();

function resolveConfigPath(pathArg) {
  if (pathArg) return resolve(pathArg);
  const localConfigPath = join(ROOT_DIR, 'infra', 'frigate', 'config.yml');
  return isFile(localConfigPath)
    ? localConfigPath
    : join(ROOT_DIR, 'infra', 'frigate', 'config.example.yml');
}

const [pathArg] = process.argv.slice(2).filter((arg) => arg !== '--');
const configPath = resolveConfigPath(pathArg);
if (!isFile(configPath)) {
  console.error(`\n  Không tìm thấy file config: ${configPath}\n`);
  process.exit(1);
}

const compose = parse(readFileSync(join(ROOT_DIR, 'docker-compose.yml'), 'utf8'));
const frigateImage = compose.services.frigate.image;
console.log(`\n  Kiểm tra ${relative(ROOT_DIR, configPath)} bằng ${frigateImage} ...\n`);

const dockerRun = spawnSync(
  'docker',
  [
    'run',
    '--rm',
    '--entrypoint',
    'sh',
    '-v',
    `${configPath}:/config/config.yml:ro`,
    frigateImage,
    '-c',
    'cd /opt/frigate && python3 -u -m frigate --validate-config 2>&1',
  ],
  { encoding: 'utf8', timeout: DOCKER_RUN_TIMEOUT_MS },
);

if (dockerRun.error) {
  console.error(`  Không chạy được docker: ${dockerRun.error.message}\n`);
  process.exit(1);
}

const output = `${dockerRun.stdout}${dockerRun.stderr}`;
const { isValid, errors } = parseValidationOutput(output);
if (isValid) {
  console.log('  HỢP LỆ: Frigate chấp nhận cấu hình.\n');
  process.exit(0);
}

console.error('  KHÔNG HỢP LỆ:');
for (const { line, key, value, message } of errors) {
  console.error(`    - dòng ${line} · ${key} = ${value} → ${message}`);
}
if (errors.length === 0) console.error(output.slice(-RAW_OUTPUT_TAIL_CHARS));
console.error('');
process.exit(1);
