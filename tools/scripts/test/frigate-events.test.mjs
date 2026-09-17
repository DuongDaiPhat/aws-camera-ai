import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createAcceptanceChecker,
  DEFAULT_OPTIONS,
  formatEventSummary,
  MAX_TIMEOUT_SECONDS,
  parseCliArgs,
  validateEventMessage,
} from '../lib/frigate-events.mjs';

/** Message `new` bắt được thật từ Frigate 0.18 trên máy dev (đã lược trường không dùng). */
function buildSampleMessage({ type = 'new', ...afterOverrides } = {}) {
  return {
    type,
    before: { id: '1789613958.41477-np9fac', false_positive: true },
    after: {
      id: '1789613958.41477-np9fac',
      camera: 'cam_test',
      frame_time: 1789613958.620257,
      label: 'person',
      sub_label: null,
      top_score: 0.8903836607933044,
      score: 0.8903836607933044,
      false_positive: false,
      box: [957, 177, 1053, 297],
      area: 11520,
      current_zones: [],
      entered_zones: [],
      has_snapshot: true,
      has_clip: true,
      start_time: 1789613958.41477,
      end_time: type === 'end' ? 1789613980.5 : null,
      ...afterOverrides,
    },
  };
}

const toLine = (message) => JSON.stringify(message);

// ---------------------------------------------------------------------------

describe('parseCliArgs', () => {
  it('trả giá trị mặc định khi không truyền tham số', () => {
    const { options, errors } = parseCliArgs([]);

    assert.deepEqual(options, { ...DEFAULT_OPTIONS });
    assert.deepEqual(errors, []);
  });

  it('đọc đủ 4 tham số và bỏ qua dấu -- do pnpm chuyển tiếp', () => {
    const argv = [
      '--',
      '--camera',
      'cam_test',
      '--timeout',
      '30',
      '--label',
      'car',
      '--topic',
      't/x',
    ];

    const { options, errors } = parseCliArgs(argv);

    assert.deepEqual(errors, []);
    assert.deepEqual(options, {
      camera: 'cam_test',
      timeoutSeconds: 30,
      label: 'car',
      topic: 't/x',
    });
  });

  it('không làm hỏng DEFAULT_OPTIONS giữa các lần gọi', () => {
    parseCliArgs(['--camera', 'cam_a']);

    assert.equal(parseCliArgs([]).options.camera, null);
    assert.ok(Object.isFrozen(DEFAULT_OPTIONS));
  });

  it('báo lỗi khi tham số thiếu giá trị thay vì nuốt tham số kế tiếp làm giá trị', () => {
    const { options, errors } = parseCliArgs(['--camera', '--timeout', '5']);

    assert.deepEqual(errors, ['--camera thiếu giá trị']);
    assert.equal(options.camera, null);
    assert.equal(options.timeoutSeconds, 5);
  });

  it('báo lỗi khi tham số cuối cùng thiếu giá trị', () => {
    const { errors } = parseCliArgs(['--camera']);

    assert.deepEqual(errors, ['--camera thiếu giá trị']);
  });

  it('báo lỗi khi gõ nhầm tên tham số thay vì lặng lẽ nghe mọi camera', () => {
    const { errors } = parseCliArgs(['--camra', 'cam_test']);

    assert.ok(errors.includes('Tham số không hỗ trợ: --camra'));
  });

  it('không nhận tên khóa nội bộ như --timeoutSeconds', () => {
    const { errors } = parseCliArgs(['--timeoutSeconds', '5']);

    assert.ok(errors.includes('Tham số không hỗ trợ: --timeoutSeconds'));
  });

  it('không nhận thuộc tính kế thừa của Object như --toString, --constructor', () => {
    const { options, errors } = parseCliArgs(['--toString', 'x', '--constructor', 'y']);

    assert.equal(errors.length, 4); // 2 tên không hỗ trợ + 2 giá trị lẻ loi
    assert.equal(Object.hasOwn(options, 'toString'), false);
  });

  it('báo lỗi với đối số không bắt đầu bằng --', () => {
    const { errors } = parseCliArgs(['cam_test']);

    assert.deepEqual(errors, ['Tham số không hỗ trợ: cam_test']);
  });

  for (const value of ['abc', '0', '-5', 'NaN', 'Infinity', '']) {
    it(`từ chối --timeout "${value}"`, () => {
      const { errors } = parseCliArgs(['--timeout', value]);

      assert.ok(errors.includes('--timeout phải là số giây > 0'), JSON.stringify(errors));
    });
  }

  it('nhận --timeout là số thập phân', () => {
    const { options, errors } = parseCliArgs(['--timeout', '2.5']);

    assert.deepEqual(errors, []);
    assert.equal(options.timeoutSeconds, 2.5);
  });

  it('từ chối --timeout vượt giới hạn setTimeout (nếu không sẽ hết giờ ngay lập tức)', () => {
    const { errors } = parseCliArgs(['--timeout', '3000000']);

    assert.deepEqual(errors, [`--timeout tối đa ${MAX_TIMEOUT_SECONDS} giây`]);
  });

  it('nhận --timeout đúng bằng giới hạn và giới hạn không tràn setTimeout', () => {
    const { errors } = parseCliArgs(['--timeout', String(MAX_TIMEOUT_SECONDS)]);

    assert.deepEqual(errors, []);
    assert.ok(MAX_TIMEOUT_SECONDS * 1000 <= 2 ** 31 - 1);
  });
});

