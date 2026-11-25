'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Cpu } from 'lucide-react';
import {
  getHouseholdAiModules,
  saveHouseholdAiModules,
  type HouseholdAiModulesInput,
  type HouseholdAiModulesSettings,
} from '@/lib/household-client';
import styles from './household.module.css';
import compact from './caregiver-settings.module.css';

type ModuleKey = keyof HouseholdAiModulesInput;

const AI_MODULES: ReadonlyArray<{
  key: ModuleKey;
  code: string;
  name: string;
  description: string;
}> = [
  {
    key: 'm1Face',
    code: 'M1',
    name: 'Nhận diện khuôn mặt',
    description: 'Nhận dạng người quen đã đăng ký và cảnh báo người lạ trên camera.',
  },
  {
    key: 'm2aFall',
    code: 'M2a',
    name: 'Phát hiện té ngã',
    description: 'Theo dõi tư thế người và kích hoạt cảnh báo khi phát hiện ngã bất động.',
  },
  {
    key: 'm3Fire',
    code: 'M3',
    name: 'Phát hiện cháy & khói',
    description: 'Phân tích khung hình liên tục để phát hiện sớm dấu hiệu hỏa hoạn.',
  },
  {
    key: 'm4Zone',
    code: 'M4',
    name: 'Giám sát vùng cấm',
    description: 'Phát hiện người xâm nhập khu vực hạn chế theo khung giờ đã thiết lập.',
  },
  {
    key: 'm5Wellness',
    code: 'M5',
    name: 'Kiểm tra an sinh định kỳ',
    description: 'Theo dõi hiện diện người thân và gửi nhắc nhở xác nhận an toàn.',
  },
];

function toInput(settings: HouseholdAiModulesSettings): HouseholdAiModulesInput {
  return {
    m1Face: settings.m1Face,
    m2aFall: settings.m2aFall,
    m3Fire: settings.m3Fire,
    m4Zone: settings.m4Zone,
    m5Wellness: settings.m5Wellness,
  };
}

export function AiModulesSettings() {
  const [saved, setSaved] = useState<HouseholdAiModulesSettings | null>(null);
  const [draft, setDraft] = useState<HouseholdAiModulesInput | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const abort = new AbortController();
    void getHouseholdAiModules(abort.signal)
      .then((res) => {
        setSaved(res);
        setDraft(toInput(res));
      })
      .catch((err: unknown) => {
        if (!abort.signal.aborted) {
          setError(err instanceof Error ? err.message : 'Không tải được cấu hình module AI.');
        }
      });
    return () => abort.abort();
  }, []);

  if (!saved || !draft) {
    return (
      <section
        className={`${styles.panel} ${compact.aiModulesSection}`}
        aria-label="Cấu hình module AI"
      >
        <p role={error ? 'alert' : 'status'}>{error || 'Đang tải cấu hình các module AI…'}</p>
      </section>
    );
  }

  const isDirty = AI_MODULES.some(({ key }) => draft[key] !== saved[key]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const updated = await saveHouseholdAiModules(draft);
      setSaved(updated);
      setDraft(toInput(updated));
      setNotice('Đã lưu cấu hình các module AI cho hộ gia đình.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Không thể lưu cấu hình module AI.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className={`${styles.panel} ${compact.aiModulesSection}`}
      aria-labelledby="caregiver-ai-modules-title"
    >
      <div className={compact.aiModulesHeader}>
        <h3 id="caregiver-ai-modules-title">
          <Cpu size={18} /> Cấu hình module AI của hộ
        </h3>
        <p>
          Chỉ Caregiver mới có quyền bật hoặc tắt các module AI cho toàn bộ camera và lịch kiểm tra
          trong hộ gia đình.
        </p>
      </div>

      <form onSubmit={handleSubmit} className={compact.aiModulesForm}>
        <div className={compact.aiModulesGrid}>
          {AI_MODULES.map((mod) => {
            const checked = draft[mod.key];
            const serverReady = saved.availability[mod.key];
            return (
              <label key={mod.key} className={compact.aiModuleCard}>
                <div className={compact.aiModuleTopRow}>
                  <div className={compact.aiModuleTitleRow}>
                    <span className={compact.aiModuleCode}>{mod.code}</span>
                    <span
                      className={
                        !serverReady
                          ? compact.aiBadgeMuted
                          : checked
                            ? compact.aiBadgeOn
                            : compact.aiBadgeOff
                      }
                    >
                      {!serverReady ? 'Máy chủ chưa bật' : checked ? 'Đang bật' : 'Đang tắt'}
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    role="switch"
                    className={compact.aiSwitch}
                    name={mod.key}
                    checked={checked}
                    disabled={busy}
                    aria-label={`Bật ${mod.name} (${mod.code})`}
                    onChange={(e) => {
                      const value = e.target.checked;
                      setDraft((prev) => (prev ? { ...prev, [mod.key]: value } : prev));
                      setNotice('');
                      setError('');
                    }}
                  />
                </div>
                <div className={compact.aiModuleInfo}>
                  <strong>{mod.name}</strong>
                  <p>{mod.description}</p>
                </div>
              </label>
            );
          })}
        </div>

        <div className={compact.aiModulesFooter}>
          <div className={styles.actions} data-form-actions>
            <button type="submit" disabled={busy || !isDirty}>
              {busy ? 'Đang lưu…' : 'Lưu cấu hình AI'}
            </button>
          </div>
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
        </div>
      </form>
    </section>
  );
}
