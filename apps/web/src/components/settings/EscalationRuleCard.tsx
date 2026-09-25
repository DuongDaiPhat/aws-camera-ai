'use client';

import React from 'react';
import type { EscalationRule } from '@/lib/escalation-rules-client';
import type { RuleDraft } from '@/hooks/useEscalationRules';
import styles from './settings-view.module.css';

interface EscalationRuleCardProps {
  rule: EscalationRule;
  draft: RuleDraft;
  isDirty: boolean;
  isSaving: boolean;
  errorMessage: string | null;
  successMessage: string | null;
  isAdmin: boolean;
  onUpdateDraft: (eventType: string, field: keyof RuleDraft, value: number | null) => void;
  onCancelDraft: (eventType: string) => void;
  onSaveRule: (eventType: string) => void;
  onReload: () => void;
}

export function EscalationRuleCard({
  rule,
  draft,
  isDirty,
  isSaving,
  errorMessage,
  successMessage,
  isAdmin,
  onUpdateDraft,
  onCancelDraft,
  onSaveRule,
  onReload,
}: EscalationRuleCardProps) {
  const isWellness = rule.eventType === 'WELLNESS_TIMEOUT';

  // Computed policy preview cho nhánh confidence cao (US-13, US-15)
  const computedHighWait = Math.max(1, Math.ceil((draft.tWaitSeconds || 1) / 2));

  // Kiểm tra tính hợp lệ cơ bản tại form
  const isThresholdInvalid =
    !isWellness &&
    (draft.tLow === null ||
      draft.tHigh === null ||
      draft.tLow < 0 ||
      draft.tLow > 1 ||
      draft.tHigh < 0 ||
      draft.tHigh > 1 ||
      draft.tLow > draft.tHigh);

  const isWaitInvalid =
    typeof draft.tWaitSeconds !== 'number' || draft.tWaitSeconds < 1 || draft.tWaitSeconds > 3600;

  const canSave = isAdmin && isDirty && !isThresholdInvalid && !isWaitInvalid && !isSaving;

  const priorityClass =
    rule.priority === 'P0'
      ? styles.priorityP0
      : rule.priority === 'P1'
        ? styles.priorityP1
        : rule.priority === 'P2'
          ? styles.priorityP2
          : styles.priorityP3;

  const formatDateTime = (dateStr?: string | null) => {
    if (!dateStr) return '—';
    try {
      return new Date(dateStr).toLocaleString('vi-VN', {
        hour: '2-digit',
        minute: '2-digit',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <article className={styles.ruleCard} aria-labelledby={`rule-title-${rule.eventType}`}>
      {/* Header */}
      <div className={styles.cardHeader}>
        <div className={styles.titleArea}>
          <h3 id={`rule-title-${rule.eventType}`} className={styles.ruleDisplayName}>
            {rule.displayName || rule.eventType}
          </h3>
          <span className={styles.eventTypeCode}>{rule.eventType}</span>
        </div>
        <div className={styles.badgesArea}>
          <span
            className={`${styles.priorityBadge} ${priorityClass}`}
            title={`Mức độ ưu tiên cảnh báo: ${rule.priority}`}
          >
            Ưu tiên {rule.priority}
          </span>
          <span className={styles.versionBadge} title="Phiên bản cấu hình hiện tại">
            v{rule.version ?? 1}
          </span>
        </div>
      </div>

      {/* Body */}
      <div className={styles.cardBody}>
        {isWellness ? (
          <div className={styles.notApplicableBox}>
            Sự kiện an sinh được kích hoạt theo lịch kiểm tra định kỳ (không sử dụng ngưỡng
            confidence).
          </div>
        ) : (
          <div className={styles.inputsGrid}>
            <div className={styles.fieldGroup}>
              <label htmlFor={`tLow-${rule.eventType}`} className={styles.fieldLabel}>
                <span>Ngưỡng tối thiểu (T_low)</span>
                {draft.tLow !== null && !Number.isNaN(draft.tLow) && (
                  <span style={{ color: '#2563eb', fontWeight: 600, fontSize: 12 }}>
                    (~{Math.round(draft.tLow * 100)}% chắc chắn)
                  </span>
                )}
              </label>
              <span className={styles.fieldHint}>
                Đơn vị từ 0.00 đến 1.00. Dưới mức này AI chỉ âm thầm ghi log, không nhắn tin làm
                phiền.
              </span>
              <div className={styles.inputWrapper}>
                <input
                  id={`tLow-${rule.eventType}`}
                  type="number"
                  step="0.01"
                  min="0"
                  max="1"
                  disabled={!isAdmin || isSaving}
                  className={styles.inputNumber}
                  value={draft.tLow !== null ? draft.tLow : ''}
                  onChange={(e) => {
                    const val = e.target.value === '' ? null : parseFloat(e.target.value);
                    onUpdateDraft(rule.eventType, 'tLow', val);
                  }}
                />
              </div>
            </div>

            <div className={styles.fieldGroup}>
              <label htmlFor={`tHigh-${rule.eventType}`} className={styles.fieldLabel}>
                <span>Ngưỡng tin cậy cao (T_high)</span>
                {draft.tHigh !== null && !Number.isNaN(draft.tHigh) && (
                  <span style={{ color: '#c2410c', fontWeight: 600, fontSize: 12 }}>
                    (~{Math.round(draft.tHigh * 100)}% chắc chắn)
                  </span>
                )}
              </label>
              <span className={styles.fieldHint}>
                Đơn vị từ 0.00 đến 1.00. Đạt mức này AI rất chắc chắn, kích hoạt hẹn giờ rút ngắn
                khẩn cấp.
              </span>
              <div className={styles.inputWrapper}>
                <input
                  id={`tHigh-${rule.eventType}`}
                  type="number"
                  step="0.01"
                  min="0"
                  max="1"
                  disabled={!isAdmin || isSaving}
                  className={styles.inputNumber}
                  value={draft.tHigh !== null ? draft.tHigh : ''}
                  onChange={(e) => {
                    const val = e.target.value === '' ? null : parseFloat(e.target.value);
                    onUpdateDraft(rule.eventType, 'tHigh', val);
                  }}
                />
              </div>
            </div>
          </div>
        )}

        <div className={styles.inputsGrid}>
          <div className={styles.fieldGroup}>
            <label htmlFor={`tWait-${rule.eventType}`} className={styles.fieldLabel}>
              <span>Thời gian chờ phản hồi (T_wait)</span>
              {draft.tWaitSeconds >= 60 && (
                <span style={{ color: '#64748b', fontWeight: 500, fontSize: 12 }}>
                  (~{(draft.tWaitSeconds / 60).toFixed(1).replace('.0', '')} phút)
                </span>
              )}
            </label>
            <span className={styles.fieldHint}>
              Đơn vị: <strong>giây</strong> (1–3600 giây). Hết thời gian này nếu chưa có ai phản hồi
              sẽ tự động gọi điện khẩn cấp.
            </span>
            <div className={styles.inputWrapper}>
              <input
                id={`tWait-${rule.eventType}`}
                type="number"
                step="1"
                min="1"
                max="3600"
                disabled={!isAdmin || isSaving}
                className={styles.inputNumber}
                value={draft.tWaitSeconds}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  onUpdateDraft(rule.eventType, 'tWaitSeconds', Number.isNaN(val) ? 0 : val);
                }}
              />
              <span className={styles.inputSuffix}>giây</span>
            </div>
          </div>

          <div className={styles.fieldGroup}>
            <span className={styles.fieldLabel}>Chờ ưu tiên tự động (computed)</span>
            <span className={styles.fieldHint}>
              Áp dụng khi confidence &gt;= T_high (tự tính: ceil(T_wait/2))
            </span>
            <div className={styles.computedWaitBox}>
              <span>Nhánh khẩn cấp:</span>
              <span className={styles.computedWaitValue}>{computedHighWait} giây</span>
            </div>
          </div>
        </div>

        {/* Validation warning inline */}
        {isThresholdInvalid && (
          <div className={`${styles.feedbackMessage} ${styles.feedbackError}`} role="alert">
            Ngưỡng thấp (T_low) phải nằm trong khoảng 0–1 và nhỏ hơn hoặc bằng ngưỡng cao (T_high).
          </div>
        )}
        {isWaitInvalid && (
          <div className={`${styles.feedbackMessage} ${styles.feedbackError}`} role="alert">
            Thời gian chờ phải là số nguyên từ 1 đến 3600 giây.
          </div>
        )}

        {/* Status messages */}
        {errorMessage && (
          <div className={`${styles.feedbackMessage} ${styles.feedbackError}`} role="alert">
            <span>{errorMessage}</span>
            {errorMessage.includes('tải lại') && (
              <button type="button" className={styles.btnReloadInline} onClick={onReload}>
                Tải lại ngay
              </button>
            )}
          </div>
        )}

        {successMessage && (
          <div className={`${styles.feedbackMessage} ${styles.feedbackSuccess}`} role="status">
            <span>{successMessage}</span>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className={styles.cardFooter}>
        <div className={styles.metaInfo}>
          <span>Cập nhật gần nhất: {formatDateTime(rule.updatedAt)}</span>
          {rule.updatedByName && <span>Người sửa: {rule.updatedByName}</span>}
        </div>

        {isAdmin && (
          <div className={styles.actionsArea}>
            <button
              type="button"
              className={styles.btnCancel}
              disabled={!isDirty || isSaving}
              onClick={() => onCancelDraft(rule.eventType)}
            >
              Hủy
            </button>
            <button
              type="button"
              className={styles.btnSave}
              disabled={!canSave}
              onClick={() => onSaveRule(rule.eventType)}
            >
              {isSaving ? (
                <>
                  <span className={styles.spinner} style={{ width: 14, height: 14 }} />
                  <span>Đang lưu…</span>
                </>
              ) : (
                'Lưu thay đổi'
              )}
            </button>
          </div>
        )}
      </div>
    </article>
  );
}