// ---------------------------------------------------------------------------

describe('validateEventMessage', () => {
  it('chấp nhận message new thật từ Frigate 0.18', () => {
    assert.deepEqual(validateEventMessage(buildSampleMessage()), []);
  });

  it('chấp nhận message update và end hợp lệ', () => {
    assert.deepEqual(validateEventMessage(buildSampleMessage({ type: 'update' })), []);
    assert.deepEqual(validateEventMessage(buildSampleMessage({ type: 'end' })), []);
  });

  it('chấp nhận zone có tên và snapshot chưa có', () => {
    const message = buildSampleMessage({
      current_zones: ['restricted_stove'],
      entered_zones: ['restricted_stove'],
      has_snapshot: false,
    });

    assert.deepEqual(validateEventMessage(message), []);
  });

  for (const payload of [null, 42, 'chuoi', [], true]) {
    it(`từ chối payload không phải object: ${JSON.stringify(payload)}`, () => {
      assert.deepEqual(validateEventMessage(payload), ['Payload không phải JSON object']);
    });
  }

  it('từ chối type lạ', () => {
    const errors = validateEventMessage(buildSampleMessage({ type: 'created' }));

    assert.deepEqual(errors, ['type không hợp lệ: "created"']);
  });

  for (const after of [undefined, null, [], 'x']) {
    it(`từ chối after = ${JSON.stringify(after)}`, () => {
      const errors = validateEventMessage({ type: 'new', after });

      assert.deepEqual(errors, ['Thiếu object `after`']);
    });
  }

  // Mỗi trường bắt buộc theo AC: xóa đi thì phải báo đúng tên trường
  const acNameByField = {
    camera: 'camera_id',
    label: 'label',
    id: 'track_id',
    current_zones: 'zones[]',
    entered_zones: 'entered_zones[]',
    score: 'score',
    top_score: 'top_score',
    box: 'bounding box',
    frame_time: 'timestamp',
    start_time: 'start_time',
    has_snapshot: 'has_snapshot',
  };
  for (const [field, acName] of Object.entries(acNameByField)) {
    it(`báo thiếu ${acName} khi payload không có after.${field}`, () => {
      const message = buildSampleMessage();
      delete message.after[field];

      const errors = validateEventMessage(message);

      assert.equal(errors.length, 1, JSON.stringify(errors));
      assert.ok(errors[0].startsWith(`${acName} (after.${field})`), errors[0]);
    });
  }

  const invalidValues = [
    ['camera', ''],
    ['id', 123],
    ['current_zones', 'bep'],
    ['entered_zones', [1, 2]],
    ['score', '0.8'],
    ['score', Number.NaN],
    ['score', 7.5],
    ['score', -0.1],
    ['top_score', 1.01],
    ['box', [1, 2, 3]],
    ['box', [1, 2, 3, '4']],
    ['box', [500, 400, 100, 50]],
    ['box', [-1, 0, 10, 10]],
    ['frame_time', '1789613958'],
    ['has_snapshot', 'true'],
  ];
  for (const [field, value] of invalidValues) {
    it(`từ chối after.${field} = ${JSON.stringify(value)}`, () => {
      const errors = validateEventMessage(buildSampleMessage({ [field]: value }));

      assert.equal(errors.length, 1, JSON.stringify(errors));
    });
  }

  it('chấp nhận biên điểm 0 và 1, box suy biến 1 điểm', () => {
    const message = buildSampleMessage({ score: 0, top_score: 1, box: [5, 5, 5, 5] });

    assert.deepEqual(validateEventMessage(message), []);
  });

  it('từ chối message end thiếu end_time', () => {
    const errors = validateEventMessage(buildSampleMessage({ type: 'end', end_time: null }));

    assert.deepEqual(errors, ['Message end thiếu end_time: null']);
  });

  it('từ chối message end có end_time trước start_time', () => {
    const errors = validateEventMessage(
      buildSampleMessage({ type: 'end', start_time: 100, end_time: 50 }),
    );

    assert.deepEqual(errors, ['end_time (50) nhỏ hơn start_time (100)']);
  });

  it('gom mọi lỗi trong một lần kiểm tra thay vì dừng ở lỗi đầu tiên', () => {
    const errors = validateEventMessage(buildSampleMessage({ type: 'bogus', score: 9, box: null }));

    assert.equal(errors.length, 3);
  });
});

