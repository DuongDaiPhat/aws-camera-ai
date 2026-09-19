import type { EventType, PriorityLevel } from '@/types';

/**
 * Định dạng thời gian tương đối ("Vừa xong", "3 phút trước", "2 giờ trước").
 * Dùng `now` làm tham số tùy chọn để dễ dàng unit test.
 */
export function formatRelativeTime(timestamp: string | Date, now: Date = new Date()): string {
  const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
  const diffInSeconds = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 1000));

  if (diffInSeconds < 60) {
    return 'Vừa xong';
  }

  const diffInMinutes = Math.floor(diffInSeconds / 60);
  if (diffInMinutes < 60) {
    return `${diffInMinutes} phút trước`;
  }

  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) {
    return `${diffInHours} giờ trước`;
  }

  const diffInDays = Math.floor(diffInHours / 24);
  return `${diffInDays} ngày trước`;
}

/**
 * Định dạng thời gian tuyệt đối khi hover: HH:mm:ss DD/MM/YYYY.
 */
export function formatExactTime(timestamp: string | Date): string {
  const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
  const pad = (num: number) => String(num).padStart(2, '0');

  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());
  const day = pad(date.getDate());
  const month = pad(date.getMonth() + 1);
  const year = date.getFullYear();

  return `${hours}:${minutes}:${seconds} ${day}/${month}/${year}`;
}

export interface PriorityInfo {
  code: PriorityLevel;
  label: string;
  theme: 'danger' | 'warning' | 'info' | 'neutral';
}

/**
 * Lấy nhãn và màu theo mức ưu tiên theo quy ước NFR / CODING_CONVENTION (P0 đỏ, P1 cam, P2 vàng, P3 xám).
 */
export function getPriorityInfo(priority: PriorityLevel): PriorityInfo {
  switch (priority) {
    case 'P0':
      return { code: 'P0', label: 'Khẩn cấp P0', theme: 'danger' };
    case 'P1':
      return { code: 'P1', label: 'Ưu tiên cao P1', theme: 'warning' };
    case 'P2':
      return { code: 'P2', label: 'Bình thường P2', theme: 'info' };
    case 'P3':
    default:
      return { code: 'P3', label: 'Thông tin P3', theme: 'neutral' };
  }
}

/**
 * Chuyển đổi mã sự kiện thành nhãn tiếng Việt có dấu đầy đủ.
 */
export function getEventTypeLabel(eventType: EventType): string {
  switch (eventType) {
    case 'FIRE_SMOKE_DETECTED':
      return 'Phát hiện khói / lửa';
    case 'FALL_DETECTED':
      return 'Cảnh báo té ngã';
    case 'UNKNOWN_PERSON':
      return 'Phát hiện người lạ';
    case 'RESTRICTED_ZONE':
      return 'Xâm nhập khu vực cấm';
    case 'WELLNESS_TIMEOUT':
      return 'Bất động quá thời gian';
    case 'PERSON_DETECTED':
    default:
      return 'Phát hiện chuyển động người';
  }
}
