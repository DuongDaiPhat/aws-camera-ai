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
 *
 * Can: docker compose --profile cv up -d  +  mot luong RTSP co nguoi (webcam/file).
 */

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

// Trung `container_name` cua service mosquitto trong docker-compose.yml
const CONTAINER_MQTT = 'camerai-mosquitto';

const MAC_DINH = { topic: 'frigate/events', timeout: 180, camera: null, label: 'person' };

function docThamSo(argv) {
  const thamSo = { ...MAC_DINH };
  for (let i = 0; i < argv.length; i += 1) {
    const ten = argv[i].replace(/^--/, '');
    if (ten in thamSo) {
      thamSo[ten] = ten === 'timeout' ? Number(argv[i + 1]) : argv[i + 1];
      i += 1;
    }
  }
  if (!Number.isFinite(thamSo.timeout) || thamSo.timeout <= 0) {
    console.error('  --timeout phai la so giay > 0');
    process.exit(1);
  }
  return thamSo;
}

const laChuoi = (v) => typeof v === 'string' && v.length > 0;
const laSo = (v) => typeof v === 'number' && Number.isFinite(v);
const laMangChuoi = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');

/**
 * Truong bat buoc theo AC cua US-01/US-02, ten ben trai la ten trong AC.
 * `after.id` chinh la track ID (docs/architecture/DATA_FLOW.md).
 */
const TRUONG_BAT_BUOC = [
  ['camera_id', 'camera', laChuoi],
  ['label', 'label', laChuoi],
  ['track_id', 'id', laChuoi],
  ['zones[]', 'current_zones', laMangChuoi],
  ['entered_zones[]', 'entered_zones', laMangChuoi],
  ['score', 'score', laSo],
  ['top_score', 'top_score', laSo],
  ['bounding box', 'box', (v) => Array.isArray(v) && v.length === 4 && v.every(laSo)],
  ['timestamp', 'frame_time', laSo],
  ['start_time', 'start_time', laSo],
  ['has_snapshot', 'has_snapshot', (v) => typeof v === 'boolean'],
];

/** Tra ve danh sach loi; mang rong nghia la message hop le. */
function kiemTraMessage(message) {
  const loi = [];
  if (!['new', 'update', 'end'].includes(message?.type)) {
    loi.push(`type khong hop le: ${JSON.stringify(message?.type)}`);
  }
  const after = message?.after;
  if (typeof after !== 'object' || after === null) {
    return [...loi, 'thieu object `after`'];
  }
  for (const [tenAC, truong, hopLe] of TRUONG_BAT_BUOC) {
    if (!hopLe(after[truong]))
      loi.push(`${tenAC} (after.${truong}) = ${JSON.stringify(after[truong])}`);
  }
  if (message.type === 'end' && !laSo(after.end_time)) {
    loi.push(`message end thieu end_time: ${JSON.stringify(after.end_time)}`);
  }
  return loi;
}

const gio = (epochGiay) => new Date(epochGiay * 1000).toISOString();

function tomTat(message) {
  const a = message.after;
  const snapshot = a.has_snapshot ? `/api/events/${a.id}/snapshot.jpg` : '(chua co)';
  const dong = [
    `  [${message.type.toUpperCase()}] ${a.camera} · ${a.label} · track ${a.id}`,
    `      score=${a.score.toFixed(2)} top_score=${a.top_score.toFixed(2)} box=[${a.box.join(', ')}]`,
    `      zones=[${a.current_zones.join(', ')}] start=${gio(a.start_time)} snapshot=${snapshot}`,
  ];
  if (message.type === 'end') dong.push(`      end=${gio(a.end_time)}`);
  return dong.join('\n');
}

// ---------------------------------------------------------------------------

const thamSo = docThamSo(process.argv.slice(2));
const trackDaMo = new Set();
let soMessage = 0;
let soLoi = 0;

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
    String(Math.ceil(thamSo.timeout) + 5),
  ],
  { stdio: ['ignore', 'pipe', 'inherit'] },
);

function ketThuc(maThoat, thongDiep) {
  clearTimeout(henGio);
  sub.kill();
  console.log(
    `\n  ${thongDiep}\n  Da nhan ${soMessage} message, ${soLoi} message sai dinh dang.\n`,
  );
  process.exit(maThoat);
}

const henGio = setTimeout(() => {
  const goiY =
    trackDaMo.size > 0
      ? 'Da co `new` nhung chua thay `end` — de nguoi roi khoi khung hinh hoac tang --timeout.'
      : 'Khong co su kien nao. Kiem tra luong RTSP dang phat va Frigate UI http://localhost:5000.';
  ketThuc(1, `THAT BAI: het ${thamSo.timeout} s. ${goiY}`);
}, thamSo.timeout * 1000);

sub.on('error', (error) => {
  clearTimeout(henGio);
  console.error(`  Khong chay duoc docker: ${error.message}`);
  process.exit(1);
});

sub.on('exit', (code) => {
  clearTimeout(henGio);
  console.error(
    `\n  mosquitto_sub dung (ma ${code}). Container mosquitto co dang chay? docker compose ps\n`,
  );
  process.exit(1);
});

createInterface({ input: sub.stdout }).on('line', (dong) => {
  let message;
  try {
    message = JSON.parse(dong);
  } catch {
    soLoi += 1;
    console.error(`  [LOI] payload khong phai JSON: ${dong.slice(0, 120)}`);
    return;
  }

  const after = message?.after ?? {};
  if (after.label !== thamSo.label) return;
  if (thamSo.camera && after.camera !== thamSo.camera) return;
  soMessage += 1;

  const loi = kiemTraMessage(message);
  if (loi.length > 0) {
    soLoi += 1;
    console.error(
      `  [LOI] message ${message.type} thieu/sai truong:\n    - ${loi.join('\n    - ')}`,
    );
    return;
  }

  // `update` rat nhieu (moi lan box/score doi) — chi dem, khong in
  if (message.type === 'update') return;
  console.log(tomTat(message));

  if (message.type === 'new') trackDaMo.add(after.id);
  if (message.type === 'end' && trackDaMo.has(after.id) && soLoi === 0) {
    ketThuc(
      0,
      `THANH CONG: track ${after.id} di du vong doi new -> end, moi message dung dinh dang.`,
    );
  }
});
