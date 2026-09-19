import { describe, expect, it } from 'vitest';
import { getAuthRedirect } from './middleware';

describe('getAuthRedirect', () => {
  it('đưa khách chưa đăng nhập về login khi mở dashboard', () => {
    expect(getAuthRedirect('/', false)).toBe('/login');
    expect(getAuthRedirect('/events/123', false)).toBe('/login');
  });

  it('cho khách chưa đăng nhập ở lại trang login', () => {
    expect(getAuthRedirect('/login', false)).toBeNull();
  });

  it('đưa người đã đăng nhập rời trang login tới dashboard', () => {
    expect(getAuthRedirect('/login', true)).toBe('/');
  });
});