// ---------------------------------------------------------------------------

describe('formatEventSummary', () => {
  it('in đủ camera, track, điểm, box và đường dẫn snapshot', () => {
    const summary = formatEventSummary(buildSampleMessage());

    assert.match(summary, /\[NEW\] cam_test · person · track 1789613958\.41477-np9fac/);
    assert.match(summary, /score=0\.89 top_score=0\.89 box=\[957, 177, 1053, 297\]/);
    assert.match(summary, /snapshot=\/api\/events\/1789613958\.41477-np9fac\/snapshot\.jpg/);
    assert.doesNotMatch(summary, /end=/);
  });

  it('ghi (chưa có) khi chưa có snapshot và in end_time với message end', () => {
    const summary = formatEventSummary(
      buildSampleMessage({ type: 'end', has_snapshot: false, end_time: 0 }),
    );

    assert.match(summary, /snapshot=\(chưa có\)/);
    assert.match(summary, /end=1970-01-01T00:00:00\.000Z/);
  });
});

// ---------------------------------------------------------------------------

describe('createAcceptanceChecker', () => {
  const createChecker = (overrides = {}) =>
    createAcceptanceChecker({ label: 'person', camera: null, ...overrides });

  it('thành công khi thấy new rồi end cùng track_id', () => {
    const checker = createChecker();

    const newAction = checker.handleLine(toLine(buildSampleMessage()));
    const updateAction = checker.handleLine(toLine(buildSampleMessage({ type: 'update' })));
    const endAction = checker.handleLine(toLine(buildSampleMessage({ type: 'end' })));

    assert.equal(newAction.kind, 'print');
    assert.equal(updateAction.kind, 'ignore');
    assert.equal(endAction.kind, 'success');
    assert.equal(endAction.trackId, '1789613958.41477-np9fac');
    assert.match(endAction.message, /\[END\][\s\S]*THÀNH CÔNG/);
    assert.deepEqual(checker.stats, { messageCount: 3, errorCount: 0 });
  });

  it('không thành công khi end thuộc track bắt đầu trước lúc script nghe', () => {
    const checker = createChecker();

    const action = checker.handleLine(toLine(buildSampleMessage({ type: 'end' })));

    assert.equal(action.kind, 'print');
  });

  it('không ghép new và end của hai track khác nhau', () => {
    const checker = createChecker();
    checker.handleLine(toLine(buildSampleMessage({ id: 'track-a' })));

    const action = checker.handleLine(toLine(buildSampleMessage({ type: 'end', id: 'track-b' })));

    assert.equal(action.kind, 'print');
  });

  it('bỏ qua message khác label hoặc khác camera và không đếm vào thống kê', () => {
    const checker = createChecker({ camera: 'cam_test' });

    assert.equal(checker.handleLine(toLine(buildSampleMessage({ label: 'car' }))).kind, 'ignore');
    assert.equal(
      checker.handleLine(toLine(buildSampleMessage({ camera: 'cam_kitchen' }))).kind,
      'ignore',
    );
    assert.deepEqual(checker.stats, { messageCount: 0, errorCount: 0 });
  });

  it('bỏ qua dòng trống', () => {
    assert.equal(createChecker().handleLine('   ').kind, 'ignore');
  });

  it('báo lỗi ngay khi payload không phải JSON', () => {
    const checker = createChecker();

    const action = checker.handleLine('{"type": "new", ');

    assert.equal(action.kind, 'error');
    assert.match(action.message, /Payload không phải JSON/);
    assert.equal(checker.stats.errorCount, 1);
  });

  it('báo lỗi message thiếu after thay vì lặng lẽ bỏ qua vì không lọc được label', () => {
    const checker = createChecker({ camera: 'cam_test' });

    const action = checker.handleLine('{"type":"new"}');

    assert.equal(action.kind, 'error');
    assert.match(action.message, /Thiếu object `after`/);
  });

  it('báo lỗi ngay với message sai dù trước đó có track hợp lệ đang mở', () => {
    const checker = createChecker();
    checker.handleLine(toLine(buildSampleMessage()));

    const action = checker.handleLine(toLine(buildSampleMessage({ type: 'end', score: 7.5 })));

    assert.equal(action.kind, 'error');
    assert.match(action.message, /score \(after\.score\) = 7\.5/);
  });

  it('gợi ý đúng nguyên nhân khi hết giờ', () => {
    const emptyChecker = createChecker();
    const checkerWithOpenTrack = createChecker();
    checkerWithOpenTrack.handleLine(toLine(buildSampleMessage()));

    assert.match(emptyChecker.buildTimeoutMessage(10), /hết 10 s\. Không có sự kiện nào/);
    assert.match(checkerWithOpenTrack.buildTimeoutMessage(10), /chưa thấy `end`/);
  });
});
