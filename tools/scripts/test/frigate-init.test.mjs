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

import { ConfigInitError, initConfig } from '../lib/frigate-config.mjs';

const TEMPLATE_CONTENT = 'mqtt:\n  enabled: true\nversion: 0.18-0\n';

describe('initConfig', () => {
  let tempDir;
  let templatePath;
  let targetPath;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'frigate-init-'));
    templatePath = join(tempDir, 'config.example.yml');
    targetPath = join(tempDir, 'config.yml');
    writeFileSync(templatePath, TEMPLATE_CONTENT);
  });

  afterEach(() => rmSync(tempDir, { recursive: true, force: true }));

  it('tạo config.yml từ file mẫu khi chưa có', () => {
    const outcome = initConfig({ templatePath, targetPath });

    assert.deepEqual(outcome, { hasRemovedEmptyDirectory: false, result: 'created' });
    assert.equal(readFileSync(targetPath, 'utf8'), TEMPLATE_CONTENT);
  });

  it('giữ nguyên config.yml đã chỉnh tay khi không có --force', () => {
    writeFileSync(targetPath, 'cấu hình riêng của máy');

    const outcome = initConfig({ templatePath, targetPath });

    assert.equal(outcome.result, 'unchanged');
    assert.equal(readFileSync(targetPath, 'utf8'), 'cấu hình riêng của máy');
  });

  it('ghi đè config.yml khi có --force', () => {
    writeFileSync(targetPath, 'cấu hình cũ 0.14');

    const outcome = initConfig({ templatePath, targetPath, shouldOverwrite: true });

    assert.equal(outcome.result, 'overwritten');
    assert.equal(readFileSync(targetPath, 'utf8'), TEMPLATE_CONTENT);
  });

  it('gỡ thư mục rỗng Docker tạo nhầm rồi tạo file', () => {
    mkdirSync(targetPath);

    const outcome = initConfig({ templatePath, targetPath });

    assert.deepEqual(outcome, { hasRemovedEmptyDirectory: true, result: 'created' });
    assert.ok(statSync(targetPath).isFile());
  });

  it('không xóa thư mục config.yml có nội dung, ném ConfigInitError', () => {
    mkdirSync(targetPath);
    writeFileSync(join(targetPath, 'quan-trong.txt'), 'dữ liệu');

    assert.throws(
      () => initConfig({ templatePath, targetPath, shouldOverwrite: true }),
      (error) => error instanceof ConfigInitError && /không rỗng/.test(error.message),
    );
    assert.ok(existsSync(join(targetPath, 'quan-trong.txt')));
  });

  it('ném ConfigInitError dễ hiểu khi thiếu file mẫu thay vì stack trace của fs', () => {
    rmSync(templatePath);

    assert.throws(
      () => initConfig({ templatePath, targetPath }),
      (error) => error instanceof ConfigInitError && /Không tìm thấy file mẫu/.test(error.message),
    );
    assert.equal(existsSync(targetPath), false);
  });

  it('ném ConfigInitError khi đường dẫn file mẫu là thư mục', () => {
    rmSync(templatePath);
    mkdirSync(templatePath);

    assert.throws(() => initConfig({ templatePath, targetPath }), ConfigInitError);
  });

  it('chạy lại lần hai không đổi gì (idempotent)', () => {
    initConfig({ templatePath, targetPath });

    const secondOutcome = initConfig({ templatePath, targetPath });

    assert.deepEqual(secondOutcome, { hasRemovedEmptyDirectory: false, result: 'unchanged' });
  });
});

describe('frigate-init.mjs (CLI)', () => {
  const SCRIPTS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

  it('thoát mã 1 với thông báo gọn, không stack trace, khi repo thiếu file mẫu', () => {
    // Chép script + lib vào một repo giả chỉ có infra/frigate rỗng
    const fakeRepoDir = mkdtempSync(join(tmpdir(), 'frigate-init-cli-'));
    try {
      mkdirSync(join(fakeRepoDir, 'tools', 'scripts', 'lib'), { recursive: true });
      mkdirSync(join(fakeRepoDir, 'infra', 'frigate'), { recursive: true });
      for (const relativePath of ['frigate-init.mjs', join('lib', 'frigate-config.mjs')]) {
        writeFileSync(
          join(fakeRepoDir, 'tools', 'scripts', relativePath),
          readFileSync(join(SCRIPTS_DIR, relativePath)),
        );
      }

      const cliRun = spawnSync(
        process.execPath,
        [join(fakeRepoDir, 'tools', 'scripts', 'frigate-init.mjs')],
        { encoding: 'utf8' },
      );

      assert.equal(cliRun.status, 1);
      assert.match(cliRun.stderr, /Không tìm thấy file mẫu/);
      assert.doesNotMatch(cliRun.stderr, /at .*\(node:/);
    } finally {
      rmSync(fakeRepoDir, { recursive: true, force: true });
    }
  });
});
