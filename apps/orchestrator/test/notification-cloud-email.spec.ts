import type { PoolClient } from 'pg';
import { ConfigService } from '@nestjs/config';
import { readNotificationConfig } from '../src/notification-cloud/notification-cloud.config';
import {
  enrichEmailDelivery,
  formatIncidentEmail,
  type EmailIncident,
} from '../src/notification-cloud/notification-email';
import type { ClaimJobRow, Delivery } from '../src/notification-cloud/notification-cloud.types';

const incident: EmailIncident = {
  id: 'event-id',
  event_type: 'RESTRICTED_ZONE',
  priority: 'P1',
  detected_at: new Date('2026-11-22T09:38:00Z'),
  camera_name: 'Phòng khách',
  timezone: 'Asia/Ho_Chi_Minh',
  zone_name: 'Nguy hiểm',
  confidence: '0.93',
};
const config = readNotificationConfig(new ConfigService({ APP_ENV: 'dev' }));
const delivery = {
  channel: 'SNS_EMAIL',
  recipientRef: 'user:owner',
  topicArn: 'private-topic',
} as Delivery;
const job = { event_id: 'event-id', camera_id: 'camera-id', owner_user_id: 'owner' } as ClaimJobRow;

describe('incident email content', () => {
  it.each([
    ['FIRE_SMOKE_DETECTED', 'Phát hiện lửa/khói'],
    ['FALL_DETECTED', 'Phát hiện té/ngã'],
    ['RESTRICTED_ZONE', 'Xâm nhập vùng cấm'],
    ['UNKNOWN_PERSON', 'Phát hiện người lạ'],
    ['PERSON_DETECTED', 'Phát hiện người'],
    ['WELLNESS_TIMEOUT', 'Kiểm tra an toàn quá hạn'],
    ['OTHER', 'Sự kiện cần kiểm tra'],
  ])('describes the actual %s event', (event_type, label) => {
    const email = formatIncidentEmail({ ...incident, event_type }, 'staging');
    expect(email.subject).toBe(`[ArgusAI][STAGING] ${label} — Phòng khách`);
    expect(email.message).toContain(`CẢNH BÁO: ${label}`);
    expect(email.message).toContain('16:38:00 22/11/2026');
    expect(email.message).toContain('Asia/Ho_Chi_Minh');
    expect(email.message).toContain('Nguy hiểm');
    expect(email.message).toContain('93%');
    expect(email.message).toContain('event-id');
  });

  it('keeps Unicode subjects under the sender limit and removes controls', () => {
    const email = formatIncidentEmail(
      { ...incident, camera_name: '\r\n😀'.repeat(120), zone_name: '\nSàn\t\u0000 nhà' },
      'dev',
    );
    expect(Array.from(email.subject)).toHaveLength(99);
    expect(email.subject).not.toMatch(/[\r\n]/);
    expect(email.subject).not.toContain(String.fromCharCode(0));
    expect(email.message).toContain('Khu vực: Sàn nhà');
    expect(email.subject).not.toMatch(/[\uD800-\uDBFF]$/);
  });

  it.each(['P0', 'P1', 'P2', 'P3', 'UNKNOWN'])(
    'renders priority %s and handles absent metadata',
    (priority) => {
      const email = formatIncidentEmail(
        {
          ...incident,
          priority,
          camera_name: ' ',
          zone_name: null,
          confidence: null,
          detected_at: new Date(NaN),
        },
        undefined,
      );
      expect(email.subject).toContain('[DEV]');
      expect(email.message).toContain('Thời gian phát hiện: Chưa xác định');
      expect(email.message).toContain('Camera: Chưa xác định');
      expect(email.message).toContain('Khu vực: Không gán khu vực');
      expect(email.message).toContain('Độ tin cậy nhận diện: Chưa xác định');
      expect(email.message).toContain(`(${priority})`);
    },
  );

  it.each([-1, 2, 'not-a-number'])('does not misrepresent invalid confidence %s', (confidence) => {
    expect(
      formatIncidentEmail({ ...incident, confidence, timezone: 'invalid' }, 'production').message,
    ).toContain('(UTC)');
    expect(formatIncidentEmail({ ...incident, confidence }, 'dev').message).toContain(
      'Độ tin cậy nhận diện: Chưa xác định',
    );
  });

  it('includes a valid image link, expiry and app origin without unrelated path/query', () => {
    const expiresAt = new Date(Date.now() + 900000);
    const email = formatIncidentEmail(
      incident,
      'production',
      { url: 'https://evidence.example.test/event.jpg?signed=example', expiresAt },
      'https://app.example.test/private?ignored=yes',
    );
    expect(email.message).toContain('https://evidence.example.test/event.jpg?signed=example');
    expect(email.message).toContain('Liên kết ảnh hết hạn:');
    expect(email.message).toContain('Mở ArgusAI:\nhttps://app.example.test');
    expect(email.message).not.toContain('ignored');
  });

  it.each([
    'javascript:alert(1)',
    'broken-url',
    'https://name:password@example.test/image',
    'http://example.test/image',
  ])('omits unsafe evidence URL %s', (url) => {
    const email = formatIncidentEmail(
      incident,
      'production',
      { url, expiresAt: new Date(Date.now() + 10000) },
      url,
    );
    expect(email.message).toContain('Ảnh bằng chứng: chưa sẵn sàng');
    expect(email.message).not.toContain(url);
  });

  it('omits expired evidence and distinguishes local Dev app links', () => {
    const email = formatIncidentEmail(
      incident,
      'dev',
      { url: 'https://example.test/expired', expiresAt: new Date(0) },
      'http://localhost:3000',
    );
    expect(email.message).not.toContain('/expired');
    expect(email.message).toContain(
      'Ứng dụng Dev (mở trên máy chạy dự án):\nhttp://localhost:3000',
    );
    expect(
      formatIncidentEmail(incident, 'dev', undefined, 'https://app.example.test').message,
    ).toContain('Mở ArgusAI:');
  });
});

