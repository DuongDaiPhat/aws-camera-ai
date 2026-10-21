'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { CurrentUser } from '@/types';
import { listKnownFaces } from '@/lib/known-faces-client';
import { fetchCameras } from '@/lib/cameras-client';
import { subscribeEventsStream } from '@/lib/events-client';
import {
  confirmWellnessCheck,
  createWellnessSchedule,
  deleteWellnessSchedule,
  listWellnessChecks,
  listWellnessSchedules,
  updateWellnessSchedule,
  type ConfirmationInput,
  type ScheduleInput,
  type WellnessCheck,
  type WellnessSchedule,
} from '@/lib/wellness-client';
import styles from './wellness.module.css';

const fresh = (): ScheduleInput => ({
  residentUserId: '',
  name: 'Kiểm tra sức khỏe',
  checkAt: '09:00',
  timezone: 'Asia/Ho_Chi_Minh',
  daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
  lookbackHours: 6,
  graceSeconds: 300,
  cameraIds: [],
  isEnabled: true,
});
const message = (error: unknown) =>
  error instanceof Error ? error.message : 'Không thể kết nối. Vui lòng thử lại.';
const time = (value?: string | null) => (value ? new Date(value).toLocaleString('vi-VN') : '—');
const labels: Record<string, string> = {
  PENDING: 'Chờ đánh giá',
  PROCESSING: 'Đang đánh giá',
  SKIPPED_ACTIVITY: 'Đã ghi nhận hoạt động',
  SKIPPED_AWAY: 'Đã rời nhà',
  SKIPPED_DISABLED: 'Lịch đã tắt',
  SKIPPED_SUPERSEDED: 'Đã có yêu cầu hoặc lịch đã đổi',
  MISSED: 'Bỏ lỡ lịch',
  ALERT_CREATED: 'Đã tạo yêu cầu',
  NOTIFIED: 'Chờ phản hồi',
  RESOLVED: 'Đã xác nhận ổn',
  ESCALATED: 'Đã chuyển người chăm sóc',
  CLOSED: 'Đã đóng',
};

