import { describe, expect, it } from 'vitest';
import { ApiError } from './api-client';

describe('ApiError', () => {
  it('giu lai status, code va traceId de hien thi cho nguoi dung', () => {
    const error = new ApiError(401, 'TOKEN_EXPIRED', 'Token het han', 'trace-123');

    expect(error).toBeInstanceOf(Error);
    expect(error.status).toBe(401);
    expect(error.code).toBe('TOKEN_EXPIRED');
    expect(error.traceId).toBe('trace-123');
  });
});
