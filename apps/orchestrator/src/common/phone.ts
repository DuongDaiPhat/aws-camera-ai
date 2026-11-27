export const ALERT_PHONE = /^\+[1-9][0-9]{7,14}$/;
export const LOCAL_VN_PHONE = /^0[1-9][0-9]{8,10}$/;
export const INVALID_PHONE_MESSAGE =
  'Nhập số điện thoại hợp lệ (ví dụ 0901234567 hoặc +84901234567).';

/** Normalizes a phone string: strips spaces and converts leading 0... (VN) to +84... E.164. */
export function normalizePhoneE164Input(
  value: unknown,
  emptyValue: undefined | null = undefined,
): unknown {
  if (typeof value !== 'string') return value;
  const compact = value.trim().replace(/\s+/g, '');
  if (!compact) return emptyValue;
  if (LOCAL_VN_PHONE.test(compact)) {
    return `+84${compact.slice(1)}`;
  }
  return compact;
}
