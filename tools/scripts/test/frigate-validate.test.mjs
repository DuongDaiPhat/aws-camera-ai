import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseValidationOutput } from '../lib/frigate-config.mjs';

const BANNER = '*************************************************************';
const VALID_LINE = '*** Your config file is valid.                            ***';

// Output thật của Frigate 0.18 với config hợp lệ
const VALID_OUTPUT = [BANNER, VALID_LINE, BANNER].join('\n');

// Output thật của Frigate 0.18 với min_initialized: 1 và retry_interval: 0.
// Chú ý cuối output: VẪN in "valid" sau khi vào safe mode, và exit code = 0.
const INVALID_OUTPUT = [
  BANNER,
  '***    Your config file is not valid!                     ***',
  BANNER,
  '***    Config Validation Errors                           ***',
  BANNER,
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
  BANNER,
  '***    End Config Validation Errors                       ***',
  BANNER,
  'frigate.util.config ERROR : Config file is read-only, unable to migrate config file.',
  'Starting Frigate in safe mode.',
  BANNER,
  VALID_LINE,
  BANNER,
].join('\r\n');

describe('parseValidationOutput', () => {
  it('nhận config hợp lệ', () => {
    assert.deepEqual(parseValidationOutput(VALID_OUTPUT), { isValid: true, errors: [] });
  });

  it('không bị lừa bởi dòng "valid" Frigate in ra sau khi vào safe mode', () => {
    const { isValid } = parseValidationOutput(INVALID_OUTPUT);

    assert.equal(isValid, false);
  });

  it('tách từng lỗi gồm dòng, khóa, giá trị, thông điệp với xuống dòng CRLF', () => {
    const { errors } = parseValidationOutput(INVALID_OUTPUT);

    assert.deepEqual(errors, [
      {
        line: '64',
        key: 'detect -> min_initialized',
        value: '1',
        message: 'Input should be greater than or equal to 2',
      },
      {
        line: '80',
        key: 'ffmpeg -> retry_interval',
        value: '0',
        message: 'Input should be greater than 0',
      },
    ]);
  });

  it('coi là không hợp lệ khi báo "not valid" mà không tách được dòng lỗi nào', () => {
    // Ví dụ lỗi cú pháp YAML: không có khối Line #/Key/Value nhưng vẫn vào safe mode
    const output = [
      BANNER,
      '***    Your config file is not valid!                     ***',
      'Starting Frigate in safe mode.',
      VALID_LINE,
    ].join('\n');

    assert.deepEqual(parseValidationOutput(output), { isValid: false, errors: [] });
  });

  it('coi là không hợp lệ khi Frigate không khởi động được cả safe mode', () => {
    const output = `${BANNER}\nYour config file is not valid!\nUnable to start Frigate in safe mode.`;

    assert.equal(parseValidationOutput(output).isValid, false);
  });

  it('coi là không hợp lệ khi output rỗng hoặc docker lỗi giữa chừng', () => {
    assert.equal(parseValidationOutput('').isValid, false);
    assert.equal(parseValidationOutput('Unable to find image locally').isValid, false);
  });

  it('bỏ qua dòng Key/Value lạc khi chưa gặp Line #', () => {
    assert.deepEqual(parseValidationOutput('Key : abc\nValue : 1').errors, []);
  });
});
