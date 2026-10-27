import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SCRIPT_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'check-secrets.mjs');

describe('check-secrets scanner', () => {
  it('cho phép chạy quét --all thành công trên repository hiện tại', () => {
    const res = spawnSync('node', [SCRIPT_PATH, '--all'], { encoding: 'utf8' });
    assert.equal(res.status, 0, `Quét thất bại: ${res.stderr || res.stdout}`);
    assert.match(res.stdout, /HOÀN TOÀN SẠCH/);
  });
});
