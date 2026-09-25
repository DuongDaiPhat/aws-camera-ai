'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  fetchEscalationRules,
  updateEscalationThresholds,
  type EscalationRule,
} from '@/lib/escalation-rules-client';
import { ApiError } from '@/lib/api-client';

export interface RuleDraft {
  tLow: number | null;
  tHigh: number | null;
  tWaitSeconds: number;
}

export function useEscalationRules() {
  const [rules, setRules] = useState<EscalationRule[]>([]);
  const [drafts, setDrafts] = useState<Record<string, RuleDraft>>({});
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [savingMap, setSavingMap] = useState<Record<string, boolean>>({});
  const [errorMap, setErrorMap] = useState<Record<string, string | null>>({});
  const [successMap, setSuccessMap] = useState<Record<string, string | null>>({});

  const loadRules = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchEscalationRules();
      // Loại bỏ rule nội bộ PERSON_DETECTED nếu có
      const filtered = data.filter((r) => r.eventType !== 'PERSON_DETECTED');
      setRules(filtered);

      const initialDrafts: Record<string, RuleDraft> = {};
      for (const rule of filtered) {
        initialDrafts[rule.eventType] = {
          tLow: rule.tLow ?? null,
          tHigh: rule.tHigh ?? null,
          tWaitSeconds: rule.tWaitSeconds,
        };
      }
      setDrafts(initialDrafts);
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setError(err.message || 'Không thể tải cấu hình quy tắc cảnh báo.');
      } else {
        setError('Lỗi kết nối khi tải cấu hình.');
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRules();
  }, [loadRules]);

  const updateDraft = useCallback(
    (eventType: string, field: keyof RuleDraft, value: number | null) => {
      setDrafts((prev) => ({
        ...prev,
        [eventType]: {
          ...(prev[eventType] ?? { tLow: null, tHigh: null, tWaitSeconds: 30 }),
          [field]: value,
        },
      }));

      // Xóa lỗi hoặc thông báo thành công cũ khi người dùng bắt đầu chỉnh sửa lại
      setErrorMap((prev) => ({ ...prev, [eventType]: null }));
      setSuccessMap((prev) => ({ ...prev, [eventType]: null }));
    },
    [],
  );

  const cancelDraft = useCallback(
    (eventType: string) => {
      const canonical = rules.find((r) => r.eventType === eventType);
      if (!canonical) return;

      setDrafts((prev) => ({
        ...prev,
        [eventType]: {
          tLow: canonical.tLow ?? null,
          tHigh: canonical.tHigh ?? null,
          tWaitSeconds: canonical.tWaitSeconds,
        },
      }));
      setErrorMap((prev) => ({ ...prev, [eventType]: null }));
      setSuccessMap((prev) => ({ ...prev, [eventType]: null }));
    },
    [rules],
  );

  const isDirty = useCallback(
    (eventType: string): boolean => {
      const canonical = rules.find((r) => r.eventType === eventType);
      const draft = drafts[eventType];
      if (!canonical || !draft) return false;

      return (
        canonical.tLow !== draft.tLow ||
        canonical.tHigh !== draft.tHigh ||
        canonical.tWaitSeconds !== draft.tWaitSeconds
      );
    },
    [rules, drafts],
  );

  const saveRule = useCallback(
    async (eventType: string) => {
      const canonical = rules.find((r) => r.eventType === eventType);
      const draft = drafts[eventType];
      if (!canonical || !draft) return;

      setSavingMap((prev) => ({ ...prev, [eventType]: true }));
      setErrorMap((prev) => ({ ...prev, [eventType]: null }));
      setSuccessMap((prev) => ({ ...prev, [eventType]: null }));

      try {
        const updated = await updateEscalationThresholds(eventType, {
          tLow: draft.tLow,
          tHigh: draft.tHigh,
          tWaitSeconds: draft.tWaitSeconds,
          expectedVersion: canonical.version ?? 1,
        });

        setRules((prev) => prev.map((r) => (r.eventType === eventType ? updated : r)));

        setDrafts((prev) => ({
          ...prev,
          [eventType]: {
            tLow: updated.tLow ?? null,
            tHigh: updated.tHigh ?? null,
            tWaitSeconds: updated.tWaitSeconds,
          },
        }));

        setSuccessMap((prev) => ({
          ...prev,
          [eventType]: `Đã lưu thành công phiên bản v${updated.version}.`,
        }));
      } catch (err: unknown) {
        if (err instanceof ApiError) {
          if (err.status === 409) {
            setErrorMap((prev) => ({
              ...prev,
              [eventType]: 'Cấu hình đã thay đổi bởi người khác. Hãy bấm tải lại trước khi lưu.',
            }));
          } else {
            setErrorMap((prev) => ({
              ...prev,
              [eventType]: err.message || 'Lưu cấu hình thất bại.',
            }));
          }
        } else {
          setErrorMap((prev) => ({
            ...prev,
            [eventType]: 'Lỗi kết nối máy chủ khi lưu.',
          }));
        }
      } finally {
        setSavingMap((prev) => ({ ...prev, [eventType]: false }));
      }
    },
    [rules, drafts],
  );

  return {
    rules,
    drafts,
    isLoading,
    error,
    reload: loadRules,
    updateDraft,
    cancelDraft,
    isDirty,
    saveRule,
    savingMap,
    errorMap,
    successMap,
  };
}