export function WellnessView({ user }: { user: CurrentUser | null }) {
  const manager = user?.role === 'ADMIN' || user?.role === 'CAREGIVER';
  const [schedules, setSchedules] = useState<WellnessSchedule[]>([]);
  const [checks, setChecks] = useState<WellnessCheck[]>([]);
  const [residents, setResidents] = useState<{ id: string; name: string }[]>([]);
  const [cameras, setCameras] = useState<{ id: string; name: string }[]>([]);
  const [draft, setDraft] = useState(fresh);
  const [editing, setEditing] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const commands = useRef(new Map<string, ConfirmationInput>());
  const refresh = useCallback(async () => {
    const [scheduleResult, checkResult] = await Promise.all([
      listWellnessSchedules(),
      listWellnessChecks(page),
    ]);
    setSchedules(scheduleResult.data);
    setChecks(checkResult.data);
    setTotal(checkResult.total);
  }, [page]);
  useEffect(() => {
    let mounted = true;
    setLoading(true);
    void refresh()
      .catch((e) => {
        if (mounted) setError(message(e));
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    const reload = () => {
      void refresh().catch((e) => {
        if (mounted) setError(message(e));
      });
    };
    const interval = setInterval(reload, 5000);
    const unsubscribe = subscribeEventsStream({ onCreated: reload, onUpdated: reload });
    return () => {
      mounted = false;
      clearInterval(interval);
      unsubscribe();
    };
  }, [refresh]);
  useEffect(() => {
    if (!manager) return;
    void Promise.all([listKnownFaces(), fetchCameras({ isEnabled: true })])
      .then(([faces, cams]) => {
        setResidents([
          ...new Map(
            faces.data
              .filter((f) => f.linkedUserId)
              .map((f) => [f.linkedUserId!, { id: f.linkedUserId!, name: f.personName }]),
          ).values(),
        ]);
        setCameras(cams.map((c) => ({ id: c.id, name: c.name })));
      })
      .catch((e) => setError(message(e)));
  }, [manager]);
  async function act(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      setNotice(success);
      await refresh();
    } catch (e) {
      setError(message(e));
      await refresh().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    await act(async () => {
      if (editing) await updateWellnessSchedule(editing, draft);
      else await createWellnessSchedule(draft);
      setEditing(null);
      setDraft(fresh());
    }, 'Đã lưu lịch kiểm tra.');
  }
  function edit(schedule: WellnessSchedule) {
    setEditing(schedule.id);
    setDraft({
      residentUserId: schedule.residentUserId,
      name: schedule.name,
      checkAt: schedule.checkAt.slice(0, 5),
      daysOfWeek: schedule.daysOfWeek,
      lookbackHours: schedule.lookbackHours,
      graceSeconds: schedule.graceSeconds,
      cameraIds: schedule.cameraIds,
      timezone: schedule.timezone,
      isEnabled: schedule.isEnabled,
    });
  }
  async function confirm(check: WellnessCheck, response: 'IM_OK' | 'NEED_HELP') {
    const key = `${check.id}:${response}`;
    let input = commands.current.get(key);
    if (!input) {
      input = { commandId: crypto.randomUUID(), response };
      commands.current.set(key, input);
    }
    await act(
      () => confirmWellnessCheck(check.id, input!),
      response === 'IM_OK'
        ? 'Đã ghi nhận: Bạn vẫn ổn.'
        : 'Đã chuyển yêu cầu giúp đỡ tới người chăm sóc.',
    );
  }
  const residentName = (id: string) =>
    residents.find((r) => r.id === id)?.name ?? (id === user?.id ? user.fullName : id);
  return (
    <section className={styles.root} aria-label="Kiểm tra sức khỏe">
      <header>
        <h1>Kiểm tra sức khỏe</h1>
        <p>Lịch theo dõi hoạt động và yêu cầu xác nhận của người được giám sát.</p>
      </header>
      {error && (
        <p role="alert" className={styles.error}>
          {error}{' '}
          <button onClick={() => void act(refresh, 'Đã tải lại dữ liệu.')} disabled={busy}>
            Thử lại
          </button>
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {loading && <p role="status">Đang tải lịch và yêu cầu…</p>}
      {manager && (
        <form onSubmit={save} className={styles.panel}>
          <h2>{editing ? 'Sửa lịch kiểm tra' : 'Tạo lịch kiểm tra'}</h2>
          <fieldset disabled={busy} className={styles.fields}>
            <label>
              Người được giám sát
              <select
                required
                value={draft.residentUserId}
                onChange={(e) => setDraft({ ...draft, residentUserId: e.target.value })}
              >
                <option value="">Chọn người đã liên kết</option>
                {residents.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Tên lịch
              <input
                required
                maxLength={100}
                value={draft.name ?? ''}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <label>
              Giờ kiểm tra
              <input
                required
                type="time"
                value={draft.checkAt}
                onChange={(e) => setDraft({ ...draft, checkAt: e.target.value })}
              />
            </label>
            <label>
              Múi giờ
              <input
                required
                value={draft.timezone ?? ''}
                onChange={(e) => setDraft({ ...draft, timezone: e.target.value })}
              />
            </label>
            <label>
              Khoảng theo dõi (giờ)
              <input
                required
                type="number"
                min={1}
                max={24}
                value={draft.lookbackHours}
                onChange={(e) => setDraft({ ...draft, lookbackHours: Number(e.target.value) })}
              />
            </label>
            <label>
              Thời gian phản hồi (giây)
              <input
                required
                type="number"
                min={60}
                max={3600}
                value={draft.graceSeconds}
                onChange={(e) => setDraft({ ...draft, graceSeconds: Number(e.target.value) })}
              />
            </label>
            <div className={styles.wide}>
              <span>Ngày kiểm tra</span>
              <div className={styles.choices}>
                {[1, 2, 3, 4, 5, 6, 7].map((day) => (
                  <label key={day}>
                    <input
                      type="checkbox"
                      checked={draft.daysOfWeek?.includes(day) ?? false}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          daysOfWeek: e.target.checked
                            ? [...(draft.daysOfWeek ?? []), day].sort()
                            : (draft.daysOfWeek ?? []).filter((d) => d !== day),
                        })
                      }
                    />
                    {day === 7 ? 'Chủ nhật' : `Thứ ${day + 1}`}
                  </label>
                ))}
              </div>
            </div>
            <div className={styles.wide}>
              <span>Camera (để trống để dùng tất cả camera đang bật trong hộ)</span>
              <div className={styles.choices}>
                {cameras.map((camera) => (
                  <label key={camera.id}>
                    <input
                      type="checkbox"
                      checked={draft.cameraIds?.includes(camera.id) ?? false}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          cameraIds: e.target.checked
                            ? [...(draft.cameraIds ?? []), camera.id]
                            : (draft.cameraIds ?? []).filter((id) => id !== camera.id),
                        })
                      }
                    />
                    {camera.name}
                  </label>
                ))}
              </div>
            </div>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={draft.isEnabled ?? true}
                onChange={(e) => setDraft({ ...draft, isEnabled: e.target.checked })}
              />
              Bật lịch (cần liên kết Telegram)
            </label>
          </fieldset>
          <div className={styles.actions}>
            <button disabled={busy || !draft.daysOfWeek?.length} type="submit">
              Lưu lịch
            </button>
            {editing && (
              <button
                type="button"
                onClick={() => {
                  setEditing(null);
                  setDraft(fresh());
                }}
              >
                Hủy sửa
              </button>
            )}
          </div>
          {!residents.length && (
            <p>
              Cần đăng ký khuôn mặt và liên kết tài khoản người được giám sát trong hộ trước khi tạo
              lịch.
            </p>
          )}
        </form>
      )}
      <div className={styles.panel}>
        <h2>Lịch kiểm tra</h2>
        {!loading && !schedules.length && <p>Chưa có lịch kiểm tra.</p>}
        {schedules.map((schedule) => (
          <article key={schedule.id} className={styles.row}>
            <div>
              <h3>{schedule.name}</h3>
              <p>
                {residentName(schedule.residentUserId)} · {schedule.checkAt.slice(0, 5)} ·{' '}
                {schedule.timezone}
              </p>
              <p>
                {schedule.daysOfWeek.map((d) => (d === 7 ? 'CN' : `T${d + 1}`)).join(', ')} · Theo
                dõi {schedule.lookbackHours} giờ · Phản hồi {schedule.graceSeconds} giây
              </p>
              <strong>
                {schedule.configurationStatus === 'INVALID_CONFIG'
                  ? 'Cần sửa cấu hình'
                  : schedule.isEnabled
                    ? 'Đang bật'
                    : 'Đang tắt'}
              </strong>
            </div>
            {manager && (
              <div className={styles.actions}>
                <button disabled={busy} onClick={() => edit(schedule)}>
                  Sửa
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    void act(
                      () => updateWellnessSchedule(schedule.id, { isEnabled: !schedule.isEnabled }),
                      'Đã cập nhật trạng thái lịch.',
                    )
                  }
                >
                  {schedule.isEnabled ? 'Tắt' : 'Bật'}
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    void act(
                      () => deleteWellnessSchedule(schedule.id),
                      'Đã xóa lịch; lịch sử được giữ lại.',
                    )
                  }
                >
                  Xóa
                </button>
              </div>
            )}
          </article>
        ))}
      </div>
      <div className={styles.panel}>
        <h2>Yêu cầu và lịch sử</h2>
        {!loading && !checks.length && <p>Chưa có lượt kiểm tra.</p>}
        {checks.map((check) => (
          <article key={check.id} className={styles.row}>
            <div>
              <h3>{labels[check.eventStatus ?? check.status] ?? check.status}</h3>
              <p>
                {residentName(check.residentUserId)} · Lịch: {time(check.scheduledFor)}
              </p>
              <p>
                Hoạt động gần nhất: {time(check.lastActivityAt)} ·{' '}
                {check.presenceState === 'AWAY'
                  ? 'Đã rời nhà'
                  : check.presenceState === 'HOME'
                    ? 'Ở nhà'
                    : 'Chưa đủ bằng chứng hiện diện'}
              </p>
              {check.status === 'ALERT_CREATED' && (
                <p>
                  {check.requestSentAt
                    ? `Đã gửi: ${time(check.requestSentAt)} · Hạn phản hồi: ${time(check.confirmationDeadlineAt)}`
                    : 'Đang chờ gửi yêu cầu xác nhận'}
                </p>
              )}
              {check.decisionReason && <p>{check.decisionReason}</p>}
            </div>
            {check.residentUserId === user?.id &&
              check.eventStatus === 'NOTIFIED' &&
              check.requestSentAt && (
                <div className={styles.actions}>
                  <button disabled={busy} onClick={() => void confirm(check, 'IM_OK')}>
                    Tôi ổn
                  </button>
                  <button disabled={busy} onClick={() => void confirm(check, 'NEED_HELP')}>
                    Cần giúp đỡ
                  </button>
                </div>
              )}
          </article>
        ))}
        {total > 20 && (
          <div className={styles.actions}>
            <button disabled={page === 1 || busy} onClick={() => setPage(page - 1)}>
              Trang trước
            </button>
            <span>
              Trang {page} / {Math.ceil(total / 20)}
            </span>
            <button disabled={page * 20 >= total || busy} onClick={() => setPage(page + 1)}>
              Trang sau
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
