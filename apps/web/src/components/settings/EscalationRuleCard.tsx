'use client';

import React from 'react';
import { ChevronDown } from 'lucide-react';
import type { EscalationRule } from '@/lib/escalation-rules-client';
import type { RuleDraft } from '@/hooks/useEscalationRules';
import {
  isValidWaitSeconds,
  isValidHighWaitSeconds,
  usesShortenedWait,
} from '@/lib/escalation-wait-settings';
import { EscalationWaitControl } from './EscalationWaitControl';
import styles from './settings-view.module.css';

interface EscalationRuleCardProps {
  rule: EscalationRule;
  compact?: boolean;
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
  compact = false,
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
  const Container = compact ? 'details' : 'article';
  const Header = compact ? 'summary' : 'div';
  const isWellness = rule.eventType === 'WELLNESS_TIMEOUT';

  // Kiểm tra tính hợp lệ cơ bản tại form
  const isThresholdInvalid =
    !isWellness &&
    (draft.tLow === null ||
      draft.tHigh === null ||
      !Number.isFinite(draft.tLow) ||
      !Number.isFinite(draft.tHigh) ||
      draft.tLow < 0 ||
      draft.tLow > 1 ||
      draft.tHigh < 0 ||
      draft.tHigh > 1 ||
      draft.tLow > draft.tHigh);

  const isWaitInvalid = !isValidWaitSeconds(draft.tWaitSeconds);

  const isHighWaitInvalid =
    usesShortenedWait(rule) && !isValidHighWaitSeconds(draft.highWaitSeconds, draft.tWaitSeconds);
  const canSave =
    isAdmin && isDirty && !isThresholdInvalid && !isWaitInvalid && !isHighWaitInvalid && !isSaving;

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
    <Container
      className={`${styles.ruleCard} ${compact ? styles.compactRule : ''}`}
      aria-labelledby={`rule-title-${rule.eventType}`}
    >
      {/* Header */}
      <Header className={styles.cardHeader}>
        <div className={styles.titleArea}>
          <h3 id={`rule-title-${rule.eventType}`} className={styles.ruleDisplayName}>
            {rule.displayName || rule.eventType}
          </h3>
          {!compact && <span className={styles.eventTypeCode}>{rule.eventType}</span>}
        </div>
        <div className={styles.badgesArea}>
          {compact && <span className={styles.ruleSummaryWait}>Chờ {rule.tWaitSeconds} giây</span>}
          {compact && (errorMessage || isDirty || isSaving) && (
            <span className={styles.ruleDraftStatus}>
              {errorMessage ? 'Lỗi lưu' : isSaving ? 'Đang lưu…' : 'Chưa lưu'}
            </span>
          )}
          <span
            className={`${styles.priorityBadge} ${priorityClass}`}
            title={`Mức độ ưu tiên cảnh báo: ${rule.priority}`}
          >
            Ưu tiên {rule.priority}
          </span>
          {!compact && (
            <span className={styles.versionBadge} title="Phiên bản cấu hình hiện tại">
              v{rule.version ?? 1}
            </span>
          )}
          {compact && <ChevronDown className={styles.ruleChevron} size={16} aria-hidden="true" />}
        </div>
      </Header>

      {/* Body */}
      <div className={styles.cardBody}>
        <EscalationWaitControl
          rule={{ ...rule, highWaitSeconds: draft.highWaitSeconds }}
          seconds={draft.tWaitSeconds}
          hasUnsavedChanges={isDirty}
          disabled={!isAdmin || isSaving}
          onChange={(seconds) => onUpdateDraft(rule.eventType, 'tWaitSeconds', seconds)}
          onHighWaitChange={(seconds) => onUpdateDraft(rule.eventType, 'highWaitSeconds', seconds)}
        >
          {isWellness ? (
            <div className={styles.notApplicableBox}>
              Sự kiện an sinh được kích hoạt theo lịch kiểm tra định kỳ (không sử dụng ngưỡng
              confidence).
            </div>
          ) : (
            <section
              className={styles.thresholdSection}
              aria-labelledby={`threshold-title-${rule.eventType}`}
            >
              <h4 id={`threshold-title-${rule.eventType}`} className={styles.editorTitle}>
                Ngưỡng tin cậy
              </h4>
              <div className={styles.inputsGrid}>
                <div className={styles.fieldGroup}>
                  <label htmlFor={`tLow-${rule.eventType}`} className={styles.fieldLabel}>
                    <span>Ngưỡng tối thiểu (T_low)</span>
                  </label>

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
                  <span className={styles.fieldHint}>
                    Dưới ngưỡng này, hệ thống chỉ ghi nhận sự kiện.
                  </span>
                </div>

                <div className={styles.fieldGroup}>
                  <label htmlFor={`tHigh-${rule.eventType}`} className={styles.fieldLabel}>
                    <span>Ngưỡng tin cậy cao (T_high)</span>
                  </label>

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
                  <span className={styles.fieldHint}>
                    Từ ngưỡng này, hệ thống có thể áp dụng thời gian chờ khẩn cấp.
                  </span>
                </div>
              </div>
            </section>
          )}
        </EscalationWaitControl>

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
    </Container>
  );
}
