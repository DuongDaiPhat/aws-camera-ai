/**
 * Logic của `pnpm frigate:init` và `pnpm frigate:validate` — tách riêng để unit test.
 */

import { copyFileSync, existsSync, readdirSync, rmdirSync, statSync } from 'node:fs';

/** Lỗi có hướng dẫn xử lý cho người dùng, không phải bug của script. */
export class ConfigInitError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'ConfigInitError';
  }
}

const isFile = (path) => existsSync(path) && statSync(path).isFile();

/**
 * Tạo file config của máy từ file mẫu.
 * @param {{ templatePath: string, targetPath: string, shouldOverwrite?: boolean }} params
 * @returns {{ hasRemovedEmptyDirectory: boolean, result: 'created' | 'overwritten' | 'unchanged' }}
 */
export function initConfig({ templatePath, targetPath, shouldOverwrite = false }) {
  if (!isFile(templatePath)) {
    throw new ConfigInitError(`Không tìm thấy file mẫu ${templatePath} — repo thiếu file?`);
  }

  let hasRemovedEmptyDirectory = false;
  // Docker tự tạo THƯ MỤC khi bind mount một file chưa tồn tại
  if (existsSync(targetPath) && statSync(targetPath).isDirectory()) {
    if (readdirSync(targetPath).length > 0) {
      throw new ConfigInitError(
        `${targetPath} đang là THƯ MỤC và không rỗng — không dám tự xóa. ` +
          'Kiểm tra nội dung, xóa thủ công rồi chạy lại.',
      );
    }
    try {
      rmdirSync(targetPath);
    } catch (error) {
      // Windows: container Frigate đang mount thư mục này → EBUSY/EPERM
      throw new ConfigInitError(
        `Không gỡ được thư mục rỗng ${targetPath} (${error.code}). ` +
          'Dừng Frigate trước: docker compose --profile cv stop frigate',
        { cause: error },
      );
    }
    hasRemovedEmptyDirectory = true;
  }

  const hasExistingFile = existsSync(targetPath);
  if (hasExistingFile && !shouldOverwrite) {
    return { hasRemovedEmptyDirectory, result: 'unchanged' };
  }

  copyFileSync(templatePath, targetPath);
  return { hasRemovedEmptyDirectory, result: hasExistingFile ? 'overwritten' : 'created' };
}

const INVALID_CONFIG_MARKER = 'Your config file is not valid!';
const VALID_CONFIG_MARKER = 'Your config file is valid.';
const SAFE_MODE_FAILED_MARKER = 'Unable to start Frigate in safe mode';
const VALIDATION_LABEL_TO_FIELD = Object.freeze({ Key: 'key', Value: 'value', Message: 'message' });

/**
 * Đọc output của `python3 -m frigate --validate-config`.
 *
 * KHÔNG tin exit code: Frigate 0.18 gặp config sai sẽ in lỗi, chuyển sang safe mode,
 * rồi VẪN in "Your config file is valid." và thoát 0 (frigate/__main__.py).
 * @returns {{ isValid: boolean, errors: { line: string, key: string, value: string, message: string }[] }}
 */
export function parseValidationOutput(output) {
  const errors = [];
  let currentError = null;

  for (const outputLine of output.split(/\r?\n/)) {
    const match = outputLine.match(/^(Line #|Key|Value|Message)\s*:\s?(.*)$/);
    if (!match) continue;

    const [, label, rawValue] = match;
    if (label === 'Line #') {
      currentError = { line: rawValue.trim(), key: '', value: '', message: '' };
      errors.push(currentError);
    } else if (currentError) {
      currentError[VALIDATION_LABEL_TO_FIELD[label]] = rawValue.trim();
    }
  }

  const isValid =
    output.includes(VALID_CONFIG_MARKER) &&
    !output.includes(INVALID_CONFIG_MARKER) &&
    !output.includes(SAFE_MODE_FAILED_MARKER) &&
    errors.length === 0;

  return { isValid, errors };
}
