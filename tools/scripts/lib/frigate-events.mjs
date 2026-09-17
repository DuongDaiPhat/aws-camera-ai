/**
 * Logic thuan (khong I/O) cua `pnpm frigate:check` — tach rieng de unit test.
 * Nghiem thu US-01 + US-02: payload `frigate/events` du truong AC, vong doi new -> end.
 */

export const MAC_DINH = Object.freeze({
  topic: 'frigate/events',
  timeout: 180,
  camera: null,
  label: 'person',
});

/**
 * setTimeout cua Node chi nhan toi da 2^31-1 ms (~24,8 ngay); lon hon thi Node
 * canh bao va cho chay NGAY sau 1 ms -> script bao that bai tuc thi.
 */
export const TIMEOUT_TOI_DA_GIAY = Math.floor(2 ** 31 / 1000) - 1;

/**
 * Doc tham so dong lenh. Khong goi process.exit — tra `loi` de noi goi tu quyet.
 * @returns {{ thamSo: typeof MAC_DINH, loi: string[] }}
 */
export function docThamSo(argv) {
  const thamSo = { ...MAC_DINH };
  const loi = [];

  for (let i = 0; i < argv.length; i += 1) {
    const doiSo = argv[i];
    // pnpm chuyen tiep ca dau `--` phan cach: `pnpm frigate:check -- --camera x`
    if (doiSo === '--') continue;

    const ten = doiSo.startsWith('--') ? doiSo.slice(2) : null;
    // Object.hasOwn: tranh `--toString`, `--constructor` lot qua toan tu `in`
    if (ten === null || !Object.hasOwn(MAC_DINH, ten)) {
      loi.push(`tham so khong ho tro: ${doiSo}`);
      continue;
    }

    const giaTri = argv[i + 1];
    if (giaTri === undefined || giaTri.startsWith('--')) {
      loi.push(`--${ten} thieu gia tri`);
      continue;
    }
    thamSo[ten] = ten === 'timeout' ? Number(giaTri) : giaTri;
    i += 1;
  }

  if (!Number.isFinite(thamSo.timeout) || thamSo.timeout <= 0) {
    loi.push('--timeout phai la so giay > 0');
  } else if (thamSo.timeout > TIMEOUT_TOI_DA_GIAY) {
    loi.push(`--timeout toi da ${TIMEOUT_TOI_DA_GIAY} giay`);
  }

  return { thamSo, loi };
}

const laChuoi = (v) => typeof v === 'string' && v.length > 0;
const laSo = (v) => typeof v === 'number' && Number.isFinite(v);
const laMangChuoi = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');
const laDiem = (v) => laSo(v) && v >= 0 && v <= 1;
const laBox = (v) =>
  Array.isArray(v) &&
  v.length === 4 &&
  v.every((toaDo) => laSo(toaDo) && toaDo >= 0) &&
  v[0] <= v[2] &&
  v[1] <= v[3];

export const LOAI_HOP_LE = Object.freeze(['new', 'update', 'end']);

/**
 * Truong bat buoc theo AC cua US-01/US-02, cot dau la ten trong AC.
 * `after.id` chinh la track ID (docs/architecture/DATA_FLOW.md).
 */
export const TRUONG_BAT_BUOC = Object.freeze([
  ['camera_id', 'camera', laChuoi],
  ['label', 'label', laChuoi],
  ['track_id', 'id', laChuoi],
  ['zones[]', 'current_zones', laMangChuoi],
  ['entered_zones[]', 'entered_zones', laMangChuoi],
  ['score', 'score', laDiem],
  ['top_score', 'top_score', laDiem],
  ['bounding box', 'box', laBox],
  ['timestamp', 'frame_time', laSo],
  ['start_time', 'start_time', laSo],
  ['has_snapshot', 'has_snapshot', (v) => typeof v === 'boolean'],
]);

/** Tra ve danh sach loi; mang rong nghia la message hop le. */
export function kiemTraMessage(message) {
  if (typeof message !== 'object' || message === null || Array.isArray(message)) {
    return ['payload khong phai JSON object'];
  }

  const loi = [];
  if (!LOAI_HOP_LE.includes(message.type)) {
    loi.push(`type khong hop le: ${JSON.stringify(message.type)}`);
  }

  const after = message.after;
  if (typeof after !== 'object' || after === null || Array.isArray(after)) {
    return [...loi, 'thieu object `after`'];
  }

  for (const [tenAC, truong, hopLe] of TRUONG_BAT_BUOC) {
    if (!hopLe(after[truong])) {
      loi.push(`${tenAC} (after.${truong}) = ${JSON.stringify(after[truong])}`);
    }
  }

  if (message.type === 'end') {
    if (!laSo(after.end_time)) {
      loi.push(`message end thieu end_time: ${JSON.stringify(after.end_time)}`);
    } else if (laSo(after.start_time) && after.end_time < after.start_time) {
      loi.push(`end_time (${after.end_time}) nho hon start_time (${after.start_time})`);
    }
  }
  return loi;
}

