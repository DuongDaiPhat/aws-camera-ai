#!/usr/bin/env node
/**
 * Kiểm tra và ngăn chặn rò rỉ Secrets / AWS Credentials / File nhạy cảm.
 * 
 * Cách dùng:
 *   node tools/scripts/check-secrets.mjs --staged   # Dùng trong Husky pre-commit
 *   node tools/scripts/check-secrets.mjs --ci       # Dùng trong GitHub Actions CI
 *   node tools/scripts/check-secrets.mjs --all      # Quét toàn bộ repository
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, relative, basename } from 'node:path';

const isWindows = process.platform === 'win32';

// Danh sách file/path bị cấm commit
const FORBIDDEN_FILE_PATTERNS = [
  /^\.env(?!\.example(\..+)?$)/i,          // .env, .env.local, .env.production (ngoại trừ .env.example)
  /aws-credentials/i,                      // aws-credentials*
  /\.(pem|key)$/i,                         // private keys / certificates
  /^infra\/frigate\/config\.yml$/i,        // config Frigate chứa URL RTSP thật
];

// Danh sách regex phát hiện secret trong nội dung diff/code
const SECRET_PATTERNS = [
  {
    name: 'AWS Access Key ID (tĩnh hoặc tạm thời)',
    regex: /\b(AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/,
    // Bỏ qua giá trị mẫu tài liệu của AWS
    whitelist: [/AKIAIOSFODNN7EXAMPLE/i, /ASIAIOSFODNN7EXAMPLE/i],
  },
  {
    name: 'AWS Secret Access Key trong code/config',
    regex: /(?:aws_secret_access_key|AWS_SECRET_ACCESS_KEY)\s*[:=]\s*['"]?([A-Za-z0-9/+=]{40})['"]?/,
    whitelist: [/EXAMPLEKEY/i],
  },
  {
    name: 'AWS Session Token',
    regex: /(?:aws_session_token|AWS_SESSION_TOKEN)\s*[:=]\s*['"]?([A-Za-z0-9/+=]{60,})['"]?/,
    whitelist: [],
  },
  {
    name: 'Private Key header',
    regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
    whitelist: [],
  },
];

function runGit(args) {
  const result = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  if (result.error) {
    console.error('Không thể thực thi lệnh git:', result.error.message);
    process.exit(1);
  }
  return result.stdout ? result.stdout.trim() : '';
}

function isWhitelisted(line, whitelist) {
  // Cho phép bỏ qua có chủ đích bằng comment
  if (line.includes('secret-scan:ignore') || line.includes('gitleaks:allow')) {
    return true;
  }
  return whitelist.some((wl) => wl.test(line));
}

function checkFileName(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  const fileName = basename(normalized);
  
  for (const pattern of FORBIDDEN_FILE_PATTERNS) {
    if (pattern.test(fileName) || pattern.test(normalized)) {
      return `Tên file "${filePath}" nằm trong danh mục cấm commit (khớp mẫu ${pattern}).`;
    }
  }
  return null;
}

function checkContentLines(linesWithContext, fileName) {
  // Bỏ qua kiểm tra nội dung file test secret scanner chính nó
  if (fileName.includes('check-secrets')) {
    return [];
  }

  const violations = [];
  for (const { line, lineNumber } of linesWithContext) {
    for (const rule of SECRET_PATTERNS) {
      if (rule.regex.test(line)) {
        if (!isWhitelisted(line, rule.whitelist)) {
          violations.push({
            ruleName: rule.name,
            lineNumber,
            sample: line.trim().slice(0, 80),
          });
        }
      }
    }
  }
  return violations;
}

function scanDiff(diffOutput) {
  const fileErrors = [];
  const contentErrors = [];
  
  // Phân tích diff dạng unified (-U0)
  const diffBlocks = diffOutput.split(/^diff --git /m).filter(Boolean);

  for (const block of diffBlocks) {
    const lines = block.split('\n');
    const headerLine = lines[0] || '';
    const match = headerLine.match(/b\/(.+)$/);
    if (!match) continue;
    
    const filePath = match[1].trim();

    // 1. Kiểm tra tên file
    const fileViolation = checkFileName(filePath);
    if (fileViolation) {
      fileErrors.push(fileViolation);
    }

    // 2. Chỉ kiểm tra các dòng MỚI THÊM (bắt đầu bằng '+' nhưng không phải '+++')
    const addedLines = [];
    let currentLineNum = 1;

    for (const line of lines) {
      const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (hunkMatch) {
        currentLineNum = parseInt(hunkMatch[1], 10);
        continue;
      }
      if (line.startsWith('+++') || line.startsWith('---')) {
        continue;
      }
      if (line.startsWith('+')) {
        addedLines.push({
          line: line.slice(1),
          lineNumber: currentLineNum,
        });
        currentLineNum++;
      } else if (!line.startsWith('-')) {
        currentLineNum++;
      }
    }

    const contentViolations = checkContentLines(addedLines, filePath);
    for (const v of contentViolations) {
      contentErrors.push({
        filePath,
        ...v,
      });
    }
  }

  return { fileErrors, contentErrors };
}

function main() {
  const args = process.argv.slice(2);
  const isStaged = args.includes('--staged');
  const isCi = args.includes('--ci');
  const isAll = args.includes('--all');

  console.log('\n🔒 [Secret-Scan] Bắt đầu quét kiểm tra rò rỉ AWS credentials & file nhạy cảm...');

  let diff = '';

  if (isStaged) {
    diff = runGit(['diff', '--cached', '-U0', '--no-color']);
    if (!diff) {
      console.log('✅ Không có file staged nào cần kiểm tra.\n');
      process.exit(0);
    }
  } else if (isCi) {
    const baseRef = process.env.GITHUB_BASE_REF;
    if (baseRef) {
      console.log(`📌 Phát hiện môi trường GitHub PR. Quét diff từ origin/${baseRef} đến HEAD...`);
      diff = runGit(['diff', `origin/${baseRef}...HEAD`, '-U0', '--no-color']);
    } else {
      console.log('📌 Quét commit gần nhất (HEAD~1 đến HEAD)...');
      diff = runGit(['diff', 'HEAD~1...HEAD', '-U0', '--no-color']);
    }
  } else if (isAll) {
    console.log('📌 Quét toàn bộ tracked files...');
    const files = runGit(['ls-files']).split('\n').filter(Boolean);
    const fileErrors = [];
    const contentErrors = [];

    for (const f of files) {
      const fErr = checkFileName(f);
      if (fErr) fileErrors.push(fErr);

      if (existsSync(f)) {
        try {
          const content = readFileSync(f, 'utf8');
          const lines = content.split('\n').map((l, i) => ({ line: l, lineNumber: i + 1 }));
          const cViolations = checkContentLines(lines, f);
          for (const v of cViolations) {
            contentErrors.push({ filePath: f, ...v });
          }
        } catch {
          // Bỏ qua file nhị phân
        }
      }
    }

    reportResults({ fileErrors, contentErrors });
    return;
  } else {
    // Mặc định: quét unstaged + staged
    diff = runGit(['diff', 'HEAD', '-U0', '--no-color']);
  }

  const results = scanDiff(diff);
  reportResults(results);
}

function reportResults({ fileErrors, contentErrors }) {
  const hasErrors = fileErrors.length > 0 || contentErrors.length > 0;

  if (!hasErrors) {
    console.log('✅ [Secret-Scan] HOÀN TOÀN SẠCH: Không phát hiện file nhạy cảm hoặc chuỗi khóa AWS nào.\n');
    process.exit(0);
  }

  console.error('\n' + '='.repeat(70));
  console.error('❌ PHÁT HIỆN NGUY CƠ RÒ RỈ SECRET / AWS CREDENTIALS!');
  console.error('='.repeat(70) + '\n');

  if (fileErrors.length > 0) {
    console.error('📁 CÁC FILE BỊ CẤM COMMIT:');
    fileErrors.forEach((err) => console.error(`  - ${err}`));
    console.error('');
  }

  if (contentErrors.length > 0) {
    console.error('🔑 CÁC CHUỖI KHÓA / SECRET BỊ PHÁT HIỆN TRONG NỘI DUNG:');
    contentErrors.forEach((err) => {
      console.error(`  - File: ${err.filePath}:${err.lineNumber}`);
      console.error(`    Quy tắc: ${err.ruleName}`);
      console.error(`    Đoạn mã: ${err.sample}`);
    });
    console.error('');
  }

  console.error('💡 HƯỚNG DẪN XỬ LÝ:');
  console.error('  1. Tuyệt đối KHÔNG đưa credentials vào code, markdown hoặc commit history.');
  console.error('  2. Đối với AWS: dùng `aws configure --profile camerai-lab` (lưu ở ~/.aws/), KHÔNG để trong repo.');
  console.error('  3. Với biến môi trường local: lưu tại file `.env` và đảm bảo `.env` nằm trong `.gitignore`.');
  console.error('  4. Nếu là mock dữ liệu test hợp lệ: thêm comment `// secret-scan:ignore` ở cuối dòng.');
  console.error('='.repeat(70) + '\n');

  process.exit(1);
}

main();
