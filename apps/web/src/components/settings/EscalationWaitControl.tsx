'use client';

import type { ReactNode } from 'react';
import type { EscalationRule } from '@/lib/escalation-rules-client';
import {
  MAX_WAIT_SECONDS,
  MIN_WAIT_SECONDS,
  WAIT_PRESETS,
  isValidWaitSeconds,
  isValidHighWaitSeconds,
  previewEffectiveWait,
  usesShortenedWait,
} from '@/lib/escalation-wait-settings';
import styles from './settings-view.module.css';

interface EscalationWaitControlProps {
  rule: EscalationRule;
  seconds: number;
  disabled: boolean;
  onChange: (seconds: number) => void;
  onHighWaitChange?: (seconds: number | null) => void;
  hasUnsavedChanges?: boolean;
  children?: ReactNode;
}

function WaitPresets({
  seconds,
  disabled,
  onChange,
}: Pick<EscalationWaitControlProps, 'seconds' | 'disabled' | 'onChange'>) {
  return (
    <div className={styles.waitPresets} role="group" aria-label="Chọn nhanh thời gian chờ">
      {WAIT_PRESETS.map((preset) => (
        <button
          key={preset.seconds}
          type="button"
          className={styles.waitPreset}
          disabled={disabled}
          aria-pressed={seconds === preset.seconds}
          onClick={() => onChange(preset.seconds)}
        >
          {preset.label}
        </button>
      ))}
    </div>
  );
}

export function EscalationWaitControl({
  rule,
  seconds,
  disabled,
  onChange,
  onHighWaitChange,
  hasUnsavedChanges = seconds !== rule.tWaitSeconds,
  children,
}: EscalationWaitControlProps) {
  const id = `tWait-${rule.eventType}`;
  const isValid = isValidWaitSeconds(seconds);
  const effectiveWait = previewEffectiveWait(rule, seconds);
  const isShortened = usesShortenedWait(rule);
  const highWaitValid = !isShortened || isValidHighWaitSeconds(rule.highWaitSeconds, seconds);

  return (
    <div className={styles.waitLayout}>
      <div className={styles.ruleEditors}>
        <section className={styles.waitPanel} aria-labelledby={`${id}-title`}>
          <h4 id={`${id}-title`} className={styles.editorTitle}>
            Thời gian chờ xác nhận
          </h4>
          <div className={styles.inputsGrid}>
            <div className={styles.fieldGroup}>
              <label htmlFor={id} className={styles.fieldLabel}>
                Thời gian cơ sở (T_wait)
              </label>
              <div className={styles.inputWrapper}>
                <input
                  id={id}
                  type="number"
                  step="1"
                  min={MIN_WAIT_SECONDS}
                  max={MAX_WAIT_SECONDS}
                  disabled={disabled}
                  className={styles.inputNumber}
                  value={Number.isFinite(seconds) ? seconds : ''}
                  aria-invalid={!isValid}
                  aria-describedby={`${id}-hint ${id}-basis`}
                  onChange={(event) =>
                    onChange(event.target.value === '' ? NaN : Number(event.target.value))
                  }
                />
                <span className={styles.inputSuffix}>giây</span>
              </div>
              <span id={`${id}-hint`} className={styles.fieldHint}>
                Số nguyên {MIN_WAIT_SECONDS}–{MAX_WAIT_SECONDS} giây. Chọn nhanh hoặc nhập theo nhu
                cầu.
              </span>
            </div>
            {isShortened && (
              <div className={styles.fieldGroup}>
                <label htmlFor={`${id}-high`} className={styles.fieldLabel}>
                  Nhánh khẩn cấp (độ tin cậy ≥ T_high)
                </label>
                <div className={styles.inputWrapper}>
                  <input
                    id={`${id}-high`}
                    type="number"
                    min="0"
                    max={isValid ? seconds - 1 : undefined}
                    step="1"
                    disabled={disabled}
                    className={styles.inputNumber}
                    value={
                      typeof rule.highWaitSeconds === 'number' &&
                      Number.isFinite(rule.highWaitSeconds)
                        ? rule.highWaitSeconds
                        : ''
                    }
                    aria-invalid={!highWaitValid}
                    aria-describedby={`${id}-high-hint`}
                    onChange={(event) =>
                      onHighWaitChange?.(
                        event.target.value === '' ? null : Number(event.target.value),
                      )
                    }
                  />
                  <span className={styles.inputSuffix}>giây</span>
                </div>
                <span id={`${id}-high-hint`} className={styles.fieldHint}>
                  Nhập số nguyên nhỏ hơn thời gian cơ sở. Chọn 0 để chuyển cấp mà không chờ xác
                  nhận.
                </span>
              </div>
            )}
          </div>
          {!highWaitValid && (
            <p className={`${styles.feedbackMessage} ${styles.feedbackError}`} role="alert">
              Nhánh khẩn cấp phải là số nguyên không âm và nhỏ hơn T_wait.
            </p>
          )}
          <WaitPresets seconds={seconds} disabled={disabled} onChange={onChange} />
        </section>
        {children}
      </div>
      <aside className={styles.waitReadout} aria-labelledby={`${id}-preview`}>
        <h4 className={styles.editorTitle} id={`${id}-preview`}>
          Xem trước thời gian hiệu lực
        </h4>
        <p className={styles.waitSavedValue}>Đã lưu: {rule.tWaitSeconds} giây</p>
        <div aria-live="polite">
          <div className={styles.waitPreview}>
            <div>
              <span>{isShortened ? 'Cảnh báo đủ tin cậy' : 'Sự kiện đủ điều kiện cảnh báo'}</span>
              <strong>{isValid ? `${seconds} giây` : '—'}</strong>
            </div>
            {isShortened && (
              <div>
                <span>Cảnh báo có độ tin cậy cao</span>
                <strong>{effectiveWait !== null ? `${effectiveWait} giây` : '—'}</strong>
              </div>
            )}
          </div>
          <span className={styles.fieldHint}>
            {isShortened
              ? 'Nhánh tin cậy cao dùng đúng số giây bạn nhập sau khi lưu. Chọn nhanh T_wait không tự sửa nhánh này.'
              : 'Rule này dùng T_wait trực tiếp, không chia đôi theo độ tin cậy.'}
          </span>
        </div>
        <p id={`${id}-basis`} className={styles.waitNotice}>
          <strong>Deadline = lúc phát hiện + thời gian hiệu lực.</strong> Xử lý AI và gửi Telegram
          cũng nằm trong khoảng này. Đây không phải thời gian cộng thêm từ lúc nhận tin.
        </p>
        {hasUnsavedChanges && (
          <p className={styles.waitDraftNotice}>
            Chưa áp dụng — bấm “Lưu thay đổi”. Deadline của sự kiện đang chờ không được gia hạn.
          </p>
        )}
      </aside>
    </div>
  );
}
