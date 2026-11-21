import type { Pool } from 'pg';
import { DeadlineRepository } from '../src/escalation/deadline.repository';

describe('DeadlineRepository Unit (US-13 / AWS-06)', () => {
  let repository: DeadlineRepository;
  let mockPool: { query: jest.Mock; connect: jest.Mock };
  let mockClient: { query: jest.Mock; release: jest.Mock };

  beforeEach(() => {
    mockClient = {
      query: jest.fn(),
      release: jest.fn(),
    };
    mockPool = {
      query: jest.fn(),
      connect: jest.fn().mockResolvedValue(mockClient),
    };
    repository = new DeadlineRepository(mockPool as unknown as Pool);
  });

  it('delegates getPoolClient and lookup methods (found & null)', async () => {
    expect(await repository.getPoolClient()).toBe(mockClient);

    mockClient.query.mockResolvedValueOnce({ rows: [{ id: 'evt-1' }] });
    expect(await repository.findEventForUpdateWithClock(mockClient as any, 'evt-1')).toEqual({
      id: 'evt-1',
    });
    mockClient.query.mockResolvedValueOnce({ rows: [] });
    expect(await repository.findEventForUpdateWithClock(mockClient as any, 'evt-2')).toBeNull();

    mockClient.query.mockResolvedValueOnce({ rows: [{ command_id: 'cmd-1' }] });
    expect(await repository.findReceiptByCommandId(mockClient as any, 'cmd-1')).toEqual({
      command_id: 'cmd-1',
    });
    mockClient.query.mockResolvedValueOnce({ rows: [] });
    expect(await repository.findReceiptByCommandId(mockClient as any, 'cmd-2')).toBeNull();

    mockPool.query.mockResolvedValueOnce({ rows: [{ command_id: 'cmd-1' }] });
    expect(await repository.findReceiptByCommandIdReadOnly('cmd-1')).toEqual({
      command_id: 'cmd-1',
    });
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    expect(await repository.findReceiptByCommandIdReadOnly('cmd-2')).toBeNull();
  });

  it('inserts receipts, enqueues dispatches, adopts local deadlines, and cancels/completes dispatches', async () => {
    const now = new Date('2026-11-05T03:01:00Z');
    mockClient.query.mockResolvedValueOnce({});
    await repository.insertReceipt(mockClient as any, {
      commandId: 'cmd-1',
      eventId: 'evt-1',
      deadlineVersion: 1,
      expectedDeadlineAt: now,
      payloadHash: 'hash',
      payload: {
        schemaVersion: 1,
        commandId: 'cmd-1',
        eventId: 'evt-1',
        deadlineVersion: 1,
        expectedDeadlineAt: now.toISOString(),
      },
      disposition: 'APPLIED',
      reason: 'ESCALATED',
      aggregateVersion: 2,
      notificationId: 'notif-1',
    });
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO deadline_command_receipts'),
      expect.arrayContaining(['cmd-1', 'evt-1', 1]),
    );

    mockClient.query.mockResolvedValueOnce({ rows: [{ command_id: 'cmd-1' }] });
    expect(
      await repository.enqueueDispatch(mockClient as any, {
        eventId: 'evt-1',
        deadlineVersion: 1,
        expectedDeadlineAt: now,
        stateMachineArn: 'arn:aws:states:ap-southeast-1:123456789012:stateMachine:dl',
        commandId: 'cmd-1',
      }),
    ).toEqual({ command_id: 'cmd-1' });

    mockClient.query.mockResolvedValueOnce({ rows: [] });
    expect(
      await repository.enqueueDispatch(mockClient as any, {
        eventId: 'evt-1',
        deadlineVersion: 1,
        expectedDeadlineAt: now,
        stateMachineArn: 'arn:aws:states:ap-southeast-1:123456789012:stateMachine:dl',
      }),
    ).toBeNull();

    mockPool.query.mockResolvedValueOnce({ rowCount: 3 });
    expect(await repository.adoptPendingLocalDeadlines('arn:sm')).toBe(3);
    mockPool.query.mockResolvedValueOnce({ rowCount: null });
    expect(await repository.adoptPendingLocalDeadlines('arn:sm', 10)).toBe(0);

    mockClient.query.mockResolvedValueOnce({ rowCount: 2 });
    expect(await repository.cancelPendingDispatchesForEvent(mockClient as any, 'evt-1')).toBe(2);
    mockClient.query.mockResolvedValueOnce({ rowCount: null });
    expect(await repository.cancelPendingDispatchesForEvent(mockClient as any, 'evt-1')).toBe(0);

    mockClient.query.mockResolvedValueOnce({});
    await repository.markDispatchCompletedByCommandId(mockClient as any, 'cmd-1');
  });

  it('claims pending dispatch across empty, missing event, receipt present, stale state, valid claim, and error rollback', async () => {
    const dispatchRow = {
      command_id: 'cmd-1',
      event_id: 'evt-1',
      deadline_version: 2,
    };

    // 1. No pending dispatch
    mockClient.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({});
    expect(await repository.claimNextPendingDispatch()).toBeNull();
    expect(mockClient.release).toHaveBeenCalled();

    // 2. Missing event -> CANCELLED
    mockClient.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [dispatchRow] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    expect(await repository.claimNextPendingDispatch()).toBeNull();

    // 3. Receipt already exists -> COMPLETED
    mockClient.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [dispatchRow] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'evt-1',
            status: 'NOTIFIED',
            deadline_version: 2,
            escalation_deadline_at: new Date(),
            has_receipt: true,
          },
        ],
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    expect(await repository.claimNextPendingDispatch()).toBeNull();

    // 4. Stale / non-NOTIFIED event -> CANCELLED
    mockClient.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [dispatchRow] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'evt-1',
            status: 'RESOLVED',
            deadline_version: 2,
            escalation_deadline_at: null,
            has_receipt: false,
          },
        ],
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    expect(await repository.claimNextPendingDispatch()).toBeNull();

    // 5. Valid claim -> updates lease & returns dispatch + eventState
    const validState = {
      id: 'evt-1',
      status: 'NOTIFIED',
      deadline_version: 2,
      escalation_deadline_at: new Date(),
      has_receipt: false,
    };
    mockClient.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [dispatchRow] })
      .mockResolvedValueOnce({ rows: [validState] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    expect(await repository.claimNextPendingDispatch(45)).toEqual({
      dispatch: dispatchRow,
      eventState: validState,
    });

    // 6. Query throws -> ROLLBACK and rethrow
    mockClient.query
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('DB failure'))
      .mockResolvedValueOnce({});
    await expect(repository.claimNextPendingDispatch()).rejects.toThrow('DB failure');
    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
  });

  it('updates dispatch lifecycle states, retries, reconciledAt, and reconcile queries', async () => {
    mockPool.query.mockResolvedValue({});

    await repository.markDispatchStarted('cmd-1', 'arn:exec');
    await repository.markDispatchCompleted('cmd-1', 'arn:exec');
    await repository.markDispatchCompleted('cmd-1');
    await repository.markDispatchFailed('cmd-1', 'ERR', 'arn:exec');
    await repository.markDispatchFailed('cmd-1', 'ERR');
    await repository.touchReconciledAt('cmd-1');

    mockPool.query.mockResolvedValueOnce({ rows: [{ attempts: 2, status: 'PENDING' }] });
    expect(await repository.recordDispatchRetryOrFail('cmd-1', 'ERR', 5)).toEqual({
      attempts: 2,
      failed: false,
    });

    mockPool.query.mockResolvedValueOnce({ rows: [{ attempts: 5, status: 'FAILED' }] });
    expect(await repository.recordDispatchRetryOrFail('cmd-1', 'ERR', 5)).toEqual({
      attempts: 5,
      failed: true,
    });

    mockPool.query.mockResolvedValueOnce({ rows: [] });
    expect(await repository.recordDispatchRetryOrFail('cmd-1', 'ERR', 5)).toEqual({
      attempts: 5,
      failed: false,
    });

    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'evt-1' }] });
    expect(await repository.getDispatchEventState('evt-1', 'cmd-1')).toEqual({ id: 'evt-1' });
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    expect(await repository.getDispatchEventState('evt-1', 'cmd-1')).toBeNull();

    mockPool.query.mockResolvedValueOnce({ rows: [{ command_id: 'cmd-1' }] });
    expect(await repository.findStartedDispatchesForReconcile()).toEqual([{ command_id: 'cmd-1' }]);
  });
});
