'use client';
import { useEffect, useState } from 'react';
import { UserRound, LockKeyhole, MessageCircle, HardDrive } from 'lucide-react';
import { apiFetch } from '@/lib/api-client';
import {
  getAccountSettings,
  saveProfile,
  changePassword,
  saveNotificationPreferences,
  saveHouseholdSettings,
  type AccountSettings,
  type NotificationPreferences,
} from '@/lib/household-client';
import { useHousehold } from '@/hooks/useHousehold';
import { EscalationRulesSection } from '@/components/settings/EscalationRulesSection';
import styles from './household.module.css';
import compact from './caregiver-settings.module.css';

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : 'Không thực hiện được. Vui lòng thử lại.';
function AccountPanels() {
  const [account, setAccount] = useState<AccountSettings | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [telegram, setTelegram] = useState<{ linkToken: string; expiresAt: string } | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    void getAccountSettings(abort.signal)
      .then(setAccount)
      .catch((e: unknown) => {
        if (!abort.signal.aborted) setError(errorText(e));
      });
    return () => abort.abort();
  }, []);
  async function run(work: () => Promise<void>, message: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
      setNotice(message);
    } catch (e: unknown) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  if (!account) return <p role={error ? 'alert' : 'status'}>{error || 'Đang tải hồ sơ…'}</p>;
  return (
    <>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}
      <div className={compact.accountGrid}>
        <form
          className={`${styles.form} ${compact.accountForm}`}
          aria-label="Hồ sơ chủ hộ"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            void run(async () => {
              const updated = await saveProfile({
                fullName: String(form.get('fullName')),
                ...(form.get('phone') ? { phone: String(form.get('phone')) } : {}),
              });
              setAccount(updated);
              window.dispatchEvent(new Event('camerai-profile-updated'));
            }, 'Đã lưu hồ sơ.');
          }}
        >
          <h3>
            <UserRound size={18} /> Hồ sơ chủ hộ
          </h3>
          <label>
            Họ tên
            <input
              name="fullName"
              defaultValue={account.fullName}
              required
              maxLength={120}
              disabled={busy}
            />
          </label>
          <label>
            Điện thoại
            <input
              name="phone"
              type="tel"
              pattern="\+[1-9][0-9]{7,14}"
              placeholder="+84901234567"
              defaultValue={account.phone ?? ''}
              disabled={busy}
            />
          </label>
          <p className={compact.accountIdentity}>{account.email}</p>
          <div className={styles.actions} data-form-actions>
            <button disabled={busy}>Lưu hồ sơ</button>
          </div>
        </form>
        <form
          className={`${styles.form} ${compact.accountForm}`}
          aria-label="Đổi mật khẩu"
          onSubmit={(event) => {
            event.preventDefault();
            const node = event.currentTarget,
              form = new FormData(node);
            void run(async () => {
              await changePassword({
                currentPassword: String(form.get('current')),
                newPassword: String(form.get('new')),
              });
              node.reset();
            }, 'Đã đổi mật khẩu và thu hồi các phiên làm mới cũ.');
          }}
        >
          <h3>
            <LockKeyhole size={18} /> Mật khẩu
          </h3>
          {account.authProvider === 'jwt' ? (
            <>
              <label>
                Mật khẩu hiện tại
                <input
                  name="current"
                  type="password"
                  required
                  autoComplete="current-password"
                  disabled={busy}
                />
              </label>
              <label>
                Mật khẩu mới
                <input
                  name="new"
                  type="password"
                  required
                  minLength={10}
                  maxLength={128}
                  autoComplete="new-password"
                  disabled={busy}
                />
              </label>
              <div className={styles.actions} data-form-actions>
                <button disabled={busy}>Đổi mật khẩu</button>
              </div>
            </>
          ) : (
            <p>
              Tài khoản được quản lý bởi Cognito. Dùng chức năng khôi phục mật khẩu trên màn hình
              đăng nhập Cognito.
            </p>
          )}
        </form>
        <section className={`${styles.panel} ${compact.accountSection}`}>
          <h3>
            <MessageCircle size={18} /> Telegram
          </h3>
          <p>{account.telegramLinked ? 'Đã liên kết Telegram.' : 'Chưa liên kết Telegram.'}</p>
          <div className={styles.actions}>
            <button
              disabled={busy}
              onClick={() =>
                void run(
                  async () =>
                    setTelegram(await apiFetch('/auth/telegram/link', { method: 'POST' })),
                  'Đã tạo mã liên kết Telegram một lần.',
                )
              }
            >
              Tạo mã liên kết
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void run(
                  async () => setAccount(await getAccountSettings()),
                  'Đã kiểm tra trạng thái Telegram.',
                )
              }
            >
              Kiểm tra trạng thái
            </button>
          </div>
          {telegram && (
            <div className={compact.telegramCode}>
              <p>
                Gửi lệnh này cho bot Telegram của dự án trước{' '}
                {new Date(telegram.expiresAt).toLocaleTimeString('vi-VN')}:
              </p>
              <code>/start {telegram.linkToken}</code>
              <p>Mã chỉ dùng một lần. Sau khi gửi lệnh, bấm kiểm tra trạng thái.</p>
            </div>
          )}
        </section>
        <section className={`${styles.panel} ${compact.accountSection}`}>
          <h3>Tùy chọn nhận cảnh báo</h3>
          {(
            [
              ['inAppAlerts', 'Thông báo mới trên ứng dụng'],
              ['soundAlerts', 'Âm báo khi có cảnh báo mới'],
              ['telegramAlerts', 'Nhận cảnh báo qua Telegram'],
            ] as const
          ).map(([key, label]) => (
            <label className={styles.preference} key={key}>
              <span>{label}</span>
              <input
                type="checkbox"
                checked={account[key]}
                disabled={busy}
                onChange={(event) => {
                  const value = event.target.checked;
                  void run(async () => {
                    const prefs: NotificationPreferences = {
                      inAppAlerts: account.inAppAlerts,
                      soundAlerts: account.soundAlerts,
                      telegramAlerts: account.telegramAlerts,
                      [key]: value,
                    };
                    await saveNotificationPreferences(prefs);
                    setAccount({ ...account, ...prefs });
                    window.dispatchEvent(new Event('camerai-preferences-updated'));
                  }, 'Đã lưu tùy chọn cảnh báo.');
                }}
              />
            </label>
          ))}
        </section>
      </div>
    </>
  );
}
function HouseholdStorage() {
  const state = useHousehold();
  const [notice, setNotice] = useState('');
  if (!state.data)
    return (
      <p role={state.error ? 'alert' : 'status'}>{state.error || 'Đang tải cấu hình lưu trữ…'}</p>
    );
  const data = state.data,
    used = Number(data.storage.alertMediaBytes) / 1024 ** 3,
    over = used > data.settings.storageQuotaGb;
  return (
    <section
      className={`${styles.panel} ${compact.storageSection}`}
      aria-labelledby="storage-title"
    >
      <div className={compact.storageSummary}>
        <h3 id="storage-title">
          <HardDrive size={19} /> Lưu trữ của hộ
        </h3>
        <p>
          {data.cameras.length} camera ·{' '}
          {data.cameras.filter((camera) => camera.recordingEnabled).length} camera bật ghi hình ·
          Ảnh/video cảnh báo đã lưu: {used.toFixed(3)}&nbsp;GB.
        </p>
        <details className={compact.storageHelp}>
          <summary>Cách tính dung lượng lưu trữ</summary>
          <p>
            Video liên tục được Frigate quản lý theo thời gian lưu của từng camera. Ngưỡng dung
            lượng bên dưới dùng theo dõi ảnh/video cảnh báo, không phải dung lượng ổ đĩa Frigate.
          </p>
        </details>
      </div>
      <form
        className={`${styles.form} ${compact.storageForm}`}
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void state.run(async () => {
            const result = await saveHouseholdSettings({
              retentionDays: Number(form.get('days')),
              storageQuotaGb: Number(form.get('quota')),
            });
            setNotice(
              result.syncFailures.length
                ? `Đã lưu. ${result.syncFailures.length} camera chưa áp dụng được cấu hình; hãy kiểm tra đồng bộ tại trang Camera.`
                : 'Đã lưu và gửi cấu hình thời gian lưu tới các camera trong hộ.',
            );
          }, 'Đã cập nhật cấu hình lưu trữ.');
        }}
      >
        <label>
          Thời gian lưu (ngày)
          <input
            name="days"
            type="number"
            min={1}
            max={90}
            defaultValue={data.settings.retentionDays}
            required
            disabled={state.busy}
          />
        </label>
        <label>
          Ngưỡng theo dõi (GB)
          <input
            name="quota"
            type="number"
            min={1}
            max={100000}
            defaultValue={data.settings.storageQuotaGb}
            required
            disabled={state.busy}
          />
        </label>
        <div className={styles.actions}>
          <button disabled={state.busy}>Lưu cấu hình lưu trữ</button>
        </div>
      </form>
      <div className={compact.storageMessages}>
        {over && (
          <p className={styles.error} role="alert">
            Dung lượng media cảnh báo đã vượt ngưỡng theo dõi.
          </p>
        )}
        {state.error && (
          <p className={compact.storageStatus} role="alert">
            {state.error}
          </p>
        )}
        {notice && (
          <p className={compact.storageStatus} role="status">
            {notice}
          </p>
        )}
      </div>
    </section>
  );
}
export function CaregiverSettingsView() {
  return (
    <section
      className={`${styles.page} ${compact.settingsPage}`}
      aria-labelledby="caregiver-settings-title"
    >
      <header className={styles.heading}>
        <div>
          <h2 id="caregiver-settings-title">Cài đặt của hộ gia đình</h2>
          <p>Hồ sơ, bảo mật, nhận cảnh báo và thời gian lưu video trong hộ của bạn.</p>
        </div>
      </header>
      <AccountPanels />
      <HouseholdStorage />
      <section className={compact.rulesSection}>
        <h3>Quy tắc cảnh báo của hộ</h3>
        <p>
          Điều chỉnh ngưỡng và thời gian chờ của hộ này. Những sự kiện đã phát sinh giữ quy tắc đã
          chụp tại thời điểm xử lý.
        </p>
        <EscalationRulesSection isAdmin household />
      </section>
    </section>
  );
}
