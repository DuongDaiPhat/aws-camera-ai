import type { FireAttentionReceipt } from './fire-alerts';

const PREFIX = 'camerai.fire-attention.v2.';
const fallback = new Map<string, FireAttentionReceipt[]>();
const STORAGE_WARNING = 'Không lưu được trạng thái đã hiển thị cảnh báo trên trình duyệt.';

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function receipt(value: unknown): value is FireAttentionReceipt {
  if (!object(value)) return false;
  return (
    typeof value.cameraId === 'string' &&
    Array.isArray(value.eventIds) &&
    value.eventIds.every((id: unknown) => typeof id === 'string') &&
    finite(value.firstDetectedAt) &&
    finite(value.lastDetectedAt) &&
    finite(value.shownAt)
  );
}

export function fireAttentionStorageKey(userId: string): string {
  return `${PREFIX}${userId}`;
}

export function readFireReceipts(userId: string) {
  try {
    const raw = localStorage.getItem(fireAttentionStorageKey(userId));
    const value: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(value) || !value.every(receipt)) throw new Error('Invalid fire receipts');
    fallback.set(userId, value);
    return { receipts: value, warning: null };
  } catch {
    return { receipts: fallback.get(userId) ?? [], warning: STORAGE_WARNING };
  }
}

export function saveFireReceipts(userId: string, receipts: FireAttentionReceipt[]): string | null {
  fallback.set(userId, receipts);
  try {
    const key = fireAttentionStorageKey(userId);
    const json = JSON.stringify(receipts);
    if (localStorage.getItem(key) !== json) localStorage.setItem(key, json);
    return null;
  } catch {
    return STORAGE_WARNING;
  }
}

/** Serialize claims between tabs when the browser supports Web Locks. */
export async function claimFireAttention(userId: string, claim: () => void): Promise<void> {
  if (navigator.locks) await navigator.locks.request(fireAttentionStorageKey(userId), claim);
  else claim();
}
