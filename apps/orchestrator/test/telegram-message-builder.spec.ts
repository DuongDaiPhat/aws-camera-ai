import {
  buildTelegramAlert,
  buildTelegramButtons,
} from '../src/notifications/telegram/telegram-message-builder';

describe('Telegram message builder', () => {
  it('hiển thị khu vực chưa xác định và giữ tên chứa markup dưới dạng văn bản thường', () => {
    const message = buildTelegramAlert(
      {
        eventType: 'UNKNOWN_PERSON',
        cameraName: '<Cửa chính>',
        zoneName: null,
        detectedAt: new Date('2026-09-23T07:32:10.000Z'),
        timezone: 'Asia/Ho_Chi_Minh',
      },
      false,
    );

    expect(message).toContain('Cảnh báo: Người không quen');
    expect(message).toContain('Camera: <Cửa chính>');
    expect(message).toContain('Khu vực: Không xác định');
    expect(message).toContain('14:32:10');
  });

  it('tạo hai action có callback_data dưới 64 bytes', () => {
    const buttons = buildTelegramButtons('6cc3d21f-efe4-4bb4-b32d-ce067494d70a');
    expect(buttons.inline_keyboard[0].map((button) => button.text)).toEqual([
      'Tôi ổn',
      'Cần giúp đỡ',
    ]);
    for (const button of buttons.inline_keyboard[0]) {
      expect(Buffer.byteLength(button.callback_data, 'utf8')).toBeLessThanOrEqual(64);
    }
  });
});
