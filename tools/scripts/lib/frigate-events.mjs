/**
 * Logic thuần (không I/O) của `pnpm frigate:check` — tách riêng để unit test.
 * Nghiệm thu US-01 + US-02: payload `frigate/events` đủ trường AC, vòng đời new → end.
 */

export const DEFAULT_OPTIONS = Object.freeze({
  topic: 'frigate/events',
  timeoutSeconds: 180,
  camera: null,
  label: 'person',
});

/** Tên cờ dòng lệnh → khóa trong options. Cờ giữ nguyên `--timeout` cho ngắn gọn. */
const CLI_FLAG_TO_OPTION = Object.freeze({
  topic: 'topic',
  timeout: 'timeoutSeconds',
  camera: 'camera',
  label: 'label',
});

/**
 * setTimeout của Node chỉ nhận tối đa 2^31-1 ms (~24,8 ngày); lớn hơn thì Node
 * cảnh báo và cho chạy NGAY sau 1 ms → script báo thất bại tức thì.
 */
export const MAX_TIMEOUT_SECONDS = Math.floor(2 ** 31 / 1000) - 1;

/**
 * Đọc tham số dòng lệnh. Không gọi process.exit — trả `errors` để nơi gọi tự quyết.
 * @returns {{ options: typeof DEFAULT_OPTIONS, errors: string[] }}
 */
export function parseCliArgs(argv) {
  const options = { ...DEFAULT_OPTIONS };
  const errors = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    // pnpm chuyển tiếp cả dấu `--` phân cách: `pnpm frigate:check -- --camera x`
    if (arg === '--') continue;

    const flag = arg.startsWith('--') ? arg.slice(2) : null;
    // Object.hasOwn: tránh `--toString`, `--constructor` lọt qua toán tử `in`
    if (flag === null || !Object.hasOwn(CLI_FLAG_TO_OPTION, flag)) {
      errors.push(`Tham số không hỗ trợ: ${arg}`);
      continue;
    }

    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      errors.push(`--${flag} thiếu giá trị`);
      continue;
    }
    const optionKey = CLI_FLAG_TO_OPTION[flag];
    options[optionKey] = optionKey === 'timeoutSeconds' ? Number(value) : value;
    index += 1;
  }

  if (!Number.isFinite(options.timeoutSeconds) || options.timeoutSeconds <= 0) {
    errors.push('--timeout phải là số giây > 0');
  } else if (options.timeoutSeconds > MAX_TIMEOUT_SECONDS) {
    errors.push(`--timeout tối đa ${MAX_TIMEOUT_SECONDS} giây`);
  }

  return { options, errors };
}

const isNonEmptyString = (value) => typeof value === 'string' && value.length > 0;
const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const isStringArray = (value) =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');
const isScore = (value) => isFiniteNumber(value) && value >= 0 && value <= 1;
// Frigate trả box dạng [x1, y1, x2, y2] pixel theo khung detect nên không thể âm hay ngược
const isValidBox = (value) =>
  Array.isArray(value) &&
  value.length === 4 &&
  value.every((coordinate) => isFiniteNumber(coordinate) && coordinate >= 0) &&
  value[0] <= value[2] &&
  value[1] <= value[3];

export const VALID_EVENT_TYPES = Object.freeze(['new', 'update', 'end']);

/**
 * Trường bắt buộc theo AC của US-01/US-02; `acName` là tên gọi trong AC.
 * `after.id` chính là track ID (docs/architecture/DATA_FLOW.md).
 */
export const REQUIRED_FIELDS = Object.freeze([
  { acName: 'camera_id', field: 'camera', isValid: isNonEmptyString },
  { acName: 'label', field: 'label', isValid: isNonEmptyString },
  { acName: 'track_id', field: 'id', isValid: isNonEmptyString },
  { acName: 'zones[]', field: 'current_zones', isValid: isStringArray },
  { acName: 'entered_zones[]', field: 'entered_zones', isValid: isStringArray },
  { acName: 'score', field: 'score', isValid: isScore },
  { acName: 'top_score', field: 'top_score', isValid: isScore },
  { acName: 'bounding box', field: 'box', isValid: isValidBox },
  { acName: 'timestamp', field: 'frame_time', isValid: isFiniteNumber },
  { acName: 'start_time', field: 'start_time', isValid: isFiniteNumber },
  { acName: 'has_snapshot', field: 'has_snapshot', isValid: (value) => typeof value === 'boolean' },
]);

