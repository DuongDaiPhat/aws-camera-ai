import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  docThamSo,
  kiemTraMessage,
  MAC_DINH,
  taoBoNghiemThu,
  TIMEOUT_TOI_DA_GIAY,
  tomTat,
} from '../lib/frigate-events.mjs';

/** Message `new` bat duoc that tu Frigate 0.18 tren may dev (da luoc truong khong dung). */
function taoMessageMau({ type = 'new', ...ghiDeAfter } = {}) {
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
      ...ghiDeAfter,
    },
  };
}

const dong = (message) => JSON.stringify(message);

// ---------------------------------------------------------------------------

describe('docThamSo', () => {
  it('trả giá trị mặc định khi không truyền tham số', () => {
    const { thamSo, loi } = docThamSo([]);

    assert.deepEqual(thamSo, { ...MAC_DINH });
    assert.deepEqual(loi, []);
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

    const { thamSo, loi } = docThamSo(argv);

    assert.deepEqual(loi, []);
    assert.deepEqual(thamSo, { camera: 'cam_test', timeout: 30, label: 'car', topic: 't/x' });
  });

  it('không làm hỏng MAC_DINH giữa các lần gọi', () => {
    docThamSo(['--camera', 'cam_a']);

    assert.equal(docThamSo([]).thamSo.camera, null);
    assert.ok(Object.isFrozen(MAC_DINH));
  });

  it('báo lỗi khi tham số thiếu giá trị thay vì nuốt tham số kế tiếp làm giá trị', () => {
    const { thamSo, loi } = docThamSo(['--camera', '--timeout', '5']);

    assert.deepEqual(loi, ['--camera thieu gia tri']);
    assert.equal(thamSo.camera, null);
    assert.equal(thamSo.timeout, 5);
  });

  it('báo lỗi khi tham số cuối cùng thiếu giá trị', () => {
    const { loi } = docThamSo(['--camera']);

    assert.deepEqual(loi, ['--camera thieu gia tri']);
  });

  it('báo lỗi khi gõ nhầm tên tham số thay vì lặng lẽ nghe mọi camera', () => {
    const { loi } = docThamSo(['--camra', 'cam_test']);

    assert.ok(loi.includes('tham so khong ho tro: --camra'));
  });

  it('không nhận thuộc tính kế thừa của Object như --toString, --constructor', () => {
    const { thamSo, loi } = docThamSo(['--toString', 'x', '--constructor', 'y']);

    assert.equal(loi.length, 4); // 2 ten khong ho tro + 2 gia tri le loi
    assert.equal(Object.hasOwn(thamSo, 'toString'), false);
  });

  it('báo lỗi với đối số không bắt đầu bằng --', () => {
    const { loi } = docThamSo(['cam_test']);

    assert.deepEqual(loi, ['tham so khong ho tro: cam_test']);
  });

  for (const giaTri of ['abc', '0', '-5', 'NaN', 'Infinity', '']) {
    it(`từ chối --timeout "${giaTri}"`, () => {
      const { loi } = docThamSo(['--timeout', giaTri]);

      assert.ok(loi.includes('--timeout phai la so giay > 0'), JSON.stringify(loi));
    });
  }

  it('nhận --timeout là số thập phân', () => {
    const { thamSo, loi } = docThamSo(['--timeout', '2.5']);

    assert.deepEqual(loi, []);
    assert.equal(thamSo.timeout, 2.5);
  });

  it('từ chối --timeout vượt giới hạn setTimeout (nếu không sẽ hết giờ ngay lập tức)', () => {
    const { loi } = docThamSo(['--timeout', '3000000']);

    assert.deepEqual(loi, [`--timeout toi da ${TIMEOUT_TOI_DA_GIAY} giay`]);
  });

  it('nhận --timeout đúng bằng giới hạn và giới hạn không tràn setTimeout', () => {
    const { loi } = docThamSo(['--timeout', String(TIMEOUT_TOI_DA_GIAY)]);

    assert.deepEqual(loi, []);
    assert.ok(TIMEOUT_TOI_DA_GIAY * 1000 <= 2 ** 31 - 1);
  });
});

// ---------------------------------------------------------------------------

