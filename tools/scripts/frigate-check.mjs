#!/usr/bin/env node
/**
 * Kiem tra nghiem thu US-01 + US-02: Frigate phat hien "person" va publish len MQTT.
 *
 *   pnpm frigate:check                          # cho toi da 180 s
 *   pnpm frigate:check -- --camera cam_test --timeout 300
 *
 * Nghe topic `frigate/events` qua mosquitto_sub BEN TRONG container (khong can cai
 * MQTT client tren may), kiem tra tung message co du truong ma AC yeu cau, va chi
 * thanh cong khi thay tron mot vong doi track: `new` -> `end` cung track_id.
 * Logic kiem tra nam o lib/frigate-events.mjs (co unit test).
 *
 * Can: docker compose --profile cv up -d  +  mot luong RTSP co nguoi (webcam/file).
 */

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

import { docThamSo, taoBoNghiemThu } from './lib/frigate-events.mjs';

// Trung `container_name` cua service mosquitto trong docker-compose.yml
const CONTAINER_MQTT = 'camerai-mosquitto';
// mosquitto_sub trong container song lau hon script mot chut, roi tu thoat
const DU_PHONG_MOSQUITTO_SUB_GIAY = 5;

const { thamSo, loi: loiThamSo } = docThamSo(process.argv.slice(2));
if (loiThamSo.length > 0) {
  console.error(`\n  ${loiThamSo.join('\n  ')}\n`);
  console.error(
    '  Dung: pnpm frigate:check -- [--camera <slug>] [--timeout <giay>] [--label <nhan>] [--topic <topic>]\n',
  );
  process.exit(1);
}

const boNghiemThu = taoBoNghiemThu(thamSo);

console.log(
  `\n  Dang nghe ${thamSo.topic} (label=${thamSo.label}` +
    `${thamSo.camera ? `, camera=${thamSo.camera}` : ''}) toi da ${thamSo.timeout} s ...\n`,
);

// Goi thang `docker exec` thay vi `docker compose exec`: tren Windows, compose sinh them
// tien trinh con `docker-compose.exe` ma sub.kill() khong diet duoc -> treo terminal.
// `-W` bat mosquitto_sub trong container tu thoat, ke ca khi script bi Ctrl+C.
const sub = spawn(
  'docker',
  [
    'exec',
    CONTAINER_MQTT,
    'mosquitto_sub',
    '-t',
    thamSo.topic,
    '-W',
    String(Math.ceil(thamSo.timeout) + DU_PHONG_MOSQUITTO_SUB_GIAY),
  ],
  { stdio: ['ignore', 'pipe', 'inherit'] },
);

function ketThuc(maThoat, thongDiep) {
  clearTimeout(henGio);
  sub.removeAllListeners('exit');
  sub.kill();
  const { soMessage, soLoi } = boNghiemThu.thongKe;
  console.log(
    `\n  ${thongDiep}\n  Da nhan ${soMessage} message, ${soLoi} message sai dinh dang.\n`,
  );
  process.exit(maThoat);
}

const henGio = setTimeout(
  () => ketThuc(1, boNghiemThu.goiYHetGio(thamSo.timeout)),
  thamSo.timeout * 1000,
);

sub.on('error', (error) => {
  clearTimeout(henGio);
  console.error(`  Khong chay duoc docker: ${error.message}`);
  process.exit(1);
});

sub.on('exit', (code) => {
  clearTimeout(henGio);
  console.error(
    `\n  mosquitto_sub dung (ma ${code}). Container ${CONTAINER_MQTT} co dang chay? docker compose ps\n`,
  );
  process.exit(1);
});

createInterface({ input: sub.stdout }).on('line', (dong) => {
  const hanhDong = boNghiemThu.xuLyDong(dong);
  if (hanhDong.loai === 'in') console.log(hanhDong.thongDiep);
  if (hanhDong.loai === 'thanh_cong') ketThuc(0, hanhDong.thongDiep.trimStart());
  if (hanhDong.loai === 'loi') {
    ketThuc(1, `THAT BAI: ${hanhDong.thongDiep}`);
  }
});
