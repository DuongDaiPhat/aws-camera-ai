'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api-client';
import { FIRE_DETAIL_FAST_POLL_MS, FIRE_DETAIL_REFRESH_MS } from '@/lib/fire-ui-config';
import type { components, operations } from '@/types';
import { ChannelFluentIcon } from './FireAlertIcons';
import styles from './event-detail-modal.module.css';

type Notification = components['schemas']['Notification'];
type NotificationsResponse =
  operations['listEventNotifications']['responses'][200]['content']['application/json'];

const channels: Record<Notification['channel'], string> = {
  TELEGRAM: 'Telegram',
  SNS_EMAIL: 'Email',
  SNS_SMS: 'SMS',
  CONNECT_CALL: 'Cuộc gọi',
  DASHBOARD: 'Bảng điều khiển',
  WEBHOOK: 'Webhook',
};

const statuses: Record<Notification['status'], string> = {
  PENDING: 'Đang chờ gửi',
  SENT: 'Nhà cung cấp đã tiếp nhận',
  FAILED: 'Gửi thất bại',
  CONFIRMED: 'Người nhận đã xác nhận',
  SKIPPED: 'Đã bỏ qua',
};

function notificationStatus({ status, errorCode }: Notification): string {
  if (status === 'SKIPPED') {
    if (errorCode === 'BLOCKED_PROVIDER') return 'Chưa đủ cấu hình kênh gửi';
    if (errorCode === 'DRY_RUN' || errorCode === 'LAB_DRY_RUN' || errorCode === 'SENDER_DRY_RUN')
      return 'Chạy thử, không gửi';
  }
  if (status === 'FAILED') {
    if (errorCode === 'LEASE_EXPIRED') return 'Đã quá hạn gửi';
    if (errorCode === 'LAMBDA_TIME_BUDGET') return 'Hết thời gian xử lý gửi';
  }
  if (status === 'PENDING' && errorCode === 'UNCERTAIN') return 'Chưa rõ kết quả, cần đối soát';
  return statuses[status];
}

function statusPillClass(status: Notification['status']): string {
  if (status === 'SENT' || status === 'CONFIRMED') return styles.notifToneSuccess;
  if (status === 'FAILED') return styles.notifToneDanger;
  if (status === 'PENDING') return styles.notifToneWarning;
  return styles.notifToneNeutral;
}

export function EventNotifications({
  eventId,
  eventStatus,
  refreshSignal = 0,
}: {
  eventId: string;
  eventStatus?: string;
  refreshSignal?: number;
}) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [error, setError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      let nextDelay = FIRE_DETAIL_REFRESH_MS;
      try {
        const result = await apiFetch<NotificationsResponse>(`/events/${eventId}/notifications`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setNotifications(result.data);
        setError(false);
        const hasPending = result.data.some((item) => item.status === 'PENDING');
        const awaitingDispatch =
          result.data.length === 0 && (eventStatus === 'NOTIFIED' || eventStatus === 'ESCALATED');
        if (hasPending || awaitingDispatch) {
          nextDelay = FIRE_DETAIL_FAST_POLL_MS;
        }
      } catch {
        if (controller.signal.aborted) return;
        setError(true);
      }
      timer = setTimeout(() => void load(), nextDelay);
    }
    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [eventId, eventStatus, refreshSignal]);

  if (!notifications.length && !error) return null;

  return (
    <section className={styles.notificationsSection}>
      <h3 className={styles.sectionTitle}>Kênh thông báo khẩn</h3>
      {error && (
        <p className={styles.inlineNoticeError} role="status">
          Chưa cập nhật được trạng thái thông báo.
        </p>
      )}
      <ul className={styles.notificationGrid}>
        {notifications.map((notification) => (
          <li
            className={`${styles.notificationItem} ${statusPillClass(notification.status)}`}
            key={notification.id}
          >
            <div className={styles.notificationChannelRow}>
              <ChannelFluentIcon channel={notification.channel} size={20} />
              <strong>{channels[notification.channel]}</strong>
            </div>
            <span className={styles.notificationStatusText}>
              {notificationStatus(notification)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
