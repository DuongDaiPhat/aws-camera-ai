import { ConflictException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { IStorageService, PresignedUrlResult } from '../storage/storage.interface';
import type { NotificationConfig } from './notification-cloud.config';
import type { ClaimJobRow, Delivery } from './notification-cloud.types';

async function withSigningDeadline<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Evidence signing deadline')), 500);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export interface NotificationEmailOptions {
  storage?: Pick<IStorageService, 'getPresignedUrl'>;
  storageProvider: string;
  storageBucket: string;
  webOrigin?: string;
}

export interface EmailIncident {
  id: string;
  event_type: string;
  priority: string;
  detected_at: Date;
  camera_name: string;
  timezone: string;
  zone_name: string | null;
  confidence: string | number | null;
  object_key?: string | null;
  image_expires_at?: Date | null;
}

const eventLabels: Record<string, string> = {
  FIRE_SMOKE_DETECTED: 'Phát hiện lửa/khói',
  FALL_DETECTED: 'Phát hiện té/ngã',
  RESTRICTED_ZONE: 'Xâm nhập vùng cấm',
  UNKNOWN_PERSON: 'Phát hiện người lạ',
  PERSON_DETECTED: 'Phát hiện người',
  WELLNESS_TIMEOUT: 'Kiểm tra an toàn quá hạn',
};
const priorities: Record<string, string> = {
  P0: 'Khẩn cấp',
  P1: 'Nguy cơ cao',
  P2: 'Cần chú ý',
  P3: 'Ghi nhận',
};

function plain(value: string): string {
  return value
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

function displayTime(date: Date, timezone: string): string {
  if (!Number.isFinite(date.getTime())) return 'Chưa xác định';
  let zone = timezone;
  try {
    new Intl.DateTimeFormat('vi-VN', { timeZone: zone });
  } catch {
    zone = 'UTC';
  }
  return `${new Intl.DateTimeFormat('vi-VN', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(date)} (${zone})`;
}

function safeUrl(value: string, environment: string | undefined): URL | null {
  try {
    const url = new URL(value);
    if (
      url.username ||
      url.password ||
      (url.protocol !== 'https:' && !(environment === 'dev' && url.protocol === 'http:'))
    )
      return null;
    return url;
  } catch {
    return null;
  }
}

export function formatIncidentEmail(
  incident: EmailIncident,
  environment: string | undefined,
  image?: PresignedUrlResult,
  webOrigin?: string,
): { subject: string; message: string } {
  const prefix = `[ArgusAI][${environment?.toUpperCase() ?? 'DEV'}]`;
  const label = eventLabels[incident.event_type] ?? 'Sự kiện cần kiểm tra';
  const camera = plain(incident.camera_name) || 'Chưa xác định';
  const confidence = incident.confidence === null ? NaN : Number(incident.confidence);
  const confidenceText =
    Number.isFinite(confidence) && confidence >= 0 && confidence <= 1
      ? new Intl.NumberFormat('vi-VN', { style: 'percent', maximumFractionDigits: 1 }).format(
          confidence,
        )
      : 'Chưa xác định';
  const lines = [
    `${prefix} CẢNH BÁO: ${label}`,
    '',
    `Mức độ: ${priorities[incident.priority] ?? 'Chưa xác định'} (${plain(incident.priority)})`,
    `Thời gian phát hiện: ${displayTime(incident.detected_at, incident.timezone)}`,
    `Camera: ${camera}`,
    `Khu vực: ${plain(incident.zone_name ?? '') || 'Không gán khu vực'}`,
    `Độ tin cậy nhận diện: ${confidenceText}`,
    `Mã sự kiện: ${incident.id}`,
    '',
  ];
  const imageUrl = image && safeUrl(image.url, environment);
  if (imageUrl && image.expiresAt.getTime() > Date.now()) {
    lines.push(
      'Ảnh bằng chứng của sự kiện:',
      imageUrl.href,
      `Liên kết ảnh hết hạn: ${displayTime(image.expiresAt, incident.timezone)}`,
      'Sau khi liên kết hết hạn, mở sự kiện trên ArgusAI để xem lại ảnh.',
    );
  } else {
    lines.push(
      'Ảnh bằng chứng: chưa sẵn sàng tại thời điểm gửi. Mở ArgusAI để kiểm tra ảnh cập nhật.',
    );
  }
  const app = webOrigin && safeUrl(webOrigin, environment);
  if (app) {
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(app.hostname);
    lines.push('', local ? 'Ứng dụng Dev (mở trên máy chạy dự án):' : 'Mở ArgusAI:', app.origin);
  }
  lines.push('', 'Vui lòng kiểm tra tình huống và xác nhận trên ArgusAI.');
  const subject = Array.from(`${prefix} ${label} — ${camera}`).slice(0, 99).join('');
  return { subject, message: lines.join('\n') };
}

export async function enrichEmailDelivery(
  client: PoolClient,
  job: ClaimJobRow,
  config: NotificationConfig,
  delivery: Delivery,
  options?: NotificationEmailOptions,
): Promise<Delivery> {
  const {
    rows: [incident],
  } = await client.query<EmailIncident>(
    `SELECT e.id,e.event_type,e.priority,e.detected_at,e.zone_name,
       e.confidence,
       c.name AS camera_name,c.timezone,image.object_key,image.expires_at AS image_expires_at
     FROM events e JOIN cameras c ON c.id=e.camera_id JOIN devices d ON d.id=c.device_id
     LEFT JOIN LATERAL (
       SELECT m.object_key,m.expires_at FROM event_media m
       WHERE m.event_id=e.id AND m.storage_provider=$4 AND m.bucket=$5
         AND m.media_type IN ('SNAPSHOT','THUMBNAIL')
         AND m.content_type IN ('image/jpeg','image/png','image/webp')
         AND (m.expires_at IS NULL OR m.expires_at>clock_timestamp())
       ORDER BY CASE WHEN m.media_type='SNAPSHOT' THEN 0 ELSE 1 END,m.created_at DESC,m.id
       LIMIT 1
     ) image ON true
     WHERE e.id=$1 AND c.id=$2 AND d.owner_user_id=$3`,
    [
      job.event_id,
      job.camera_id,
      job.owner_user_id,
      options?.storageProvider ?? null,
      options?.storageBucket ?? null,
    ],
  );
  if (!incident) throw new ConflictException('Email event context changed');
  let image: PresignedUrlResult | undefined;
  if (incident.object_key && options?.storage) {
    const ttl = incident.image_expires_at
      ? Math.min(900, Math.floor((incident.image_expires_at.getTime() - Date.now()) / 1000))
      : 900;
    if (ttl > 0) {
      try {
        const signed = await withSigningDeadline(
          options.storage.getPresignedUrl(incident.object_key, ttl),
        );
        image = {
          ...signed,
          expiresAt: new Date(
            Math.min(signed.expiresAt.getTime(), incident.image_expires_at?.getTime() ?? Infinity),
          ),
        };
      } catch {
        /* Evidence unavailability must not hide the incident or expose a signing error. */
      }
    }
  }
  return {
    ...delivery,
    ...formatIncidentEmail(incident, config.environment, image, options?.webOrigin),
  };
}
