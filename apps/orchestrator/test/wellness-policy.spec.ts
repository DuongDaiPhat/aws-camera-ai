import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { canonicalJson, wellnessInteger } from '../src/wellness/wellness-policy';
import {
  CreateWellnessScheduleDto,
  UpdateWellnessScheduleDto,
  WellnessObservationDto,
} from '../src/wellness/dto';
import { EventsService } from '../src/events/events.service';
import { EventsRepository } from '../src/events/events.repository';
import { MediaService } from '../src/media/media.service';
import { EscalationEngineService } from '../src/escalation/escalation-engine.service';
import type { TokenService, TokenClaims } from '../src/auth/auth.types';
import type { IStorageService } from '../src/storage/storage.interface';
import type { EventSummaryDto } from '../src/events/dto/event-summary-response.dto';
import { TelegramAdapter } from '../src/notifications/telegram/telegram.adapter';
import { WellnessSchedulerService } from '../src/wellness/wellness-scheduler.service';
import { WellnessRepository } from '../src/wellness/wellness.repository';

describe('US20 policy regression', () => {
  it('flag off drains existing deadlines without materializing, reclaiming or claiming new work', async () => {
    const repository = {
      processWellnessTimeouts: jest.fn(),
      materializeOccurrences: jest.fn(),
      reclaimExpiredLeases: jest.fn(),
      claimPendingRuns: jest.fn(),
    };
    const scheduler = new WellnessSchedulerService(
      repository as unknown as WellnessRepository,
      new ConfigService({ M5_ENABLED: 'false' }),
    );
    await scheduler.tick();
    expect(repository.processWellnessTimeouts).toHaveBeenCalledWith(50);
    expect(repository.materializeOccurrences).not.toHaveBeenCalled();
    expect(repository.reclaimExpiredLeases).not.toHaveBeenCalled();
    expect(repository.claimPendingRuns).not.toHaveBeenCalled();
  });
  it('canonicalizes nested object keys but preserves meaningful array order', () => {
    expect(canonicalJson({ b: { y: 2, x: 1 }, a: [1, 2] })).toBe(
      canonicalJson({ a: [1, 2], b: { x: 1, y: 2 } }),
    );
    expect(canonicalJson({ a: [1, 2] })).not.toBe(canonicalJson({ a: [2, 1] }));
  });
  it.each(['0', '-1', '1.5', 'Infinity', 'text', '86401'])(
    'rejects invalid runtime limit %s',
    (value) => {
      expect(() => wellnessInteger(new ConfigService({ SETTING: value }), 'SETTING', 30)).toThrow();
    },
  );
  it.each([
    { lookbackHours: 0 },
    { lookbackHours: 25 },
    { graceSeconds: 59 },
    { graceSeconds: 3601 },
    { daysOfWeek: [] },
    { daysOfWeek: [1, 1] },
    { daysOfWeek: [0, 8] },
    { cameraIds: ['not-uuid'] },
    { checkAt: '25:00' },
  ])('rejects schedule contract violation %j', async (input) => {
    expect(
      await validate(
        plainToInstance(CreateWellnessScheduleDto, {
          residentUserId: '22222222-2222-4222-8222-222222222222',
          checkAt: '09:00',
          ...input,
        }),
      ),
    ).not.toHaveLength(0);
  });
  it('requires provenance on internal observations; partial updates keep validation', async () => {
    expect(
      (
        await validate(
          plainToInstance(WellnessObservationDto, {
            observationId: '33333333-3333-4333-8333-333333333333',
            ownerUserId: '11111111-1111-4111-8111-111111111111',
            residentUserId: '22222222-2222-4222-8222-222222222222',
            sourceSessionId: 'qa',
            trackId: 'qa',
            kind: 'MOTION',
            observedAt: '2026-10-18T00:00:00Z',
          }),
        )
      ).map((e) => e.property),
    ).toEqual(expect.arrayContaining(['cameraId', 'identityEventId', 'knownFaceId']));
    expect(
      await validate(plainToInstance(UpdateWellnessScheduleDto, { daysOfWeek: [] })),
    ).not.toHaveLength(0);
  });
  it('M5 SSE reaches only owner/resident/admin; generic events retain their previous stream', () => {
    const tokens = {
      verifyAccessToken: (token: string) =>
        ({ sub: token, role: token === 'admin' ? 'ADMIN' : 'VIEWER' }) as TokenClaims,
    } as TokenService;
    const events = new EventsService(
      {} as EventsRepository,
      {} as MediaService,
      {} as EscalationEngineService,
      {} as IStorageService,
      tokens,
    );
    const received: Record<string, string[]> = { owner: [], resident: [], other: [], admin: [] };
    const subscriptions = Object.keys(received).map((id) =>
      events.streamEvents(id).subscribe((message) => received[id].push(String(message.data))),
    );
    events.emitEvent(
      { id: 'wellness', eventType: 'WELLNESS_TIMEOUT' } as EventSummaryDto,
      'event.updated',
      ['owner', 'resident'],
    );
    expect(received.other).toHaveLength(0);
    expect(received.owner).toHaveLength(1);
    expect(received.resident).toHaveLength(1);
    expect(received.admin).toHaveLength(1);
    events.emitEvent({ id: 'generic', eventType: 'PERSON_DETECTED' } as EventSummaryDto);
    expect(received.other).toHaveLength(1);
    subscriptions.forEach((s) => s.unsubscribe());
  });
  it('never sends a Telegram token to a configurable remote endpoint', () => {
    expect(
      () =>
        new TelegramAdapter(new ConfigService({ TELEGRAM_API_BASE_URL: 'https://example.org' })),
    ).toThrow();
    expect(
      () =>
        new TelegramAdapter(new ConfigService({ TELEGRAM_API_BASE_URL: 'http://127.0.0.1:55435' })),
    ).not.toThrow();
  });
});
