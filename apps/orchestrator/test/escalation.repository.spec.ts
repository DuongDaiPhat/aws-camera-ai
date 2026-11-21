import type { Pool } from 'pg';
import {
  EscalationRepository,
  EventNotFoundError,
  EventVersionConflictError,
} from '../src/escalation/escalation.repository';

describe('EscalationRepository Unit (US-13)', () => {
  let repository: EscalationRepository;
  let mockPool: { connect: jest.Mock };
  let mockClient: { query: jest.Mock; release: jest.Mock };

  beforeEach(() => {
    mockClient = {
      query: jest.fn(),
      release: jest.fn(),
    };
    mockPool = {
      connect: jest.fn().mockResolvedValue(mockClient),
    };
    repository = new EscalationRepository(mockPool as unknown as Pool);
  });

  it('exposes domain error classes and pool client helper', async () => {
    expect(new EventNotFoundError().name).toBe('EventNotFoundError');
    expect(new EventNotFoundError('custom').message).toBe('custom');
    expect(new EventVersionConflictError().name).toBe('EventVersionConflictError');
    expect(new EventVersionConflictError('conflict').message).toBe('conflict');
    expect(await repository.getPoolClient()).toBe(mockClient);
  });

  it('findEventForUpdate returns row or null', async () => {
    mockClient.query.mockResolvedValueOnce({ rows: [{ id: 'evt-1' }] });
    expect(await repository.findEventForUpdate(mockClient as any, 'evt-1')).toEqual({
      id: 'evt-1',
    });

    mockClient.query.mockResolvedValueOnce({ rows: [] });
    expect(await repository.findEventForUpdate(mockClient as any, 'evt-2')).toBeNull();
  });

  it('updateEventStatus updates with full/minimal fields and throws EventVersionConflictError on 0 rows', async () => {
    const now = new Date('2026-11-05T03:00:00Z');
    mockClient.query.mockResolvedValueOnce({ rows: [{ id: 'evt-1', version: 2 }] });
    const full = await repository.updateEventStatus(mockClient as any, 'evt-1', 1, {
      status: 'NOTIFIED',
      priority: 'P0',
      notifiedAt: now,
      escalationDeadlineAt: now,
      bumpDeadlineVersion: true,
      escalatedAt: now,
      resolvedAt: now,
      closedAt: now,
      ruleSnapshot: { t_wait: 30 },
      triggeringResults: [{ label: 'fall' }],
    });
    expect(full.version).toBe(2);

    mockClient.query.mockResolvedValueOnce({ rows: [{ id: 'evt-1', version: 3 }] });
    const minimal = await repository.updateEventStatus(mockClient as any, 'evt-1', 2, {
      status: 'RESOLVED',
    });
    expect(minimal.version).toBe(3);

    mockClient.query.mockResolvedValueOnce({ rows: [] });
    await expect(
      repository.updateEventStatus(mockClient as any, 'evt-1', 99, { status: 'CLOSED' }),
    ).rejects.toThrow(EventVersionConflictError);
  });

  it('creates status history, confirmations (with & without userId), and notification intents', async () => {
    mockClient.query.mockResolvedValueOnce({});
    await repository.createStatusHistory(mockClient as any, {
      eventId: 'evt-1',
      fromStatus: 'DETECTED',
      toStatus: 'NOTIFIED',
      reason: 'GRAY_ZONE',
      actorType: 'SYSTEM',
      actorUserId: 'user-1',
      channel: 'TELEGRAM',
      metadata: { score: 0.65 },
    });

    mockClient.query.mockResolvedValueOnce({});
    await repository.createStatusHistory(mockClient as any, {
      eventId: 'evt-1',
      fromStatus: null,
      toStatus: 'DETECTED',
      actorType: 'SYSTEM',
    });

    // createConfirmation with userId (user found & not found) and without userId
    mockClient.query
      .mockResolvedValueOnce({ rows: [{ id: 'conf-1' }] })
      .mockResolvedValueOnce({ rows: [{ full_name: 'Alice' }] });
    const withUser = await repository.createConfirmation(mockClient as any, {
      eventId: 'evt-1',
      notificationId: 'notif-1',
      userId: 'user-1',
      emergencyContactId: null,
      channel: 'TELEGRAM',
      response: 'IM_OK',
      phase: 'INITIAL',
      isAuthoritative: true,
      note: 'ok',
      sourceMessageId: 'msg-1',
      sourceUpdateId: 'upd-1',
    });
    expect(withUser.confirmed_by_name).toBe('Alice');

    mockClient.query
      .mockResolvedValueOnce({ rows: [{ id: 'conf-2' }] })
      .mockResolvedValueOnce({ rows: [] });
    const missingUser = await repository.createConfirmation(mockClient as any, {
      eventId: 'evt-1',
      userId: 'user-missing',
      channel: 'DASHBOARD',
      response: 'IM_OK',
      phase: 'INITIAL',
      isAuthoritative: true,
    });
    expect(missingUser.confirmed_by_name).toBeNull();

    mockClient.query.mockResolvedValueOnce({ rows: [{ id: 'conf-3' }] });
    const noUser = await repository.createConfirmation(mockClient as any, {
      eventId: 'evt-1',
      channel: 'DASHBOARD',
      response: 'ACKNOWLEDGED',
      phase: 'EMERGENCY',
      isAuthoritative: true,
    });
    expect(noUser.id).toBe('conf-3');

    mockClient.query.mockResolvedValueOnce({ rows: [{ id: 'notif-10' }] });
    expect(
      await repository.createNotificationIntent(mockClient as any, {
        eventId: 'evt-1',
        recipientUserId: 'user-1',
        emergencyContactId: 'ec-1',
        channel: 'CONNECT_CALL',
        status: 'PENDING',
        escalationLevel: 1,
        payload: { reason: 'TIMEOUT' },
      }),
    ).toBe('notif-10');

    mockClient.query.mockResolvedValueOnce({ rows: [{ id: 'notif-11' }] });
    expect(
      await repository.createNotificationIntent(mockClient as any, {
        eventId: 'evt-1',
        channel: 'TELEGRAM',
        status: 'PENDING',
        escalationLevel: 0,
      }),
    ).toBe('notif-11');
  });

  it('queries authoritative confirmations, telegram replays, telegram authorization, and due events', async () => {
    mockClient.query.mockResolvedValueOnce({ rows: [{ id: 'conf-1' }] });
    expect(
      await repository.findAuthoritativeConfirmation(mockClient as any, 'evt-1', 'INITIAL'),
    ).toEqual({ id: 'conf-1' });
    mockClient.query.mockResolvedValueOnce({ rows: [] });
    expect(
      await repository.findAuthoritativeConfirmation(mockClient as any, 'evt-1', 'EMERGENCY'),
    ).toBeNull();

    mockClient.query.mockResolvedValueOnce({ rows: [{ id: 'conf-tg' }] });
    expect(await repository.findTelegramReplay(mockClient as any, 'upd-1')).toEqual({
      id: 'conf-tg',
    });
    mockClient.query.mockResolvedValueOnce({ rows: [] });
    expect(await repository.findTelegramReplay(mockClient as any, 'upd-2')).toBeNull();

    mockClient.query.mockResolvedValueOnce({ rowCount: 1 });
    expect(
      await repository.authorizeTelegramConfirmation(mockClient as any, 'evt-1', 'user-1', {
        notificationId: 'notif-1',
        telegramUserId: 'tg-1',
        chatId: 'chat-1',
        messageId: 'msg-1',
        ttlSeconds: 300,
      }),
    ).toBe(true);

    mockClient.query.mockResolvedValueOnce({ rowCount: 0 });
    expect(
      await repository.authorizeTelegramConfirmation(mockClient as any, 'evt-1', 'user-1', {
        notificationId: 'notif-1',
        telegramUserId: 'tg-1',
        chatId: 'chat-1',
        messageId: 'msg-1',
        ttlSeconds: 300,
      }),
    ).toBe(false);

    mockClient.query.mockResolvedValueOnce({ rows: [{ id: 'evt-due' }] });
    expect(await repository.findDueEventsForEscalation(mockClient as any, 10)).toEqual([
      { id: 'evt-due' },
    ]);
  });
});
