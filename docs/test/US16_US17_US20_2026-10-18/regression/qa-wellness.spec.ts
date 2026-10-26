import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { WellnessSchedulerService } from '../src/wellness/wellness-scheduler.service';
import { WellnessService } from '../src/wellness/wellness.service';
import { WellnessRepository } from '../src/wellness/wellness.repository';
import type { TokenClaims } from '../src/auth/auth.types';

const ownerId = '11111111-1111-4111-8111-111111111111';
const residentId = '22222222-2222-4222-8222-222222222222';
const resident = { sub: residentId, role: 'VIEWER' } as TokenClaims;
const schedule = {
  id: '33333333-3333-4333-8333-333333333333',
  owner_user_id: ownerId,
  resident_user_id: residentId,
  name: 'QA',
  check_at: '09:00',
  days_of_week: [1, 2, 3, 4, 5, 6, 7],
  lookback_hours: 6,
  grace_seconds: 300,
  timezone: 'Asia/Ho_Chi_Minh',
  camera_ids: [],
  version: 1,
  is_enabled: true,
  deleted_at: null,
  activation_started_at: new Date('2026-10-18T03:00:00Z'),
};
const run = {
  id: 'run',
  schedule_id: schedule.id,
  owner_user_id: ownerId,
  resident_user_id: residentId,
  scheduled_for: new Date('2026-10-18T02:00:00Z'),
  lookback_started_at: new Date('2026-10-17T20:00:00Z'),
  lookback_ended_at: new Date('2026-10-18T02:00:00Z'),
  grace_seconds: 300,
  lease_token: 'token',
  schedule_snapshot: { cameraIds: [] },
  event_id: 'event',
  request_sent_at: new Date('2026-10-18T02:00:00Z'),
  confirmation_deadline_at: new Date('2026-10-18T02:05:00Z'),
};

function confirmation(eventStatus = 'NOTIFIED', existing: unknown[] = []) {
  const query = jest.fn().mockImplementation(async (sql: string) => {
    if (sql.includes('SELECT id, status, version'))
      return { rows: [{ id: 'event', status: eventStatus, version: 1 }] };
    if (sql.includes('FROM confirmations')) return { rows: existing };
    if (sql.includes('INSERT INTO confirmations'))
      return { rows: [{ id: 'confirmation', responded_at: new Date() }] };
    return { rows: [] };
  });
  const client = { query, release: jest.fn() };
  const service = new WellnessService({
    getPoolClient: jest.fn().mockResolvedValue(client),
    getCheckById: jest.fn().mockResolvedValue(run),
  } as never);
  return { service, query };
}

