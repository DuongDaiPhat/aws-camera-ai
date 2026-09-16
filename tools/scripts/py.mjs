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
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVICE_DIR = join(ROOT, 'services', 'ai-service');
const IS_WINDOWS = process.platform === 'win32';

const VENV_PYTHON = IS_WINDOWS
  ? join(SERVICE_DIR, '.venv', 'Scripts', 'python.exe')
  : join(SERVICE_DIR, '.venv', 'bin', 'python');

/** Python cua he thong — chi dung de TAO venv. */
function timPythonHeThong() {
  for (const ungVien of IS_WINDOWS ? ['py', 'python', 'python3'] : ['python3', 'python']) {
    const args = ungVien === 'py' ? ['-3', '--version'] : ['--version'];
    const r = spawnSync(ungVien, args, { stdio: 'ignore', shell: IS_WINDOWS });  // can shell de do PATH
    if (r.status === 0) return { lenh: ungVien, themArgs: ungVien === 'py' ? ['-3'] : [] };
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
        '  Cai Python 3.11+ roi chay lai:  winget install Python.Python.3.11\n',
    );
    process.exit(1);
  }

  if (!existsSync(VENV_PYTHON)) {
    console.log('  Dang tao virtualenv tai services/ai-service/.venv ...');
    const r = chay(py.lenh, [...py.themArgs, '-m', 'venv', '.venv'], { timPATH: true });
    if (r.status !== 0) process.exit(r.status ?? 1);
  }

  console.log('  Dang cai dependency (pip install -e ".[dev]") ...');
  const r = chay(VENV_PYTHON, ['-m', 'pip', 'install', '--quiet', '--upgrade', 'pip']);
  if (r.status !== 0) process.exit(r.status ?? 1);

  const r2 = chay(VENV_PYTHON, ['-m', 'pip', 'install', '-e', '.[dev]']);
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
      '  (Tuong duong: cd services/ai-service && python -m venv .venv && pip install -e ".[dev]")\n',
  );
  process.exit(1);
}

// `ruff` va `pytest` deu chay duoc duoi dang module: python -m ruff / python -m pytest
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