describe('authorized incident email evidence', () => {
  function client(row?: EmailIncident): PoolClient {
    return {
      query: jest.fn().mockResolvedValue({ rows: row ? [row] : [] }),
    } as unknown as PoolClient;
  }
  const options = { storageProvider: 'S3', storageBucket: 'private-bucket' };

  it('falls back promptly when signing stalls instead of blocking a sender claim', async () => {
    jest.useFakeTimers();
    try {
      let completed = false;
      const storage = { getPresignedUrl: () => new Promise<never>(() => {}) };
      const result = enrichEmailDelivery(
        client({ ...incident, object_key: 'image.jpg' }),
        job,
        config,
        delivery,
        { ...options, storage },
      ).then((email) => {
        completed = true;
        return email;
      });
      await jest.advanceTimersByTimeAsync(750);
      expect(completed).toBe(true);
      expect((await result).message).toContain('Ảnh bằng chứng: chưa sẵn sàng');
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not advertise an image after retention expires during signing', async () => {
    jest.useFakeTimers();
    try {
      const now = Date.now();
      const storage = {
        getPresignedUrl: async () => {
          jest.setSystemTime(now + 3000);
          return {
            url: 'https://evidence.example.test/expired-while-signing',
            expiresAt: new Date(now + 900000),
          };
        },
      };
      const email = await enrichEmailDelivery(
        client({ ...incident, object_key: 'image.jpg', image_expires_at: new Date(now + 2000) }),
        job,
        config,
        delivery,
        { ...options, storage },
      );
      expect(email.message).not.toContain('expired-while-signing');
      expect(email.message).toContain('Ảnh bằng chứng: chưa sẵn sàng');
    } finally {
      jest.useRealTimers();
    }
  });

  it('fails closed when the event camera/owner context no longer matches', async () => {
    await expect(enrichEmailDelivery(client(), job, config, delivery)).rejects.toThrow(
      'Email event context changed',
    );
  });

  it('retains useful metadata when there is no image or signer', async () => {
    for (const row of [incident, { ...incident, object_key: 'image.jpg' }]) {
      const email = await enrichEmailDelivery(client(row), job, config, delivery, options);
      expect(email.message).toContain('Camera: Phòng khách');
      expect(email.message).toContain('chưa sẵn sàng');
      expect(email.topicArn).toBe('private-topic');
    }
  });

  it.each([null, new Date(Date.now() + 300000), new Date(0)])(
    'bounds evidence validity to retention %s',
    async (image_expires_at) => {
      const storage = {
        getPresignedUrl: async (_key: string, ttl = 900) => ({
          url: 'https://evidence.example.test/image',
          expiresAt: new Date(Date.now() + ttl * 1000),
        }),
      };
      const email = await enrichEmailDelivery(
        client({ ...incident, object_key: 'image.jpg', image_expires_at }),
        job,
        config,
        delivery,
        { ...options, storage },
      );
      expect(email.message?.includes('https://evidence.example.test/image')).toBe(
        image_expires_at === null || image_expires_at.getTime() > Date.now(),
      );
    },
  );

  it('does not expose signing errors or lose the alert when storage is unavailable', async () => {
    const storage = {
      getPresignedUrl: async () => {
        throw new Error('private credentials');
      },
    };
    const email = await enrichEmailDelivery(
      client({ ...incident, object_key: 'image.jpg' }),
      job,
      config,
      delivery,
      { ...options, storage },
    );
    expect(email.message).toContain('Xâm nhập vùng cấm');
    expect(email.message).toContain('chưa sẵn sàng');
    expect(email.message).not.toContain('private credentials');
  });
});
