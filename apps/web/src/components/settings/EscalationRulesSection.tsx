'use client';

import React from 'react';
import { useEscalationRules, toRuleDraft } from '@/hooks/useEscalationRules';
import { EscalationRuleCard } from './EscalationRuleCard';
import styles from './settings-view.module.css';

interface EscalationRulesSectionProps {
  isAdmin: boolean;
}

export function EscalationRulesSection({ isAdmin }: EscalationRulesSectionProps) {
  const {
    rules,
    drafts,
    isLoading,
    error,
    reload,
    updateDraft,
    cancelDraft,
    isDirty,
    saveRule,
    savingMap,
    errorMap,
    successMap,
  } = useEscalationRules();

  if (isLoading) {
    return (
      <div className={styles.loadingWrapper} role="status">
        <span className={styles.spinner} aria-hidden="true" />
        <span>Đang tải cấu hình quy tắc cảnh báo…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={styles.policyGuideBox}
        style={{ borderColor: '#fca5a5', backgroundColor: '#fef2f2' }}
      >
        <span className={styles.policyGuideTitle} style={{ color: '#b91c1c' }}>
          Không thể tải dữ liệu cấu hình
        </span>
        <p style={{ margin: 0, color: '#7f1d1d' }}>{error}</p>
        <button
          type="button"
          onClick={reload}
          className={styles.btnSave}
          style={{ width: 'fit-content', marginTop: 8 }}
        >
          Thử lại
        </button>
      </div>
    );
  }

  return (
    <div className={styles.settingsContainer}>
      {/* Policy guide */}
      <div className={styles.policyGuideBox}>
        <div className={styles.policyGuideTitle}>
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
          <span>Quy tắc vận hành ngưỡng tin cậy &amp; leo thang (Policy)</span>
        </div>
        <ul className={styles.policyGuideList}>
          <li>
            <strong>Dưới ngưỡng thấp (&lt; T_low):</strong> Độ tin cậy AI chưa đủ cao, hệ thống chỉ
            ghi log nội bộ (LOGGED_ONLY) và không gửi thông báo làm phiền người thân.
          </li>
          <li>
            <strong>Trong khoảng ngưỡng (T_low &le; Confidence &lt; T_high):</strong> Kích hoạt
            thông báo (NOTIFIED) tới Telegram với thời gian chờ <code>T_wait</code>.
          </li>
          <li>
            <strong>Độ tin cậy cao (&ge; T_high):</strong> Kích hoạt thông báo với thời gian chờ rút
            nhập tay ở ô “Nhánh khẩn cấp”, nhỏ hơn T_wait. Rule bỏ qua ngưỡng và sự kiện an sinh
            dùng T_wait trực tiếp.
          </li>
          <li>
            <strong>Điều chỉnh để test:</strong> Chọn nhanh hoặc nhập T_wait trong từng thẻ rồi bấm
            “Lưu thay đổi”. Thay đổi áp dụng cho lần đánh giá mới sau khi lưu thành công, không gia
            hạn deadline của sự kiện đang chờ.
          </li>
          <li>
            <strong>Mốc tính giờ:</strong> Từ lúc camera phát hiện, không phải lúc Telegram nhận
            tin. Hết hạn mà chưa xác nhận sẽ leo thang khẩn cấp; chưa đồng nghĩa gọi điện thật hoặc
            gửi thêm tin Telegram.
          </li>
        </ul>
      </div>

      {!isAdmin && (
        <div
          className={styles.feedbackMessage}
          style={{ backgroundColor: '#fffbeb', borderColor: '#fde68a', color: '#b45309' }}
        >
          Bạn đang xem ở chế độ chỉ đọc. Chỉ người dùng có vai trò Quản trị viên (ADMIN) mới có
          quyền thay đổi các ngưỡng cảnh báo này.
        </div>
      )}

      {/* Rules list */}
      <div className={styles.rulesList}>
        {rules.map((rule) => {
          const draft = drafts[rule.eventType] ?? toRuleDraft(rule);

          return (
            <EscalationRuleCard
              key={rule.eventType}
              rule={rule}
              draft={draft}
              isDirty={isDirty(rule.eventType)}
              isSaving={Boolean(savingMap[rule.eventType])}
              errorMessage={errorMap[rule.eventType] ?? null}
              successMessage={successMap[rule.eventType] ?? null}
              isAdmin={isAdmin}
              onUpdateDraft={updateDraft}
              onCancelDraft={cancelDraft}
              onSaveRule={saveRule}
              onReload={reload}
            />
          );
        })}
      </div>
    </div>
  );
}
