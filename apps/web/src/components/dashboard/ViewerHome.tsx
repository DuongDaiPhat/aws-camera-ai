'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { UIEventItem } from '@/types';
import {
  confirmWellnessCheck,
  listWellnessChecks,
  listWellnessSchedules,
  type ConfirmationInput,
  type WellnessCheck,
  type WellnessSchedule,
} from '@/lib/wellness-client';
import { formatExactTime, getEventTypeLabel } from '@/lib/format';
import { triggerSosHelp } from '@/lib/events-client';
import styles from './viewer-home.module.css';

interface ViewerHomeProps {
  userName?: string;
  events: UIEventItem[];
  onNavigate: (page: string) => void;
  onViewEvent: (event: UIEventItem) => void;
  onReady?: () => void;
}

const DAY_LABELS: Record<number, string> = {
  1: 'T2',
  2: 'T3',
  3: 'T4',
  4: 'T5',
  5: 'T6',
  6: 'T7',
  7: 'CN',
};

function formatDays(days: number[]): string {
  if (days.length === 7) return 'Hàng ngày';
  return days.map((d) => DAY_LABELS[d] ?? String(d)).join(', ');
}

export function ViewerHome({
  userName,
  events,
  onNavigate,
  onViewEvent,
  onReady,
}: ViewerHomeProps) {
  const [schedules, setSchedules] = useState<WellnessSchedule[]>([]);
  const [checks, setChecks] = useState<WellnessCheck[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [sosBusy, setSosBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const commands = useRef(new Map<string, ConfirmationInput>());

  const load = useCallback(async () => {
    try {
      setError(null);
      const [scheduleRes, checkRes] = await Promise.all([
        listWellnessSchedules(),
        listWellnessChecks(1),
      ]);
      setSchedules(scheduleRes.data ?? []);
      setChecks(checkRes.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải thông tin kiểm tra an toàn.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load().then(() => onReady?.());
  }, [load, onReady]);

  const pendingChecks = useMemo(
    () =>
      checks.filter((check) => check.eventStatus === 'NOTIFIED' && Boolean(check.requestSentAt)),
    [checks],
  );
  const pendingEvents = useMemo(
    () => events.filter((evt) => evt.status === 'NOTIFIED' || evt.status === 'ESCALATED'),
    [events],
  );
  const nextSchedule = useMemo(() => {
    const enabled = schedules.filter((s) => s.isEnabled);
    if (enabled.length === 0) return null;
    return [...enabled].sort((a, b) => a.checkAt.localeCompare(b.checkAt))[0] ?? null;
  }, [schedules]);

  const handleConfirm = async (checkId: string, response: 'IM_OK' | 'NEED_HELP') => {
    const key = `${checkId}:${response}`;
    let input = commands.current.get(key);
    if (!input) {
      input = { response, commandId: crypto.randomUUID() };
      commands.current.set(key, input);
    }
    setBusyId(checkId);
    setNotice(null);
    setError(null);
    try {
      await confirmWellnessCheck(checkId, input);
      commands.current.delete(key);
      setNotice(
        response === 'IM_OK'
          ? 'Đã xác nhận bạn an toàn.'
          : 'Đã gửi yêu cầu trợ giúp tới người chăm sóc.',
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể gửi phản hồi.');
    } finally {
      setBusyId(null);
    }
  };

  const handleQuickHelp = async () => {
    setSosBusy(true);
    setNotice(null);
    setError(null);
    try {
      await triggerSosHelp();
      setNotice('Đã gửi yêu cầu trợ giúp khẩn cấp tới người chăm sóc trong hộ.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể gửi yêu cầu trợ giúp.');
    } finally {
      setSosBusy(false);
    }
  };

  return (
    <div className={styles.container}>
      <section className={styles.hero} aria-label="Tổng quan tài khoản Viewer">
        <div className={styles.heroText}>
          <h2>Xin chào, {userName || 'bạn'}</h2>
          <p>
            Theo dõi các yêu cầu xác nhận đang chờ, lịch kiểm tra tiếp theo và thông báo của bạn.
          </p>
        </div>
        <button
          type="button"
          className={styles.helpButton}
          disabled={Boolean(busyId) || sosBusy}
          onClick={() => void handleQuickHelp()}
        >
          {sosBusy ? 'Đang gửi yêu cầu…' : 'Yêu cầu trợ giúp'}
        </button>
      </section>

      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <div className={styles.grid}>
        <section className={styles.card} aria-labelledby="viewer-pending-title">
          <div className={styles.cardHeader}>
            <h3 id="viewer-pending-title">Yêu cầu xác nhận đang chờ</h3>
            <span
              className={`${styles.badge} ${pendingChecks.length + pendingEvents.length > 0 ? styles.badgeWarn : ''}`}
            >
              {pendingChecks.length + pendingEvents.length} đang chờ
            </span>
          </div>

          {loading ? (
            <p className={styles.emptyText}>Đang tải yêu cầu…</p>
          ) : pendingChecks.length === 0 && pendingEvents.length === 0 ? (
            <p className={styles.emptyText}>Hiện tại không có yêu cầu xác nhận nào đang chờ.</p>
          ) : (
            <ul className={styles.list}>
              {pendingChecks.map((check) => (
                <li key={check.id} className={styles.listItem}>
                  <div className={styles.itemTop}>
                    <strong>Kiểm tra an toàn</strong>
                    <span className={styles.itemMeta}>
                      Hẹn lúc {formatExactTime(check.scheduledFor)}
                    </span>
                  </div>
                  <div className={styles.itemActions}>
                    <button
                      type="button"
                      className={styles.okButton}
                      disabled={busyId === check.id}
                      onClick={() => void handleConfirm(check.id, 'IM_OK')}
                    >
                      Tôi ổn
                    </button>
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      disabled={busyId === check.id}
                      onClick={() => void handleConfirm(check.id, 'NEED_HELP')}
                    >
                      Cần giúp đỡ
                    </button>
                  </div>
                </li>
              ))}
              {pendingEvents.slice(0, 3).map((evt) => (
                <li key={evt.id} className={styles.listItem}>
                  <div className={styles.itemTop}>
                    <strong>{getEventTypeLabel(evt.eventType)}</strong>
                    <span className={styles.itemMeta}>{evt.relativeTimeText}</span>
                  </div>
                  <div className={styles.itemActions}>
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      onClick={() => onViewEvent(evt)}
                    >
                      Xem chi tiết
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={styles.card} aria-labelledby="viewer-schedule-title">
          <div className={styles.cardHeader}>
            <h3 id="viewer-schedule-title">Lịch kiểm tra tiếp theo</h3>
            <span className={styles.badge}>{schedules.filter((s) => s.isEnabled).length} lịch</span>
          </div>

          {loading ? (
            <p className={styles.emptyText}>Đang tải lịch kiểm tra…</p>
          ) : !nextSchedule ? (
            <p className={styles.emptyText}>Chưa có lịch kiểm tra an toàn nào được kích hoạt.</p>
          ) : (
            <div className={styles.listItem}>
              <div className={styles.itemTop}>
                <strong>{nextSchedule.name}</strong>
                <span>{nextSchedule.checkAt}</span>
              </div>
              <span className={styles.itemMeta}>
                Chu kỳ: {formatDays(nextSchedule.daysOfWeek)} · Múi giờ {nextSchedule.timezone}
              </span>
            </div>
          )}

          <div className={styles.quickLinks}>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => onNavigate('cameras')}
            >
              Camera trực tiếp
            </button>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => onNavigate('playback')}
            >
              Xem lại
            </button>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => onNavigate('events')}
            >
              Thông báo của tôi
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
