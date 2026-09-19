import { describe, it, expect } from 'vitest';
import { formatRelativeTime, formatExactTime, getPriorityInfo, getEventTypeLabel } from './format';

describe('formatRelativeTime', () => {
  const baseTime = new Date('2026-09-19T12:00:00Z');

  it('tra ve "Vừa xong" khi chenh lech duoi 60 giay', () => {
    const recent = new Date(baseTime.getTime() - 30 * 1000);
    expect(formatRelativeTime(recent, baseTime)).toBe('Vừa xong');
  });

  it('tra ve "X phut truoc" khi chenh lech duoi 60 phut', () => {
    const minsAgo = new Date(baseTime.getTime() - 5 * 60 * 1000);
    expect(formatRelativeTime(minsAgo, baseTime)).toBe('5 phút trước');
  });

  it('tra ve "X gio truoc" khi chenh lech duoi 24 gio', () => {
    const hoursAgo = new Date(baseTime.getTime() - 3 * 3600 * 1000);
    expect(formatRelativeTime(hoursAgo, baseTime)).toBe('3 giờ trước');
  });

  it('tra ve "X ngay truoc" khi chenh lech tu 1 ngay tro len', () => {
    const daysAgo = new Date(baseTime.getTime() - 2 * 24 * 3600 * 1000);
    expect(formatRelativeTime(daysAgo, baseTime)).toBe('2 ngày trước');
  });
});

describe('formatExactTime', () => {
  it('dinh dang dung cau truc gio phut giay ngay thang nam', () => {
    const d = new Date(2026, 8, 19, 14, 5, 9); // Month 8 is September
    expect(formatExactTime(d)).toBe('14:05:09 19/09/2026');
  });
});

describe('getPriorityInfo', () => {
  it('tra ve dung thong tin theo muc do P0, P1, P2, P3', () => {
    expect(getPriorityInfo('P0')).toEqual({ code: 'P0', label: 'Khẩn cấp P0', theme: 'danger' });
    expect(getPriorityInfo('P1')).toEqual({
      code: 'P1',
      label: 'Ưu tiên cao P1',
      theme: 'warning',
    });
    expect(getPriorityInfo('P2')).toEqual({ code: 'P2', label: 'Bình thường P2', theme: 'info' });
    expect(getPriorityInfo('P3')).toEqual({ code: 'P3', label: 'Thông tin P3', theme: 'neutral' });
  });
});

describe('getEventTypeLabel', () => {
  it('chuyen doi eventType sang tieng Viet chinh xac', () => {
    expect(getEventTypeLabel('FIRE_SMOKE_DETECTED')).toBe('Phát hiện khói / lửa');
    expect(getEventTypeLabel('FALL_DETECTED')).toBe('Cảnh báo té ngã');
    expect(getEventTypeLabel('UNKNOWN_PERSON')).toBe('Phát hiện người lạ');
  });
});
