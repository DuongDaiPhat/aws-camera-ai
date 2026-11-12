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
      <details className={styles.policyGuideBox}>
        <summary className={styles.policyGuideTitle}>Hệ thống xử lý cảnh báo như thế nào?</summary>
        <ul className={styles.policyGuideList}>
          <li>
            <strong>Chưa đủ tin cậy:</strong> Hệ thống chỉ ghi nhận nội bộ, không gửi thông báo
            Telegram.
          </li>
          <li>
            <strong>Đủ tin cậy:</strong> Gửi thông báo Telegram để người giám sát xác nhận trong
            thời gian đã cấu hình.
          </li>
          <li>
            <strong>Độ tin cậy cao:</strong> Có thể dùng thời gian chờ ngắn hơn tại ô “Nhánh khẩn
            cấp”. Quy tắc bỏ qua ngưỡng và kiểm tra sức khỏe dùng thời gian chờ cơ sở trực tiếp.
          </li>
          <li>
            <strong>Thay đổi cấu hình:</strong> Chỉ áp dụng cho lần đánh giá mới sau khi lưu thành
            công, không kéo dài thời hạn của sự kiện đang chờ.
          </li>
          <li>
            <strong>Mốc tính giờ:</strong> Tính từ lúc camera phát hiện. Hết hạn chưa xác nhận sẽ
            chuyển sang khẩn cấp; điều này chưa đồng nghĩa đã gọi điện hoặc gửi thêm tin Telegram.
          </li>
        </ul>
      </details>

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