describe('QA wellness independent requirement assertions', () => {
  afterEach(() => jest.useRealTimers());

  it.each([
    ['09:00', '2026-10-18T02:00:00.000Z'],
    ['18:00', '2026-10-18T11:00:00.000Z'],
  ])('US20 timezone local %s maps to correct UTC', (checkAt, expected) => {
    const worker = new WellnessSchedulerService({} as never, new ConfigService());
    expect(
      worker
        .computeScheduleOccurrence(
          { ...schedule, check_at: checkAt } as never,
          new Date('2026-10-18T01:00:00Z'),
        )
        ?.scheduledFor.toISOString(),
    ).toBe(expected);
  });
  it.each([
    ['2026-03-08T06:00:00Z', '02:30', '2026-03-08T07:30:00.000Z'],
    ['2026-11-01T05:00:00Z', '01:30', '2026-11-01T06:30:00.000Z'],
  ])('US20 DST %s follows PostgreSQL16 policy', (now, checkAt, expected) => {
    const worker = new WellnessSchedulerService({} as never, new ConfigService());
    expect(
      worker
        .computeScheduleOccurrence(
          { ...schedule, timezone: 'America/New_York', check_at: checkAt } as never,
          new Date(now),
        )
        ?.scheduledFor.toISOString(),
    ).toBe(expected);
  });
  it('US20 does not materialize occurrence preceding activation', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-18T10:00:00Z'));
    const repo = {
      getActiveEnabledSchedules: jest.fn().mockResolvedValue([schedule]),
      insertCheckRunIfNotExists: jest.fn(),
      updateScheduleLastCheckedAt: jest.fn(),
    };
    await new WellnessSchedulerService(
      repo as never,
      new ConfigService(),
    ).materializeDueOccurrences();
    expect(repo.insertCheckRunIfNotExists).not.toHaveBeenCalled();
  });
  it('US20 M5_ENABLED false stops new admission', async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() };
    const repo = {
      getActiveEnabledSchedules: jest.fn().mockResolvedValue([]),
      reclaimExpiredLeases: jest.fn(),
      claimPendingRuns: jest.fn().mockResolvedValue([]),
      getPoolClient: jest.fn().mockResolvedValue(client),
    };
    await new WellnessSchedulerService(
      repo as never,
      new ConfigService({ M5_ENABLED: 'false' }),
    ).tick();
    expect(repo.getActiveEnabledSchedules).not.toHaveBeenCalled();
  });
  it('US20 no delivery success is fabricated for a PENDING notification', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-18T02:00:00Z'));
    const client = {
      query: jest.fn().mockImplementation(async (sql: string) => ({
        rows: sql.includes('INSERT INTO events') ? [{ id: 'event' }] : [],
      })),
      release: jest.fn(),
    };
    const repo = {
      getPoolClient: jest.fn().mockResolvedValue(client),
      getScheduleById: jest.fn().mockResolvedValue(schedule),
      getPresenceState: jest.fn().mockResolvedValue('UNKNOWN'),
      findActivityInWindow: jest.fn().mockResolvedValue(null),
      hasActiveUnresolvedWellnessEvent: jest.fn().mockResolvedValue(null),
      updateRunDecision: jest.fn(),
      recordDeliverySuccess: jest.fn(),
    };
    await new WellnessSchedulerService(repo as never, new ConfigService()).evaluateSingleRun(run);
    expect(repo.recordDeliverySuccess).not.toHaveBeenCalled();
  });
  it.each([
    [299999, true],
    [300000, false],
    [300001, false],
  ])('US20 IM_OK boundary at %sms', async (elapsed, allowed) => {
    jest.useFakeTimers().setSystemTime(new Date(run.request_sent_at.getTime() + Number(elapsed)));
    const { service } = confirmation();
    const pending = service.confirmCheck(resident, run.id, {
      commandId: 'command',
      response: 'IM_OK',
    });
    if (allowed)
      await expect(pending).resolves.toMatchObject({ response: 'IM_OK', isAuthoritative: true });
    else await expect(pending).rejects.toMatchObject({ status: 409 });
  });
  it.each(['CLOSED', 'RESOLVED', 'ESCALATED'])(
    'US20 new IM_OK cannot resolve %s',
    async (status) => {
      jest.useFakeTimers().setSystemTime(new Date('2026-10-18T02:01:00Z'));
      const { service } = confirmation(status);
      await expect(
        service.confirmCheck(resident, run.id, { commandId: 'new-command', response: 'IM_OK' }),
      ).rejects.toMatchObject({ status: 409 });
    },
  );
  it('US20 changed note with same commandId is a conflict', async () => {
    const { service } = confirmation('RESOLVED', [
      {
        id: 'confirmation',
        event_id: 'event',
        response: 'IM_OK',
        note: 'original',
        responded_at: run.request_sent_at,
        is_authoritative: true,
        source_message_id: 'command',
      },
    ]);
    await expect(
      service.confirmCheck(resident, run.id, {
        commandId: 'command',
        response: 'IM_OK',
        note: 'changed',
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('US20 PATCH rejects resident from another household', async () => {
    const repo = {
      getScheduleById: jest.fn().mockResolvedValue(schedule),
      findConflictingSchedule: jest.fn().mockResolvedValue(null),
      verifyResidentHouseholdLink: jest.fn().mockResolvedValue(false),
      updateSchedule: jest.fn().mockResolvedValue(schedule),
    };
    await expect(
      new WellnessService(repo as never).updateSchedule(
        { sub: ownerId, role: 'CAREGIVER' } as TokenClaims,
        schedule.id,
        { residentUserId: '99999999-9999-4999-8999-999999999999' },
      ),
    ).rejects.toBeDefined();
    expect(repo.updateSchedule).not.toHaveBeenCalled();
  });
  it('US20 canonical observation replay ignores JSON property order', async () => {
    const dto = {
      observationId: 'observation',
      ownerUserId: ownerId,
      residentUserId: residentId,
      sourceSessionId: 's',
      trackId: 't',
      kind: 'MOTION' as const,
      observedAt: '2026-10-18T02:00:00Z',
    };
    const hash = createHash('sha256').update(JSON.stringify(dto)).digest('hex');
    const repo = { findObservationById: jest.fn().mockResolvedValue({ payload_hash: hash }) };
    const reversed = Object.fromEntries(Object.entries(dto).reverse());
    await expect(
      new WellnessService(repo as never).submitObservation(reversed as never),
    ).resolves.toMatchObject({ status: 'DUPLICATE' });
  });
  it('US20 missing identity evidence cannot suppress future checks', async () => {
    const repo = {
      findObservationById: jest.fn().mockResolvedValue(null),
      saveObservation: jest.fn(),
      updatePresence: jest.fn(),
    };
    await expect(
      new WellnessService(repo as never).submitObservation({
        observationId: 'o',
        ownerUserId: ownerId,
        residentUserId: residentId,
        sourceSessionId: 's',
        trackId: 't',
        kind: 'DEPARTURE',
        observedAt: '2026-10-18T02:00:00Z',
      }),
    ).rejects.toBeDefined();
    expect(repo.updatePresence).not.toHaveBeenCalled();
  });
  it('US20 presence after scheduledFor cannot suppress an earlier check', async () => {
    const pool = {
      query: jest.fn().mockResolvedValue({
        rows: [
          {
            state: 'AWAY',
            observed_at: new Date('2026-10-18T02:01:00Z'),
            valid_until: new Date('2026-10-19T02:01:00Z'),
          },
        ],
      }),
    };
    const repository = new WellnessRepository(pool as never);
    await expect(
      repository.getPresenceState(ownerId, residentId, new Date('2026-10-18T02:00:00Z')),
    ).resolves.toBe('UNKNOWN');
  });
});
