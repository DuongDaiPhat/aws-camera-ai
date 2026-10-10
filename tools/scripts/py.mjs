#!/usr/bin/env node
/**
 * Chay cong cu Python cua AI service MA KHONG CAN activate venv.
 *
 *   node tools/scripts/py.mjs ruff check .
 *   node tools/scripts/py.mjs pytest
 *   node tools/scripts/py.mjs --setup            # tao venv + cai dependency
 *
 * Thuong duoc goi qua script cua pnpm: `pnpm lint:ai`, `pnpm test:ai`, `pnpm check:ai`.
 *
 * VI SAO CAN FILE NAY:
 * `ruff` va `pytest` chi ton tai BEN TRONG `services/ai-service/.venv`, khong nam
 * tren PATH toan cuc. Ai quen activate venv — hoac mo mot terminal moi — se gap
 * "ruff: command not found". Script nay tu tim python trong venv nen lenh chay
 * giong nhau o PowerShell, CMD, Git Bash, macOS va Linux.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVICE_DIR = join(ROOT, 'services', 'ai-service');
const IS_WINDOWS = process.platform === 'win32';
const PYTHON_VERSION = readFileSync(join(SERVICE_DIR, '.python-version'), 'utf8').trim();
const VENV_DIR = process.env.CAMERAI_VENV
  ? resolve(ROOT, process.env.CAMERAI_VENV)
  : join(SERVICE_DIR, '.venv');
const DEV_LOCK = IS_WINDOWS ? 'requirements-dev-windows.lock' : 'requirements-dev.lock';

const VENV_PYTHON = IS_WINDOWS
  ? join(VENV_DIR, 'Scripts', 'python.exe')
  : join(VENV_DIR, 'bin', 'python');

function dungPhienBan(lenh, args = []) {
  const result = spawnSync(
    lenh,
    [...args, '-c', 'import platform; print(platform.python_version())'],
    {
      encoding: 'utf8',
      shell: false,
    },
  );
  return result.status === 0 && result.stdout.trim() === PYTHON_VERSION;
}

function kiemTraVenv() {
  if (!dungPhienBan(VENV_PYTHON)) {
    console.error(
      `  Venv phai dung Python ${PYTHON_VERSION}. Khong tu xoa venv cu. ` +
        'Dung CAMERAI_PYTHON va CAMERAI_VENV de tao moi truong rieng (xem dependency baseline).',
    );
    process.exit(1);
  }
}

/** Python cua he thong — chi dung de TAO venv. */
function timPythonHeThong() {
  if (process.env.CAMERAI_PYTHON) {
    return dungPhienBan(process.env.CAMERAI_PYTHON)
      ? { lenh: process.env.CAMERAI_PYTHON, themArgs: [] }
      : null;
  }
  for (const ungVien of IS_WINDOWS ? ['py', 'python'] : ['python3.11', 'python3', 'python']) {
    const args = ungVien === 'py' ? ['-3.11'] : [];
    if (dungPhienBan(ungVien, args)) return { lenh: ungVien, themArgs: args };
  }
  return null;
}

/**
 * `shell` chi bat khi phai TIM lenh tren PATH (vd: `py`, `python`).
 * Voi duong dan tuyet doi cua venv thi PHAI tat shell: cmd.exe khong tu them
 * dau nhay, nen duong dan co dau cach (`D:\hoc tap\...`) se bi cat doi va bao
 * "'D:\hoc' is not recognized".
 */
function chay(lenh, args, { cwd = SERVICE_DIR, timPATH = false } = {}) {
  return spawnSync(lenh, args, { cwd, stdio: 'inherit', shell: IS_WINDOWS && timPATH });
}

function setup() {
  const py = timPythonHeThong();
  if (!py) {
    console.error(
      '\n  Khong tim thay Python tren may.\n' +
        `  Can Python ${PYTHON_VERSION}; chi dinh executable bang CAMERAI_PYTHON.\n`,
    );
    process.exit(1);
  }

  if (!existsSync(VENV_PYTHON)) {
    console.log(`  Dang tao virtualenv tai ${VENV_DIR} ...`);
    const r = chay(py.lenh, [...py.themArgs, '-m', 'venv', VENV_DIR]);
    if (r.status !== 0) process.exit(r.status ?? 1);
  }

  kiemTraVenv();
  console.log(`  Dang cai dependency tu ${DEV_LOCK} (hash-locked) ...`);
  const r = chay(VENV_PYTHON, ['-m', 'pip', 'install', '--require-hashes', '-r', DEV_LOCK]);
  if (r.status !== 0) process.exit(r.status ?? 1);

  const r2 = chay(VENV_PYTHON, [
    '-m',
    'pip',
    'install',
    '--no-deps',
    '--no-build-isolation',
    '-e',
    '.[dev,m2a,m3]',
  ]);
  if (r2.status !== 0) process.exit(r2.status ?? 1);

  console.log('\n  Xong. Gio chay duoc: pnpm check:ai\n');
}

// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);

if (argv[0] === '--setup') {
  setup();
  process.exit(0);
}

if (argv.length === 0) {
  console.error('  Thieu tham so. Vi du: node tools/scripts/py.mjs ruff check .');
  process.exit(1);
}

if (!existsSync(VENV_PYTHON)) {
  console.error(
    '\n  Chua co virtualenv cho AI service.\n\n' +
      '  Chay mot lenh duy nhat de tao va cai dependency:\n\n' +
      '      pnpm setup:ai\n\n' +
      '  Xem docs/sprint-3/DEPENDENCY_BASELINE.md de chon Python va lock dung OS.\n',
  );
  process.exit(1);
}

// `ruff` va `pytest` deu chay duoc duoi dang module: python -m ruff / python -m pytest
kiemTraVenv();
const ketQua = chay(VENV_PYTHON, ['-m', ...argv]);

if (ketQua.error) {
  console.error(`  Khong chay duoc: ${ketQua.error.message}`);
  process.exit(1);
}

if (ketQua.status !== 0 && argv[0] === 'ruff') {
  // Phan biet "chua cai ruff" voi "ruff tim thay loi that"
  const coRuff = chay(VENV_PYTHON, ['-c', 'import ruff'], { cwd: SERVICE_DIR });
  if (coRuff.status !== 0) {
    console.error('\n  Co ve dependency chua duoc cai day du. Chay: pnpm setup:ai\n');
  }
}

process.exit(ketQua.status ?? 1);
