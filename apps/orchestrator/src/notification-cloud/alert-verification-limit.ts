import { HttpException } from '@nestjs/common';

export function nextVerificationRequestCount(
  previous: { requested_at: Date; requests_today: number } | undefined,
): number {
  if (!previous) return 1;
  const now = new Date();
  if (now.getTime() - previous.requested_at.getTime() < 60_000) {
    throw new HttpException('Vui lòng đợi một phút trước khi yêu cầu xác nhận lại.', 429);
  }
  if (now.toISOString().slice(0, 10) !== previous.requested_at.toISOString().slice(0, 10)) return 1;
  if (previous.requests_today >= 5) {
    throw new HttpException('Đã hết lượt xác minh trong ngày. Vui lòng thử lại ngày mai.', 429);
  }
  return previous.requests_today + 1;
}
