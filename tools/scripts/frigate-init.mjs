#!/usr/bin/env node
/**
 * Tạo infra/frigate/config.yml từ config.example.yml (US-01).
 *
 *   pnpm frigate:init            # chỉ tạo nếu chưa có
 *   pnpm frigate:init --force    # ghi đè bằng bản mẫu mới nhất
 *
 * VÌ SAO CẦN FILE NÀY:
 * Nếu chạy `docker compose --profile cv up` khi config.yml CHƯA tồn tại, Docker tự
 * tạo một THƯ MỤC rỗng tên `config.yml` để bind mount. Frigate khi đó chạy với cấu
 * hình mặc định (0 camera, MQTT tắt) mà không báo lỗi, và lệnh `cp` sau đó sẽ chép
 * file mẫu VÀO trong thư mục đó. Script này nhận ra và gỡ thư mục rỗng trước.
 * Logic nằm ở lib/frigate-config.mjs (có unit test).
 */

import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ConfigInitError, initConfig } from './lib/frigate-config.mjs';

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FRIGATE_DIR = join(ROOT_DIR, 'infra', 'frigate');
const TARGET_PATH = join(FRIGATE_DIR, 'config.yml');
const TARGET_DISPLAY_PATH = relative(ROOT_DIR, TARGET_PATH);

try {
  const { hasRemovedEmptyDirectory, result } = initConfig({
    templatePath: join(FRIGATE_DIR, 'config.example.yml'),
    targetPath: TARGET_PATH,
    shouldOverwrite: process.argv.includes('--force'),
  });

  if (hasRemovedEmptyDirectory) {
    console.log(
      `  Đã gỡ thư mục rỗng ${TARGET_DISPLAY_PATH} (do Docker tạo nhầm khi file chưa tồn tại).`,
    );
  }

  if (result === 'unchanged') {
    console.log(
      `  ${TARGET_DISPLAY_PATH} đã tồn tại — giữ nguyên. Dùng --force để tạo lại từ file mẫu.`,
    );
  } else {
    console.log(
      `  Đã ${result === 'overwritten' ? 'ghi đè' : 'tạo'} ${TARGET_DISPLAY_PATH}.\n` +
        '  Khởi động lại Frigate để nhận cấu hình:  docker compose --profile cv up -d --force-recreate frigate\n',
    );
  }
} catch (error) {
  // Lỗi không lường trước vẫn phải văng stack trace để còn gỡ lỗi
  if (!(error instanceof ConfigInitError)) throw error;
  console.error(`\n  ${error.message}\n`);
  process.exit(1);
}
