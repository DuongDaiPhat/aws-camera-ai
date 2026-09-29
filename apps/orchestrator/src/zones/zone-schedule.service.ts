import { BadRequestException, Injectable } from '@nestjs/common';

export interface ZoneSchedule {
  activeFrom: string | null;
  activeTo: string | null;
}

const TIME_PATTERN = /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/;

function toMinuteOfDay(value: string): number {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

@Injectable()
export class ZoneScheduleService {
  validate(schedule: ZoneSchedule): void {
    const bothNull = schedule.activeFrom === null && schedule.activeTo === null;
    const bothSet = schedule.activeFrom !== null && schedule.activeTo !== null;
    if (!bothNull && !bothSet) {
      throw new BadRequestException({
        error: {
          code: 'INVALID_ZONE_SCHEDULE',
          message: 'Lịch phải có đủ giờ bắt đầu và kết thúc.',
        },
      });
    }
    if (bothSet) {
      const activeFrom = schedule.activeFrom;
      const activeTo = schedule.activeTo;
      if (activeFrom === null || activeTo === null) return;
      if (!TIME_PATTERN.test(activeFrom) || !TIME_PATTERN.test(activeTo)) {
        throw new BadRequestException({
          error: { code: 'INVALID_ZONE_SCHEDULE', message: 'Thời gian phải có định dạng HH:mm.' },
        });
      }
      if (activeFrom === activeTo) {
        throw new BadRequestException({
          error: {
            code: 'INVALID_ZONE_SCHEDULE',
            message: 'Giờ bắt đầu và kết thúc không được trùng nhau; hãy chọn Cả ngày.',
          },
        });
      }
    }
  }

  isActive(schedule: ZoneSchedule, observedAt: Date, timezone: string): boolean {
    if (schedule.activeFrom === null && schedule.activeTo === null) return true;
    if (schedule.activeFrom === null || schedule.activeTo === null) return false;

    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(observedAt);
    const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0);
    const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0);
    const current = hour * 60 + minute;
    const start = toMinuteOfDay(schedule.activeFrom);
    const end = toMinuteOfDay(schedule.activeTo);
    return start < end ? current >= start && current < end : current >= start || current < end;
  }
}
