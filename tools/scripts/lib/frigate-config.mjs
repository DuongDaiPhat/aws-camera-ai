/**
 * Logic cua `pnpm frigate:init` — tach rieng de unit test voi thu muc tam.
 */

import { copyFileSync, existsSync, readdirSync, rmdirSync, statSync } from 'node:fs';

/** Loi co huong dan xu ly cho nguoi dung, khong phai bug cua script. */
export class LoiKhoiTaoConfig extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'LoiKhoiTaoConfig';
  }
}

/**
 * Tao file config may tu file mau.
 * @param {{ duongDanMau: string, duongDanMay: string, ghiDe?: boolean }} tuyChon
 * @returns {{ daGoThuMucRong: boolean, ketQua: 'da_tao' | 'da_ghi_de' | 'giu_nguyen' }}
 */
export function khoiTaoConfig({ duongDanMau, duongDanMay, ghiDe = false }) {
  if (!existsSync(duongDanMau) || !statSync(duongDanMau).isFile()) {
    throw new LoiKhoiTaoConfig(`Khong tim thay file mau ${duongDanMau} — repo thieu file?`);
  }

  let daGoThuMucRong = false;
  if (existsSync(duongDanMay) && statSync(duongDanMay).isDirectory()) {
    if (readdirSync(duongDanMay).length > 0) {
      throw new LoiKhoiTaoConfig(
        `${duongDanMay} dang la THU MUC va khong rong — khong dam tu xoa. ` +
          'Kiem tra noi dung, xoa thu cong roi chay lai.',
      );
    }
    try {
      rmdirSync(duongDanMay);
    } catch (error) {
      // Windows: container Frigate dang mount thu muc nay -> EBUSY/EPERM
      throw new LoiKhoiTaoConfig(
        `Khong go duoc thu muc rong ${duongDanMay} (${error.code}). ` +
          'Dung Frigate truoc: docker compose --profile cv stop frigate',
        { cause: error },
      );
    }
    daGoThuMucRong = true;
  }

  const daTonTai = existsSync(duongDanMay);
  if (daTonTai && !ghiDe) return { daGoThuMucRong, ketQua: 'giu_nguyen' };

  copyFileSync(duongDanMau, duongDanMay);
  return { daGoThuMucRong, ketQua: daTonTai ? 'da_ghi_de' : 'da_tao' };
}

const DAU_HIEU_KHONG_HOP_LE = 'Your config file is not valid!';
const DAU_HIEU_HOP_LE = 'Your config file is valid.';
const DAU_HIEU_SAFE_MODE_LOI = 'Unable to start Frigate in safe mode';

/**
 * Doc output cua `python3 -m frigate --validate-config`.
 *
 * KHONG tin exit code: Frigate 0.18 gap config sai se in loi, chuyen sang safe mode,
 * roi VAN in "Your config file is valid." va thoat 0 (frigate/__main__.py).
 * @returns {{ hopLe: boolean, loi: { dong: string, khoa: string, giaTri: string, thongDiep: string }[] }}
 */
export function phanTichKetQuaValidate(output) {
  const loi = [];
  let hienTai = null;
  const TEN_TRUONG = { Key: 'khoa', Value: 'giaTri', Message: 'thongDiep' };

  for (const dong of output.split(/\r?\n/)) {
    const khop = dong.match(/^(Line #|Key|Value|Message)\s*:\s?(.*)$/);
    if (!khop) continue;
    const [, nhan, giaTri] = khop;
    if (nhan === 'Line #') {
      hienTai = { dong: giaTri.trim(), khoa: '', giaTri: '', thongDiep: '' };
      loi.push(hienTai);
    } else if (hienTai) {
      hienTai[TEN_TRUONG[nhan]] = giaTri.trim();
    }
  }

  const hopLe =
    output.includes(DAU_HIEU_HOP_LE) &&
    !output.includes(DAU_HIEU_KHONG_HOP_LE) &&
    !output.includes(DAU_HIEU_SAFE_MODE_LOI) &&
    loi.length === 0;

  return { hopLe, loi };
}