const isPlainObject = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Trả về danh sách lỗi; mảng rỗng nghĩa là message hợp lệ. */
export function validateEventMessage(message) {
  if (!isPlainObject(message)) return ['Payload không phải JSON object'];

  const errors = [];
  if (!VALID_EVENT_TYPES.includes(message.type)) {
    errors.push(`type không hợp lệ: ${JSON.stringify(message.type)}`);
  }

  const { after } = message;
  if (!isPlainObject(after)) return [...errors, 'Thiếu object `after`'];

  for (const { acName, field, isValid } of REQUIRED_FIELDS) {
    if (!isValid(after[field])) {
      errors.push(`${acName} (after.${field}) = ${JSON.stringify(after[field])}`);
    }
  }

  if (message.type === 'end') {
    if (!isFiniteNumber(after.end_time)) {
      errors.push(`Message end thiếu end_time: ${JSON.stringify(after.end_time)}`);
    } else if (isFiniteNumber(after.start_time) && after.end_time < after.start_time) {
      errors.push(`end_time (${after.end_time}) nhỏ hơn start_time (${after.start_time})`);
    }
  }
  return errors;
}

const formatEpochSeconds = (epochSeconds) => new Date(epochSeconds * 1000).toISOString();

/** Chỉ gọi với message đã qua validateEventMessage. */
export function formatEventSummary(message) {
  const { after } = message;
  const snapshotPath = after.has_snapshot ? `/api/events/${after.id}/snapshot.jpg` : '(chưa có)';
  const lines = [
    `  [${message.type.toUpperCase()}] ${after.camera} · ${after.label} · track ${after.id}`,
    `      score=${after.score.toFixed(2)} top_score=${after.top_score.toFixed(2)} box=[${after.box.join(', ')}]`,
    `      zones=[${after.current_zones.join(', ')}] start=${formatEpochSeconds(after.start_time)} snapshot=${snapshotPath}`,
  ];
  if (message.type === 'end') lines.push(`      end=${formatEpochSeconds(after.end_time)}`);
  return lines.join('\n');
}

/**
 * Bộ nghiệm thu: nhận từng dòng stdout của mosquitto_sub, trả về hành động.
 *   { kind: 'ignore' }                    - không liên quan (label/camera khác, update)
 *   { kind: 'error', message }            - message sai định dạng → THẤT BẠI ngay
 *   { kind: 'print', message }            - new/end hợp lệ, in tóm tắt
 *   { kind: 'success', message, trackId }
 *
 * Message sai định dạng làm thất bại NGAY: trước đây lỗi chỉ được đếm, script tiếp tục
 * chờ tới hết timeout rồi báo "chưa thấy end" — sai nguyên nhân, mất thời gian.
 */
export function createAcceptanceChecker({ label, camera }) {
  const openTrackIds = new Set();
  const stats = { messageCount: 0, errorCount: 0 };

  function handleLine(line) {
    if (line.trim() === '') return { kind: 'ignore' };

    let message;
    try {
      message = JSON.parse(line);
    } catch {
      stats.errorCount += 1;
      return { kind: 'error', message: `Payload không phải JSON: ${line.slice(0, 120)}` };
    }

    const after = message?.after;
    // Message không có `after` hợp lệ thì không lọc được theo label/camera:
    // đây là lỗi định dạng, KHÔNG được âm thầm bỏ qua.
    if (isPlainObject(after)) {
      if (after.label !== label) return { kind: 'ignore' };
      if (camera && after.camera !== camera) return { kind: 'ignore' };
    }
    stats.messageCount += 1;

    const errors = validateEventMessage(message);
    if (errors.length > 0) {
      stats.errorCount += 1;
      return {
        kind: 'error',
        message: `Message ${message?.type} thiếu/sai trường:\n    - ${errors.join('\n    - ')}`,
      };
    }

    if (message.type === 'update') return { kind: 'ignore' };

    if (message.type === 'new') {
      openTrackIds.add(after.id);
      return { kind: 'print', message: formatEventSummary(message) };
    }

    // type === 'end'. Track bắt đầu trước khi script nghe thì không đủ vòng đời.
    if (!openTrackIds.has(after.id)) {
      return { kind: 'print', message: formatEventSummary(message) };
    }
    return {
      kind: 'success',
      trackId: after.id,
      message: `${formatEventSummary(message)}\n\n  THÀNH CÔNG: track ${after.id} đi đủ vòng đời new → end, mọi message đúng định dạng.`,
    };
  }

  function buildTimeoutMessage(timeoutSeconds) {
    const hint =
      openTrackIds.size > 0
        ? 'Đã có `new` nhưng chưa thấy `end` — để người rời khỏi khung hình hoặc tăng --timeout.'
        : 'Không có sự kiện nào. Kiểm tra luồng RTSP đang phát và Frigate UI http://localhost:5000.';
    return `THẤT BẠI: hết ${timeoutSeconds} s. ${hint}`;
  }

  return { handleLine, buildTimeoutMessage, stats };
}
