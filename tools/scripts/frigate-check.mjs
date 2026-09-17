#!/usr/bin/env node
/**
 * Kiểm tra nghiệm thu US-01 + US-02: Frigate phát hiện "person" và publish lên MQTT.
 *
 *   pnpm frigate:check                          # chờ tối đa 180 s
 *   pnpm frigate:check -- --camera cam_test --timeout 300
 *
 * Nghe topic `frigate/events` qua mosquitto_sub BÊN TRONG container (không cần cài
 * MQTT client trên máy), kiểm tra từng message có đủ trường mà AC yêu cầu, và chỉ
 * thành công khi thấy trọn một vòng đời track: `new` → `end` cùng track_id.
 * Logic kiểm tra nằm ở lib/frigate-events.mjs (có unit test).
 *
 * Cần: docker compose --profile cv up -d  +  một luồng RTSP có người (webcam/file).
 */

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

import { createAcceptanceChecker, parseCliArgs } from './lib/frigate-events.mjs';

// Trùng `container_name` của service mosquitto trong docker-compose.yml
const MQTT_CONTAINER_NAME = 'camerai-mosquitto';
// mosquitto_sub trong container sống lâu hơn script một chút rồi tự thoát
const MOSQUITTO_SUB_EXTRA_SECONDS = 5;
const USAGE =
  '  Cách dùng: pnpm frigate:check -- [--camera <slug>] [--timeout <giây>] [--label <nhãn>] [--topic <topic>]\n';

const { options, errors: argErrors } = parseCliArgs(process.argv.slice(2));
if (argErrors.length > 0) {
  console.error(`\n  ${argErrors.join('\n  ')}\n`);
  console.error(USAGE);
  process.exit(1);
}

const checker = createAcceptanceChecker(options);

console.log(
  `\n  Đang nghe ${options.topic} (label=${options.label}` +
    `${options.camera ? `, camera=${options.camera}` : ''}) tối đa ${options.timeoutSeconds} s ...\n`,
);

// Gọi thẳng `docker exec` thay vì `docker compose exec`: trên Windows, compose sinh thêm
// tiến trình con `docker-compose.exe` mà subscriber.kill() không diệt được → treo terminal.
// `-W` bắt mosquitto_sub trong container tự thoát, kể cả khi script bị Ctrl+C.
const subscriber = spawn(
  'docker',
  [
    'exec',
    MQTT_CONTAINER_NAME,
    'mosquitto_sub',
    '-t',
    options.topic,
    '-W',
    String(Math.ceil(options.timeoutSeconds) + MOSQUITTO_SUB_EXTRA_SECONDS),
  ],
  { stdio: ['ignore', 'pipe', 'inherit'] },
);

function finish(exitCode, summary) {
  clearTimeout(timeoutTimer);
  // Gỡ listener trước khi kill, nếu không handler 'exit' bên dưới sẽ in nhầm lỗi mosquitto_sub
  subscriber.removeAllListeners('exit');
  subscriber.kill();
  const { messageCount, errorCount } = checker.stats;
  console.log(
    `\n  ${summary}\n  Đã nhận ${messageCount} message, ${errorCount} message sai định dạng.\n`,
  );
  process.exit(exitCode);
}

const timeoutTimer = setTimeout(
  () => finish(1, checker.buildTimeoutMessage(options.timeoutSeconds)),
  options.timeoutSeconds * 1000,
);

subscriber.on('error', (error) => {
  clearTimeout(timeoutTimer);
  console.error(`  Không chạy được docker: ${error.message}`);
  process.exit(1);
});

subscriber.on('exit', (code) => {
  clearTimeout(timeoutTimer);
  console.error(
    `\n  mosquitto_sub dừng (mã ${code}). Container ${MQTT_CONTAINER_NAME} có đang chạy? docker compose ps\n`,
  );
  process.exit(1);
});

createInterface({ input: subscriber.stdout }).on('line', (line) => {
  const action = checker.handleLine(line);
  if (action.kind === 'print') console.log(action.message);
  if (action.kind === 'success') finish(0, action.message.trimStart());
  if (action.kind === 'error') finish(1, `THẤT BẠI: ${action.message}`);
});
