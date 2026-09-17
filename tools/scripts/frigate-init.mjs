#!/usr/bin/env node
/**
 * Tao infra/frigate/config.yml tu config.example.yml (US-01).
 *
 *   pnpm frigate:init            # chi tao neu chua co
 *   pnpm frigate:init --force    # ghi de bang ban mau moi nhat
 *
 * VI SAO CAN FILE NAY:
 * Neu chay `docker compose --profile cv up` khi config.yml CHUA ton tai, Docker tu
 * tao mot THU MUC rong ten `config.yml` de bind mount. Frigate khi do chay voi cau
 * hinh mac dinh (0 camera, MQTT tat) ma khong bao loi, va lenh `cp` sau do se chep
 * file mau VAO trong thu muc do. Script nay nhan ra va go thu muc rong truoc.
 * Logic nam o lib/frigate-config.mjs (co unit test).
 */

import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { khoiTaoConfig, LoiKhoiTaoConfig } from './lib/frigate-config.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FRIGATE_DIR = join(ROOT, 'infra', 'frigate');
const duongDanMay = join(FRIGATE_DIR, 'config.yml');
const tenTuongDoi = relative(ROOT, duongDanMay);

try {
  const { daGoThuMucRong, ketQua } = khoiTaoConfig({
    duongDanMau: join(FRIGATE_DIR, 'config.example.yml'),
    duongDanMay,
    ghiDe: process.argv.includes('--force'),
  });

  if (daGoThuMucRong) {
    console.log(`  Da go thu muc rong ${tenTuongDoi} (do Docker tao nham khi file chua ton tai).`);
  }
  if (ketQua === 'giu_nguyen') {
    console.log(`  ${tenTuongDoi} da ton tai — giu nguyen. Dung --force de tao lai tu file mau.`);
  } else {
    console.log(
      `  Da ${ketQua === 'da_ghi_de' ? 'ghi de' : 'tao'} ${tenTuongDoi}.\n` +
        '  Khoi dong lai Frigate de nhan cau hinh:  docker compose --profile cv up -d --force-recreate frigate\n',
    );
  }
} catch (error) {
  if (!(error instanceof LoiKhoiTaoConfig)) throw error;
  console.error(`\n  ${error.message}\n`);
  process.exit(1);
}
