import { BadRequestException } from '@nestjs/common';
import { ZoneScheduleService } from '../src/zones/zone-schedule.service';

describe('ZoneScheduleService', () => {
  const service = new ZoneScheduleService();

  it('ap dung bien [06:00, 22:00) theo timezone camera', () => {
    const schedule = { activeFrom: '06:00', activeTo: '22:00' };
    expect(service.isActive(schedule, new Date('2026-01-01T23:00:00Z'), 'Asia/Bangkok')).toBe(true);
    expect(service.isActive(schedule, new Date('2026-01-01T15:00:00Z'), 'Asia/Bangkok')).toBe(
      false,
    );
  });

  it('ho tro lich qua nua dem', () => {
    const schedule = { activeFrom: '22:00', activeTo: '06:00' };
    expect(service.isActive(schedule, new Date('2026-01-01T16:00:00Z'), 'Asia/Bangkok')).toBe(true);
    expect(service.isActive(schedule, new Date('2026-01-01T05:00:00Z'), 'Asia/Bangkok')).toBe(
      false,
    );
  });

  it('tu choi lich thieu mot dau hoac hai dau trung nhau', () => {
    expect(() => service.validate({ activeFrom: '06:00', activeTo: null })).toThrow(
      BadRequestException,
    );
    expect(() => service.validate({ activeFrom: '06:00', activeTo: '06:00' })).toThrow(
      BadRequestException,
    );
  });
});
