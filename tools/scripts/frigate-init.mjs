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
 */

import { copyFileSync, existsSync, readdirSync, rmdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FRIGATE_DIR = join(ROOT, 'infra', 'frigate');
const CONFIG_MAU = join(FRIGATE_DIR, 'config.example.yml');
const CONFIG_MAY = join(FRIGATE_DIR, 'config.yml');

const ghiDe = process.argv.includes('--force');
const tenTuongDoi = relative(ROOT, CONFIG_MAY);

if (existsSync(CONFIG_MAY) && statSync(CONFIG_MAY).isDirectory()) {
  if (readdirSync(CONFIG_MAY).length > 0) {
    console.error(
      `\n  ${tenTuongDoi} dang la THU MUC va khong rong — khong dam tu xoa.\n` +
        '  Kiem tra noi dung, xoa thu cong roi chay lai: pnpm frigate:init\n',
    );
    process.exit(1);
  }
  rmdirSync(CONFIG_MAY);
  console.log(`  Da go thu muc rong ${tenTuongDoi} (do Docker tao nham khi file chua ton tai).`);
}

if (existsSync(CONFIG_MAY) && !ghiDe) {
  console.log(`  ${tenTuongDoi} da ton tai — giu nguyen. Dung --force de tao lai tu file mau.`);
  process.exit(0);
}

copyFileSync(CONFIG_MAU, CONFIG_MAY);
console.log(
  `  Da tao ${tenTuongDoi}.\n` +
    '  Khoi dong lai Frigate de nhan cau hinh:  docker compose --profile cv up -d --force-recreate frigate\n',
);
