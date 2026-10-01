import type { EventType } from '../../contracts/vertical-slice.ports';

export interface TelegramAlertEvent {
  eventType: EventType;
  cameraName: string | null;
  zoneName: string | null;
  detectedAt: Date;
  timezone: string;
}

const EVENT_NAMES: Record<EventType, string> = {
  PERSON_DETECTED: 'Phát hiện người',
  UNKNOWN_PERSON: 'Người không quen',
  RESTRICTED_ZONE: 'Vào khu vực hạn chế',
  FALL_DETECTED: 'Phát hiện té ngã',
  FIRE_SMOKE_DETECTED: 'Phát hiện khói hoặc lửa',
  WELLNESS_TIMEOUT: 'Không thấy hoạt động thường lệ',
};

const MAX_PHOTO_CAPTION_LENGTH = 1024;
const MAX_NAME_LENGTH = 180;

function displayName(value: string | null): string {
  return value?.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH) || 'Không xác định';
}

export function buildTelegramAlert(event: TelegramAlertEvent, withoutPhoto: boolean): string {
  const detectedAt = new Intl.DateTimeFormat('vi-VN', {
    timeZone: event.timezone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hourCycle: 'h23',
  }).format(event.detectedAt);

  // Telegram receives plain text: camera/zone names never become Markdown or HTML.
  const lines = [
    `Cảnh báo: ${EVENT_NAMES[event.eventType]}`,
    `Camera: ${displayName(event.cameraName)}`,
    `Khu vực: ${displayName(event.zoneName)}`,
    `Thời gian: ${detectedAt} (${event.timezone})`,
  ];
  if (withoutPhoto) lines.push('Chưa lấy được ảnh');
  return lines.join('\n').slice(0, MAX_PHOTO_CAPTION_LENGTH);
}

export function buildTelegramButtons(notificationId: string): {
  inline_keyboard: { text: string; callback_data: string }[][];
} {
  const opaqueId = notificationId.replace(/-/g, '');
  const ok = `cf:${opaqueId}:ok`;
  const help = `cf:${opaqueId}:help`;
  if (Buffer.byteLength(help, 'utf8') > 64) throw new Error('Telegram callback_data quá dài.');
  return {
    inline_keyboard: [
      [
        { text: 'Tôi ổn', callback_data: ok },
        { text: 'Cần giúp đỡ', callback_data: help },
      ],
    ],
  };
}
