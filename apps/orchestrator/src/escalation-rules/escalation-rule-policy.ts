import { EventType, PriorityLevel } from '@cam/contracts';

/**
 * Danh sách 5 loại sự kiện được quản lý cấu hình ngưỡng và thời gian chờ (US-15).
 * PERSON_DETECTED là rule nội bộ P3, không hiển thị chỉnh sửa trên form cài đặt.
 */
export const MANAGED_ALERT_EVENT_TYPES: readonly EventType[] = [
  'FIRE_SMOKE_DETECTED',
  'FALL_DETECTED',
  'RESTRICTED_ZONE',
  'UNKNOWN_PERSON',
  'WELLNESS_TIMEOUT',
] as const;

export const ALL_ESCALATION_EVENT_TYPES: readonly EventType[] = [
  ...MANAGED_ALERT_EVENT_TYPES,
  'PERSON_DETECTED',
] as const;

export const EVENT_TYPE_DISPLAY_NAMES: Record<EventType, string> = {
  FIRE_SMOKE_DETECTED: 'Phát hiện cháy / khói',
  FALL_DETECTED: 'Phát hiện té ngã',
  RESTRICTED_ZONE: 'Xâm nhập vùng cấm',
  UNKNOWN_PERSON: 'Người lạ mặt',
  WELLNESS_TIMEOUT: 'Quá hạn an sinh',
  PERSON_DETECTED: 'Phát hiện người (nội bộ)',
};

export const PRIORITY_ORDER: Record<PriorityLevel, number> = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
};

/**
 * Thời gian chờ rút ngắn cho nhánh confidence cao (>= T_high).
 * Công thức policy thống nhất với US-13: max(1, ceil(T_wait / 2)).
 */
export function computeEffectiveHighWaitSeconds(tWaitSeconds: number): number {
  return Math.max(1, Math.ceil(tWaitSeconds / 2));
}

export interface ThresholdValidationInput {
  eventType: string;
  tLow: number | null;
  tHigh: number | null;
  tWaitSeconds: number;
}

export type ValidationErrorType =
  | 'RULE_NOT_FOUND'
  | 'THRESHOLD_NOT_APPLICABLE'
  | 'THRESHOLD_REQUIRED'
  | 'INVALID_THRESHOLD'
  | 'INVALID_WAIT_SECONDS';

export interface ValidationResult {
  isValid: boolean;
  errorCode?: ValidationErrorType;
  message?: string;
}

function validateEventType(eventType: string): ValidationResult | null {
  if (!MANAGED_ALERT_EVENT_TYPES.includes(eventType as EventType)) {
    return {
      isValid: false,
      errorCode: 'RULE_NOT_FOUND',
      message: 'Không tìm thấy cấu hình cho loại sự kiện.',
    };
  }
  return null;
}

function validateWaitSeconds(tWaitSeconds: number): ValidationResult | null {
  if (
    typeof tWaitSeconds !== 'number' ||
    !Number.isInteger(tWaitSeconds) ||
    tWaitSeconds < 1 ||
    tWaitSeconds > 3600
  ) {
    return {
      isValid: false,
      errorCode: 'INVALID_WAIT_SECONDS',
      message: 'Thời gian chờ phải từ 1 đến 3600 giây.',
    };
  }
  return null;
}

function validateWellnessThresholds(
  tLow: number | null,
  tHigh: number | null,
): ValidationResult | null {
  if (tLow !== null || tHigh !== null) {
    return {
      isValid: false,
      errorCode: 'THRESHOLD_NOT_APPLICABLE',
      message: 'Loại sự kiện này không sử dụng confidence.',
    };
  }
  return null;
}

function validateAlertThresholds(
  tLow: number | null,
  tHigh: number | null,
): ValidationResult | null {
  if (tLow === null || tHigh === null || typeof tLow !== 'number' || typeof tHigh !== 'number') {
    return {
      isValid: false,
      errorCode: 'THRESHOLD_REQUIRED',
      message: 'Vui lòng nhập đủ hai ngưỡng.',
    };
  }

  const isInvalid =
    Number.isNaN(tLow) ||
    Number.isNaN(tHigh) ||
    !Number.isFinite(tLow) ||
    !Number.isFinite(tHigh) ||
    tLow < 0 ||
    tLow > 1 ||
    tHigh < 0 ||
    tHigh > 1;

  if (isInvalid) {
    return {
      isValid: false,
      errorCode: 'INVALID_THRESHOLD',
      message: 'Ngưỡng thấp và ngưỡng cao phải là số hữu hạn trong khoảng từ 0 đến 1.',
    };
  }

  if (tLow > tHigh) {
    return {
      isValid: false,
      errorCode: 'INVALID_THRESHOLD',
      message: 'Ngưỡng thấp phải nhỏ hơn hoặc bằng ngưỡng cao.',
    };
  }

  return null;
}

/**
 * Kiểm tra tính hợp lệ của ngưỡng và thời gian chờ theo đúng ma trận validation US-15.
 */
export function validateThresholdUpdate(input: ThresholdValidationInput): ValidationResult {
  const { eventType, tLow, tHigh, tWaitSeconds } = input;

  const eventErr = validateEventType(eventType);
  if (eventErr) return eventErr;

  const waitErr = validateWaitSeconds(tWaitSeconds);
  if (waitErr) return waitErr;

  if (eventType === 'WELLNESS_TIMEOUT') {
    const wellnessErr = validateWellnessThresholds(tLow, tHigh);
    if (wellnessErr) return wellnessErr;
    return { isValid: true };
  }

  const alertErr = validateAlertThresholds(tLow, tHigh);
  if (alertErr) return alertErr;

  return { isValid: true };
}