describe('kiemTraMessage', () => {
  it('chấp nhận message new thật từ Frigate 0.18', () => {
    assert.deepEqual(kiemTraMessage(taoMessageMau()), []);
  });

  it('chấp nhận message update và end hợp lệ', () => {
    assert.deepEqual(kiemTraMessage(taoMessageMau({ type: 'update' })), []);
    assert.deepEqual(kiemTraMessage(taoMessageMau({ type: 'end' })), []);
  });

  it('chấp nhận zone có tên và snapshot chưa có', () => {
    const message = taoMessageMau({
      current_zones: ['restricted_stove'],
      entered_zones: ['restricted_stove'],
      has_snapshot: false,
    });

    assert.deepEqual(kiemTraMessage(message), []);
  });

  for (const payload of [null, 42, 'chuoi', [], true]) {
    it(`từ chối payload không phải object: ${JSON.stringify(payload)}`, () => {
      assert.deepEqual(kiemTraMessage(payload), ['payload khong phai JSON object']);
    });
  }

  it('từ chối type lạ', () => {
    const loi = kiemTraMessage(taoMessageMau({ type: 'created' }));

    assert.deepEqual(loi, ['type khong hop le: "created"']);
  });

  for (const after of [undefined, null, [], 'x']) {
    it(`từ chối after = ${JSON.stringify(after)}`, () => {
      const loi = kiemTraMessage({ type: 'new', after });

      assert.deepEqual(loi, ['thieu object `after`']);
    });
  }

  // Moi truong bat buoc theo AC: xoa di thi phai bao dung ten truong
  const truongBatBuoc = {
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
  for (const [truong, tenAC] of Object.entries(truongBatBuoc)) {
    it(`báo thiếu ${tenAC} khi payload không có after.${truong}`, () => {
      const message = taoMessageMau();
      delete message.after[truong];

      const loi = kiemTraMessage(message);

      assert.equal(loi.length, 1, JSON.stringify(loi));
      assert.ok(loi[0].startsWith(`${tenAC} (after.${truong})`), loi[0]);
    });
  }

  const giaTriSai = [
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
  for (const [truong, giaTri] of giaTriSai) {
    it(`từ chối after.${truong} = ${JSON.stringify(giaTri)}`, () => {
      const loi = kiemTraMessage(taoMessageMau({ [truong]: giaTri }));

      assert.equal(loi.length, 1, JSON.stringify(loi));
    });
  }

  it('chấp nhận biên điểm 0 và 1, box suy biến 1 điểm', () => {
    const message = taoMessageMau({ score: 0, top_score: 1, box: [5, 5, 5, 5] });

    assert.deepEqual(kiemTraMessage(message), []);
  });

  it('từ chối message end thiếu end_time', () => {
    const loi = kiemTraMessage(taoMessageMau({ type: 'end', end_time: null }));

    assert.deepEqual(loi, ['message end thieu end_time: null']);
  });

  it('từ chối message end có end_time trước start_time', () => {
    const loi = kiemTraMessage(taoMessageMau({ type: 'end', start_time: 100, end_time: 50 }));

    assert.deepEqual(loi, ['end_time (50) nho hon start_time (100)']);
  });

  it('gom mọi lỗi trong một lần kiểm tra thay vì dừng ở lỗi đầu tiên', () => {
    const loi = kiemTraMessage(taoMessageMau({ type: 'bogus', score: 9, box: null }));

    assert.equal(loi.length, 3);
  });
});

// ---------------------------------------------------------------------------

describe('tomTat', () => {
  it('in đủ camera, track, điểm, box và đường dẫn snapshot', () => {
    const vanBan = tomTat(taoMessageMau());

    assert.match(vanBan, /\[NEW\] cam_test · person · track 1789613958\.41477-np9fac/);
    assert.match(vanBan, /score=0\.89 top_score=0\.89 box=\[957, 177, 1053, 297\]/);
    assert.match(vanBan, /snapshot=\/api\/events\/1789613958\.41477-np9fac\/snapshot\.jpg/);
    assert.doesNotMatch(vanBan, /end=/);
  });

  it('ghi (chua co) khi chưa có snapshot và in end_time với message end', () => {
    const vanBan = tomTat(taoMessageMau({ type: 'end', has_snapshot: false, end_time: 0 }));

    assert.match(vanBan, /snapshot=\(chua co\)/);
    assert.match(vanBan, /end=1970-01-01T00:00:00\.000Z/);
  });
});

// ---------------------------------------------------------------------------

describe('taoBoNghiemThu', () => {
  const taoBo = (tuyChon = {}) => taoBoNghiemThu({ label: 'person', camera: null, ...tuyChon });

  it('thành công khi thấy new rồi end cùng track_id', () => {
    const bo = taoBo();

    const hanhDongNew = bo.xuLyDong(dong(taoMessageMau()));
    const hanhDongUpdate = bo.xuLyDong(dong(taoMessageMau({ type: 'update' })));
    const hanhDongEnd = bo.xuLyDong(dong(taoMessageMau({ type: 'end' })));

    assert.equal(hanhDongNew.loai, 'in');
    assert.equal(hanhDongUpdate.loai, 'bo_qua');
    assert.equal(hanhDongEnd.loai, 'thanh_cong');
    assert.equal(hanhDongEnd.trackId, '1789613958.41477-np9fac');
    assert.match(hanhDongEnd.thongDiep, /\[END\][\s\S]*THANH CONG/);
    assert.deepEqual(bo.thongKe, { soMessage: 3, soLoi: 0 });
  });

  it('không thành công khi end thuộc track bắt đầu trước lúc script nghe', () => {
    const bo = taoBo();

    const hanhDong = bo.xuLyDong(dong(taoMessageMau({ type: 'end' })));

    assert.equal(hanhDong.loai, 'in');
  });

  it('không ghép new và end của hai track khác nhau', () => {
    const bo = taoBo();
    bo.xuLyDong(dong(taoMessageMau({ id: 'track-a' })));

    const hanhDong = bo.xuLyDong(dong(taoMessageMau({ type: 'end', id: 'track-b' })));

    assert.equal(hanhDong.loai, 'in');
  });

  it('bỏ qua message khác label hoặc khác camera và không đếm vào thống kê', () => {
    const bo = taoBo({ camera: 'cam_test' });

    assert.equal(bo.xuLyDong(dong(taoMessageMau({ label: 'car' }))).loai, 'bo_qua');
    assert.equal(bo.xuLyDong(dong(taoMessageMau({ camera: 'cam_kitchen' }))).loai, 'bo_qua');
    assert.deepEqual(bo.thongKe, { soMessage: 0, soLoi: 0 });
  });

  it('bỏ qua dòng trống', () => {
    assert.equal(taoBo().xuLyDong('   ').loai, 'bo_qua');
  });

  it('báo lỗi ngay khi payload không phải JSON', () => {
    const bo = taoBo();

    const hanhDong = bo.xuLyDong('{"type": "new", ');

    assert.equal(hanhDong.loai, 'loi');
    assert.match(hanhDong.thongDiep, /payload khong phai JSON/);
    assert.equal(bo.thongKe.soLoi, 1);
  });

  it('báo lỗi message thiếu after thay vì lặng lẽ bỏ qua vì không lọc được label', () => {
    const bo = taoBo({ camera: 'cam_test' });

    const hanhDong = bo.xuLyDong('{"type":"new"}');

    assert.equal(hanhDong.loai, 'loi');
    assert.match(hanhDong.thongDiep, /thieu object `after`/);
  });

  it('báo lỗi ngay với message sai dù trước đó có track hợp lệ đang mở', () => {
    const bo = taoBo();
    bo.xuLyDong(dong(taoMessageMau()));

    const hanhDong = bo.xuLyDong(dong(taoMessageMau({ type: 'end', score: 7.5 })));

    assert.equal(hanhDong.loai, 'loi');
    assert.match(hanhDong.thongDiep, /score \(after\.score\) = 7\.5/);
  });

  it('gợi ý đúng nguyên nhân khi hết giờ', () => {
    const boRong = taoBo();
    const boCoNew = taoBo();
    boCoNew.xuLyDong(dong(taoMessageMau()));

    assert.match(boRong.goiYHetGio(10), /het 10 s\. Khong co su kien nao/);
    assert.match(boCoNew.goiYHetGio(10), /chua thay `end`/);
  });
});
