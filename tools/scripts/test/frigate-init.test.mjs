import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { khoiTaoConfig, LoiKhoiTaoConfig } from '../lib/frigate-config.mjs';

const NOI_DUNG_MAU = 'mqtt:\n  enabled: true\nversion: 0.18-0\n';

describe('khoiTaoConfig', () => {
  let thuMuc;
  let duongDanMau;
  let duongDanMay;

  beforeEach(() => {
    thuMuc = mkdtempSync(join(tmpdir(), 'frigate-init-'));
    duongDanMau = join(thuMuc, 'config.example.yml');
    duongDanMay = join(thuMuc, 'config.yml');
    writeFileSync(duongDanMau, NOI_DUNG_MAU);
  });

  afterEach(() => rmSync(thuMuc, { recursive: true, force: true }));

  it('tạo config.yml từ file mẫu khi chưa có', () => {
    const ketQua = khoiTaoConfig({ duongDanMau, duongDanMay });

    assert.deepEqual(ketQua, { daGoThuMucRong: false, ketQua: 'da_tao' });
    assert.equal(readFileSync(duongDanMay, 'utf8'), NOI_DUNG_MAU);
  });

  it('giữ nguyên config.yml đã chỉnh tay khi không có --force', () => {
    writeFileSync(duongDanMay, 'cau hinh rieng cua may');

    const ketQua = khoiTaoConfig({ duongDanMau, duongDanMay });

    assert.equal(ketQua.ketQua, 'giu_nguyen');
    assert.equal(readFileSync(duongDanMay, 'utf8'), 'cau hinh rieng cua may');
  });

  it('ghi đè config.yml khi có --force', () => {
    writeFileSync(duongDanMay, 'cau hinh cu 0.14');

    const ketQua = khoiTaoConfig({ duongDanMau, duongDanMay, ghiDe: true });

    assert.equal(ketQua.ketQua, 'da_ghi_de');
    assert.equal(readFileSync(duongDanMay, 'utf8'), NOI_DUNG_MAU);
  });

  it('gỡ thư mục rỗng Docker tạo nhầm rồi tạo file', () => {
    mkdirSync(duongDanMay);

    const ketQua = khoiTaoConfig({ duongDanMau, duongDanMay });

    assert.deepEqual(ketQua, { daGoThuMucRong: true, ketQua: 'da_tao' });
    assert.ok(statSync(duongDanMay).isFile());
  });

  it('không xóa thư mục config.yml có nội dung, ném LoiKhoiTaoConfig', () => {
    mkdirSync(duongDanMay);
    writeFileSync(join(duongDanMay, 'quan-trong.txt'), 'du lieu');

    assert.throws(
      () => khoiTaoConfig({ duongDanMau, duongDanMay, ghiDe: true }),
      (error) => error instanceof LoiKhoiTaoConfig && /khong rong/.test(error.message),
    );
    assert.ok(existsSync(join(duongDanMay, 'quan-trong.txt')));
  });

  it('ném LoiKhoiTaoConfig dễ hiểu khi thiếu file mẫu thay vì stack trace của fs', () => {
    rmSync(duongDanMau);

    assert.throws(
      () => khoiTaoConfig({ duongDanMau, duongDanMay }),
      (error) => error instanceof LoiKhoiTaoConfig && /Khong tim thay file mau/.test(error.message),
    );
    assert.equal(existsSync(duongDanMay), false);
  });

  it('ném LoiKhoiTaoConfig khi đường dẫn file mẫu là thư mục', () => {
    rmSync(duongDanMau);
    mkdirSync(duongDanMau);

    assert.throws(() => khoiTaoConfig({ duongDanMau, duongDanMay }), LoiKhoiTaoConfig);
  });

  it('chạy lại lần hai không đổi gì (idempotent)', () => {
    khoiTaoConfig({ duongDanMau, duongDanMay });

    const lanHai = khoiTaoConfig({ duongDanMau, duongDanMay });

    assert.deepEqual(lanHai, { daGoThuMucRong: false, ketQua: 'giu_nguyen' });
  });
});

describe('frigate-init.mjs (CLI)', () => {
  const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'frigate-init.mjs');

  it('thoát mã 1 với thông báo gọn, không stack trace, khi repo thiếu file mẫu', () => {
    // Chep script + lib vao repo gia chi co infra/frigate rong
    const repoGia = mkdtempSync(join(tmpdir(), 'frigate-init-cli-'));
    try {
      mkdirSync(join(repoGia, 'tools', 'scripts', 'lib'), { recursive: true });
      mkdirSync(join(repoGia, 'infra', 'frigate'), { recursive: true });
      for (const tep of ['frigate-init.mjs', join('lib', 'frigate-config.mjs')]) {
        writeFileSync(
          join(repoGia, 'tools', 'scripts', tep),
          readFileSync(join(dirname(SCRIPT), tep)),
        );
      }

      const ketQua = spawnSync(
        process.execPath,
        [join(repoGia, 'tools', 'scripts', 'frigate-init.mjs')],
        {
          encoding: 'utf8',
        },
      );

      assert.equal(ketQua.status, 1);
      assert.match(ketQua.stderr, /Khong tim thay file mau/);
      assert.doesNotMatch(ketQua.stderr, /at .*\(node:/);
    } finally {
      rmSync(repoGia, { recursive: true, force: true });
    }
  });
});