const gio = (epochGiay) => new Date(epochGiay * 1000).toISOString();

/** Chi goi voi message da qua kiemTraMessage. */
export function tomTat(message) {
  const a = message.after;
  const snapshot = a.has_snapshot ? `/api/events/${a.id}/snapshot.jpg` : '(chua co)';
  const zones = a.current_zones.join(', ');
  const dong = [
    `  [${message.type.toUpperCase()}] ${a.camera} · ${a.label} · track ${a.id}`,
    `      score=${a.score.toFixed(2)} top_score=${a.top_score.toFixed(2)} box=[${a.box.join(', ')}]`,
    `      zones=[${zones}] start=${gio(a.start_time)} snapshot=${snapshot}`,
  ];
  if (message.type === 'end') dong.push(`      end=${gio(a.end_time)}`);
  return dong.join('\n');
}

/**
 * Bo nghiem thu: nhan tung dong stdout cua mosquitto_sub, tra ve hanh dong.
 *   { loai: 'bo_qua' }                     - khong lien quan (label/camera khac, update)
 *   { loai: 'loi', thongDiep }             - message sai dinh dang -> THAT BAI ngay
 *   { loai: 'in', thongDiep }              - new/end hop le, in tom tat
 *   { loai: 'thanh_cong', thongDiep, trackId }
 *
 * Message sai dinh dang lam that bai NGAY: truoc day loi chi duoc dem, script tiep tuc
 * cho toi het timeout roi bao "chua thay end" — sai nguyen nhan, mat thoi gian.
 */
export function taoBoNghiemThu({ label, camera }) {
  const trackDaMo = new Set();
  const thongKe = { soMessage: 0, soLoi: 0 };

  function xuLyDong(dong) {
    if (dong.trim() === '') return { loai: 'bo_qua' };

    let message;
    try {
      message = JSON.parse(dong);
    } catch {
      thongKe.soLoi += 1;
      return { loai: 'loi', thongDiep: `payload khong phai JSON: ${dong.slice(0, 120)}` };
    }

    const after = message?.after;
    // Message khong co `after` hop le thi khong loc duoc theo label/camera:
    // day la loi dinh dang, KHONG duoc am tham bo qua.
    const coAfter = typeof after === 'object' && after !== null && !Array.isArray(after);
    if (coAfter) {
      if (after.label !== label) return { loai: 'bo_qua' };
      if (camera && after.camera !== camera) return { loai: 'bo_qua' };
    }
    thongKe.soMessage += 1;

    const loi = kiemTraMessage(message);
    if (loi.length > 0) {
      thongKe.soLoi += 1;
      return {
        loai: 'loi',
        thongDiep: `message ${message?.type} thieu/sai truong:\n    - ${loi.join('\n    - ')}`,
      };
    }

    if (message.type === 'update') return { loai: 'bo_qua' };

    if (message.type === 'new') {
      trackDaMo.add(after.id);
      return { loai: 'in', thongDiep: tomTat(message) };
    }

    // type === 'end'. Track bat dau truoc khi script nghe thi khong du vong doi.
    if (!trackDaMo.has(after.id)) return { loai: 'in', thongDiep: tomTat(message) };
    return {
      loai: 'thanh_cong',
      trackId: after.id,
      thongDiep: `${tomTat(message)}\n\n  THANH CONG: track ${after.id} di du vong doi new -> end, moi message dung dinh dang.`,
    };
  }

  function goiYHetGio(timeoutGiay) {
    const goiY =
      trackDaMo.size > 0
        ? 'Da co `new` nhung chua thay `end` — de nguoi roi khoi khung hinh hoac tang --timeout.'
        : 'Khong co su kien nao. Kiem tra luong RTSP dang phat va Frigate UI http://localhost:5000.';
    return `THAT BAI: het ${timeoutGiay} s. ${goiY}`;
  }

  return { xuLyDong, goiYHetGio, thongKe };
}
