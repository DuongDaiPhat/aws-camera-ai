'use client';

import type { components } from '@cam/contracts';
import { useEffect, useState, type FormEvent } from 'react';
import { apiFetch } from '@/lib/api-client';
import styles from './settings-view.module.css';

type EmailSettings = components['schemas']['EmailAlertSettings'];
type PhoneSettings = components['schemas']['PhoneAlertSettings'];
const ROOT = '/account/alert-delivery';

function useDeliverySettings<T>(channel: 'email' | 'phone') {
  const path = ROOT + '/' + channel;
  const [state, setState] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const fail = (value: unknown) =>
    setError(value instanceof Error ? value.message : 'Không thể cập nhật cài đặt.');

  useEffect(() => {
    const controller = new AbortController();
    void apiFetch<T>(path, { signal: controller.signal })
      .then(setState)
      .catch((value: unknown) => {
        if (!controller.signal.aborted) fail(value);
      });
    return () => controller.abort();
  }, [path]);

  async function update(body: unknown, action: '' | '/verify' = '') {
    setBusy(true);
    setError('');
    try {
      setState(
        await apiFetch<T>(path + action, {
          method: action ? 'POST' : 'PUT',
          body: JSON.stringify(body),
        }),
      );
    } catch (value) {
      fail(value);
    } finally {
      setBusy(false);
    }
  }
  return { state, setState, error, busy, update };
}

function PhoneSettingsForm() {
  const { state, error, busy, update } = useDeliverySettings<PhoneSettings>('phone');
  if (!state)
    return <p role={error ? 'alert' : 'status'}>{error || 'Đang tải cài đặt điện thoại…'}</p>;
  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void update({
      callEnabled: data.has('call'),
      smsEnabled: data.has('sms'),
      phone: String(data.get('phone') ?? '').trim() || undefined,
    });
  };
  return (
    <section className={styles.ruleCard}>
      <div className={styles.cardHeader}>
        <h4>Cuộc gọi và SMS</h4>
      </div>
      <div className={styles.alertDeliveryBody}>
        <form
          onSubmit={save}
          key={JSON.stringify([state.callEnabled, state.smsEnabled, state.phone])}
        >
          <label className={styles.viewerToggleRow}>
            <span>Nhận cuộc gọi cảnh báo</span>
            <input
              name="call"
              type="checkbox"
              defaultChecked={state.callEnabled}
              disabled={busy || (!state.callAvailable && !state.callEnabled)}
            />
          </label>
          <label className={styles.viewerToggleRow}>
            <span>Nhận SMS cảnh báo</span>
            <input
              name="sms"
              type="checkbox"
              defaultChecked={state.smsEnabled}
              disabled={busy || (!state.smsAvailable && !state.smsEnabled)}
            />
          </label>
          <label className={styles.alertDeliveryField}>
            Số điện thoại nhận cảnh báo
            <input
              name="phone"
              type="tel"
              placeholder={state.accountPhone ?? '+84901234567'}
              maxLength={16}
              defaultValue={state.phone !== state.accountPhone ? (state.phone ?? '') : ''}
              disabled={busy}
            />
          </label>
          <p className={styles.viewerHint}>
            Để trống để dùng số tài khoản. Với số chưa xác minh, bạn sẽ nhận một mã qua SMS.
          </p>
          <button
            type="submit"
            disabled={
              busy ||
              !(state.callAvailable || state.smsAvailable || state.callEnabled || state.smsEnabled)
            }
          >
            Lưu cài đặt điện thoại
          </button>
        </form>
        {!(state.callAvailable && state.smsAvailable) && (
          <p className={styles.viewerHint}>
            {!state.callAvailable && !state.smsAvailable
              ? 'Cuộc gọi và SMS chưa được cấu hình ở môi trường này.'
              : !state.callAvailable
                ? 'Cuộc gọi chưa được cấu hình ở môi trường này.'
                : 'Cảnh báo SMS chưa được cấu hình ở môi trường này.'}
          </p>
        )}
        {state.status === 'PENDING' && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void update(
                { code: String(new FormData(event.currentTarget).get('code')) },
                '/verify',
              );
            }}
          >
            <label className={styles.alertDeliveryField}>
              Mã xác minh
              <input
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                disabled={busy}
              />
            </label>
            <button type="submit" disabled={busy}>
              Xác minh số điện thoại
            </button>
          </form>
        )}
        <p role="status">
          {state.status === 'VERIFIED'
            ? `Đã xác minh ${state.phone}`
            : state.status === 'PENDING'
              ? 'Chờ xác minh số điện thoại'
              : 'Đã tắt cảnh báo qua điện thoại'}
        </p>
        {error && <p role="alert">{error}</p>}
      </div>
    </section>
  );
}

function EmailSettingsForm() {
  const { state, setState, error, busy, update } = useDeliverySettings<EmailSettings>('email');
  const pending = state?.status === 'PENDING' && state.confirmationSent;
  useEffect(() => {
    if (!pending || busy) return;
    const controller = new AbortController();
    const timer = setInterval(() => {
      void apiFetch<EmailSettings>(ROOT + '/email', { signal: controller.signal })
        .then((next) => {
          if (!controller.signal.aborted) setState(next);
        })
        .catch(() => undefined);
    }, 10_000);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [busy, pending, setState]);
  if (!state) return <p role={error ? 'alert' : 'status'}>{error || 'Đang tải cài đặt email…'}</p>;
  return (
    <section className={styles.ruleCard}>
      <div className={styles.cardHeader}>
        <h4>Email</h4>
      </div>
      <div className={styles.alertDeliveryBody}>
        <form
          key={JSON.stringify([state.enabled, state.email])}
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            void update({
              enabled: data.has('emailEnabled'),
              email: String(data.get('email') ?? '').trim() || undefined,
            });
          }}
        >
          <label className={styles.viewerToggleRow}>
            <span>Nhận email cảnh báo</span>
            <input
              type="checkbox"
              name="emailEnabled"
              defaultChecked={state.enabled}
              disabled={busy || (!state.available && !state.enabled)}
            />
          </label>
          <label className={styles.alertDeliveryField}>
            Email nhận cảnh báo
            <input
              type="email"
              name="email"
              maxLength={254}
              placeholder={state.accountEmail}
              defaultValue={state.email !== state.accountEmail ? state.email : ''}
              disabled={busy}
            />
          </label>
          <p className={styles.viewerHint}>
            Để trống để dùng email tài khoản. Khi bật hoặc đổi email, hãy mở thư xác nhận.
          </p>
          <button type="submit" disabled={busy || !(state.available || state.enabled)}>
            Lưu cài đặt email
          </button>
        </form>
        <p role="status">
          {!state.available
            ? 'Email chưa được cấu hình ở môi trường này.'
            : state.status === 'VERIFIED'
              ? `Đã bật email cho ${state.email}`
              : pending
                ? `Chờ xác nhận qua thư gửi đến ${state.email}`
                : state.status === 'PENDING'
                  ? 'Chưa gửi được thư xác nhận. Hãy lưu lại để thử lại.'
                  : 'Đã tắt cảnh báo qua email'}
        </p>
        {error && <p role="alert">{error}</p>}
      </div>
    </section>
  );
}

export function AlertDeliverySettings() {
  return (
    <section className={styles.alertDeliverySection} aria-label="Kênh nhận cảnh báo cá nhân">
      <h3>Kênh nhận cảnh báo cá nhân</h3>
      <div className={styles.viewerGrid}>
        <PhoneSettingsForm />
        <EmailSettingsForm />
      </div>
    </section>
  );
}
