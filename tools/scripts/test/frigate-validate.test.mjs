import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { phanTichKetQuaValidate } from '../lib/frigate-config.mjs';

const KHUNG = '*************************************************************';
const DONG_HOP_LE = '*** Your config file is valid.                            ***';

// Output that cua Frigate 0.18 voi config hop le
const OUTPUT_HOP_LE = [KHUNG, DONG_HOP_LE, KHUNG].join('\n');

// Output that cua Frigate 0.18 voi min_initialized: 1 va retry_interval: 0.
// Chu y cuoi output: VAN in "valid" sau khi vao safe mode, va exit code = 0.
const OUTPUT_KHONG_HOP_LE = [
  KHUNG,
  '***    Your config file is not valid!                     ***',
  KHUNG,
  '***    Config Validation Errors                           ***',
  KHUNG,
  'Line #  : 64',
  'Key     : detect -> min_initialized',
  'Value   : 1',
  'Message : Input should be greater than or equal to 2',
  '',
  'Line #  : 80',
  'Key     : ffmpeg -> retry_interval',
  'Value   : 0',
  'Message : Input should be greater than 0',
  '',
  KHUNG,
  '***    End Config Validation Errors                       ***',
  KHUNG,
  'frigate.util.config ERROR : Config file is read-only, unable to migrate config file.',
  'Starting Frigate in safe mode.',
  KHUNG,
  DONG_HOP_LE,
  KHUNG,
].join('\r\n');

describe('phanTichKetQuaValidate', () => {
  it('nhận config hợp lệ', () => {
    assert.deepEqual(phanTichKetQuaValidate(OUTPUT_HOP_LE), { hopLe: true, loi: [] });
  });

  it('không bị lừa bởi dòng "valid" Frigate in ra sau khi vào safe mode', () => {
    const { hopLe } = phanTichKetQuaValidate(OUTPUT_KHONG_HOP_LE);

    assert.equal(hopLe, false);
  });

  it('tách từng lỗi gồm dòng, khóa, giá trị, thông điệp với xuống dòng CRLF', () => {
    const { loi } = phanTichKetQuaValidate(OUTPUT_KHONG_HOP_LE);

    assert.deepEqual(loi, [
      {
        dong: '64',
        khoa: 'detect -> min_initialized',
        giaTri: '1',
        thongDiep: 'Input should be greater than or equal to 2',
      },
      {
        dong: '80',
        khoa: 'ffmpeg -> retry_interval',
        giaTri: '0',
        thongDiep: 'Input should be greater than 0',
      },
    ]);
  });

  it('coi là không hợp lệ khi Frigate không khởi động được cả safe mode', () => {
    const output = `${KHUNG}\nYour config file is not valid!\nUnable to start Frigate in safe mode.`;

    assert.equal(phanTichKetQuaValidate(output).hopLe, false);
  });

  it('coi là không hợp lệ khi output rỗng hoặc docker lỗi giữa chừng', () => {
    assert.equal(phanTichKetQuaValidate('').hopLe, false);
    assert.equal(phanTichKetQuaValidate('Unable to find image locally').hopLe, false);
  });

  it('bỏ qua dòng Key/Value lạc khi chưa gặp Line #', () => {
    assert.deepEqual(phanTichKetQuaValidate('Key : abc\nValue : 1').loi, []);
  });
});
