import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { InternalTokenGuard } from '../src/ai-results/internal-token.guard';
import { DeadlineCommandService } from '../src/escalation/deadline-command.service';
import { DeadlineController } from '../src/escalation/deadline.controller';
import {
  DeadlineRepository,
  type LockedEventWithClock,
} from '../src/escalation/deadline.repository';
import { EscalationRepository } from '../src/escalation/escalation.repository';
import {
  hashDeadlineCommand,
  type DeadlineCommandPayload,
} from '../src/escalation/dto/deadline-command.dto';

const EVENT_ID = '00000000-0000-4000-8000-000000000003';
const COMMAND_ID = '00000000-0000-4000-8000-000000000010';
const DEADLINE_ISO = '2026-11-05T03:01:00.000Z';

function validCommand(overrides: Partial<DeadlineCommandPayload> = {}): DeadlineCommandPayload {
  return {
    schemaVersion: 1,
    commandId: COMMAND_ID,
    eventId: EVENT_ID,
    deadlineVersion: 1,
    expectedDeadlineAt: DEADLINE_ISO,
    ...overrides,
  };
}

function makeLockedEvent(overrides: Partial<LockedEventWithClock> = {}): LockedEventWithClock {
  return {
    id: EVENT_ID,
    event_type: 'FALL_DETECTED',
    status: 'NOTIFIED',
    priority: 'P1',
    confidence: '0.88',
    ai_label: 'FALL_DETECTED',
    ai_results: [],
    version: 2,
    deadline_version: 1,
    detected_at: new Date('2026-11-05T03:00:00.000Z'),
    escalation_deadline_at: new Date(DEADLINE_ISO),
    notified_at: new Date('2026-11-05T03:00:01.000Z'),
    escalated_at: null,
    resolved_at: null,
    closed_at: null,
    rule_snapshot: null,
    triggering_results: [],
    db_now: new Date('2026-11-05T03:01:05.000Z'),
    ...overrides,
  };
}

describe('DeadlineCommandService & DeadlineController (US-13 / AWS-06)', () => {
  let service: DeadlineCommandService;
  let controller: DeadlineController;
  let escalationRepo: jest.Mocked<EscalationRepository>;
  let deadlineRepo: jest.Mocked<DeadlineRepository>;
  let mockClient: { query: jest.Mock; release: jest.Mock };

  beforeEach(async () => {
    mockClient = {
      query: jest.fn().mockResolvedValue({ rows: [] }),
      release: jest.fn(),
    };

    const mockEscalationRepo = {
      updateEventStatus: jest.fn(),
      createStatusHistory: jest.fn(),
      createNotificationIntent: jest.fn(),
    };

    const mockDeadlineRepo = {
      getPoolClient: jest.fn().mockResolvedValue(mockClient),
      findReceiptByCommandId: jest.fn().mockResolvedValue(null),
      findReceiptByCommandIdReadOnly: jest.fn().mockResolvedValue(null),
      findEventForUpdateWithClock: jest.fn(),
      insertReceipt: jest.fn().mockResolvedValue(undefined),
      markDispatchCompletedByCommandId: jest.fn().mockResolvedValue(undefined),
    };

    const module = await Test.createTestingModule({
      controllers: [DeadlineController],
      providers: [
        DeadlineCommandService,
        InternalTokenGuard,
        {
          provide: ConfigService,
          useValue: new ConfigService({
            INTERNAL_SERVICE_TOKEN: 's'.repeat(32),
          }),
        },
        { provide: EscalationRepository, useValue: mockEscalationRepo },
        { provide: DeadlineRepository, useValue: mockDeadlineRepo },
      ],
    }).compile();

    service = module.get(DeadlineCommandService);
    controller = module.get(DeadlineController);
    escalationRepo = module.get(EscalationRepository);
    deadlineRepo = module.get(DeadlineRepository);
  });

  describe('input validation (400)', () => {
    it('rejects malformed payloads and eventId path/body mismatch without opening DB tx', async () => {
      const invalidCases: Array<[string, unknown]> = [
        ['not-a-uuid', validCommand()],
        [EVENT_ID, null],
        [EVENT_ID, { ...validCommand(), extra: true }],
        [EVENT_ID, { ...validCommand(), schemaVersion: 2 }],
        [EVENT_ID, { ...validCommand(), commandId: 'bad' }],
        [EVENT_ID, { ...validCommand(), eventId: '00000000-0000-4000-8000-000000000099' }],
        [EVENT_ID, { ...validCommand(), deadlineVersion: 0 }],
        [EVENT_ID, { ...validCommand(), deadlineVersion: 1.5 }],
        [EVENT_ID, { ...validCommand(), expectedDeadlineAt: '2026-11-05T03:01:00+07:00' }],
        [EVENT_ID, { ...validCommand(), expectedDeadlineAt: '2026-02-30T03:01:00Z' }],
      ];

      for (const [pathEventId, payload] of invalidCases) {
        await expect(service.applyCommand(pathEventId, payload)).rejects.toThrow(
          BadRequestException,
        );
      }
      expect(deadlineRepo.getPoolClient).not.toHaveBeenCalled();
    });
  });

  describe('401 auth guard', () => {
    it('accepts INTERNAL_SERVICE_TOKEN and rejects missing, browser JWT, or AI_INTERNAL_TOKEN', () => {
      const internalToken = 'internal-service-token-at-least-32-chars';
      const guard = new InternalTokenGuard(
        new ConfigService({
          INTERNAL_SERVICE_TOKEN: internalToken,
          AI_INTERNAL_TOKEN: 'ai-internal-token-that-must-not-be-accepted',
        }),
      );

      const contextWithHeaders = (headers: Record<string, string | undefined>) =>
        ({
          switchToHttp: () => ({
            getRequest: () => ({
              header: (name: string) => headers[name.toLowerCase()],
            }),
          }),
        }) as unknown as ExecutionContext;

      expect(guard.canActivate(contextWithHeaders({ 'x-internal-token': internalToken }))).toBe(
        true,
      );
      expect(() => guard.canActivate(contextWithHeaders({}))).toThrow(UnauthorizedException);
      expect(() =>
        guard.canActivate(
          contextWithHeaders({ authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.fake.jwt' }),
        ),
      ).toThrow(UnauthorizedException);
      expect(() =>
        guard.canActivate(
          contextWithHeaders({
            'x-internal-token': 'ai-internal-token-that-must-not-be-accepted',
          }),
        ),
      ).toThrow(UnauthorizedException);
    });
  });

  describe('404 event not found', () => {
    it('throws NotFoundException and rolls back when event does not exist', async () => {
      deadlineRepo.findEventForUpdateWithClock.mockResolvedValueOnce(null);

      await expect(service.applyCommand(EVENT_ID, validCommand())).rejects.toThrow(
        NotFoundException,
      );
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(deadlineRepo.insertReceipt).not.toHaveBeenCalled();
    });
  });

  describe('200 APPLIED (ESCALATED)', () => {
    it('transitions due NOTIFIED event to ESCALATED, writes history + intent + receipt atomically', async () => {
      const locked = makeLockedEvent();
      deadlineRepo.findEventForUpdateWithClock.mockResolvedValueOnce(locked);
      escalationRepo.updateEventStatus.mockResolvedValueOnce({
        ...locked,
        status: 'ESCALATED',
        version: 3,
        escalation_deadline_at: null,
      });
      escalationRepo.createNotificationIntent.mockResolvedValueOnce(
        '00000000-0000-4000-8000-000000000077',
      );

      const res = await controller.applyDeadline(EVENT_ID, validCommand());

      expect(res).toEqual({
        commandId: COMMAND_ID,
        disposition: 'APPLIED',
        reason: 'ESCALATED',
        aggregateVersion: 3,
      });
      expect(escalationRepo.updateEventStatus).toHaveBeenCalledWith(
        mockClient,
        EVENT_ID,
        2,
        expect.objectContaining({
          status: 'ESCALATED',
          escalatedAt: locked.db_now,
          escalationDeadlineAt: null,
        }),
      );
      expect(escalationRepo.createStatusHistory).toHaveBeenCalledWith(
        mockClient,
        expect.objectContaining({
          eventId: EVENT_ID,
          fromStatus: 'NOTIFIED',
          toStatus: 'ESCALATED',
          reason: 'TIMEOUT',
          actorType: 'SCHEDULER',
        }),
      );
      expect(escalationRepo.createNotificationIntent).toHaveBeenCalledWith(
        mockClient,
        expect.objectContaining({
          eventId: EVENT_ID,
          channel: 'CONNECT_CALL',
          status: 'PENDING',
          escalationLevel: 1,
        }),
      );
      expect(deadlineRepo.insertReceipt).toHaveBeenCalledWith(
        mockClient,
        expect.objectContaining({
          commandId: COMMAND_ID,
          disposition: 'APPLIED',
          reason: 'ESCALATED',
          aggregateVersion: 3,
          notificationId: '00000000-0000-4000-8000-000000000077',
        }),
      );
      expect(deadlineRepo.markDispatchCompletedByCommandId).toHaveBeenCalledWith(
        mockClient,
        COMMAND_ID,
      );
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    });
  });

  describe('200 NO_OP reasons', () => {
    it.each([
      ['RESOLVED', makeLockedEvent({ status: 'RESOLVED', escalation_deadline_at: null })],
      ['ACKNOWLEDGED', makeLockedEvent({ status: 'CLOSED', escalation_deadline_at: null })],
      ['ALREADY_APPLIED', makeLockedEvent({ status: 'ESCALATED', escalation_deadline_at: null })],
      ['STALE_DEADLINE', makeLockedEvent({ status: 'NOTIFIED', deadline_version: 2 })],
      ['STALE_DEADLINE', makeLockedEvent({ status: 'NOTIFIED', escalation_deadline_at: null })],
      ['STALE_DEADLINE', makeLockedEvent({ status: 'LOGGED_ONLY', escalation_deadline_at: null })],
    ] as const)(
      'records durable receipt and returns NO_OP/%s without creating notification intent',
      async (expectedReason, event) => {
        deadlineRepo.findEventForUpdateWithClock.mockResolvedValueOnce(event);

        const res = await service.applyCommand(EVENT_ID, validCommand());

        expect(res).toEqual({
          commandId: COMMAND_ID,
          disposition: 'NO_OP',
          reason: expectedReason,
          aggregateVersion: event.version,
        });
        expect(escalationRepo.updateEventStatus).not.toHaveBeenCalled();
        expect(escalationRepo.createNotificationIntent).not.toHaveBeenCalled();
        expect(deadlineRepo.insertReceipt).toHaveBeenCalledWith(
          mockClient,
          expect.objectContaining({
            commandId: COMMAND_ID,
            disposition: 'NO_OP',
            reason: expectedReason,
            notificationId: null,
          }),
        );
        expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
      },
    );
  });

  describe('409 NOT_DUE', () => {
    it('returns 409 NOT_DUE with DB retryAt and does NOT persist a receipt', async () => {
      const earlyEvent = makeLockedEvent({
        db_now: new Date('2026-11-05T03:00:45.000Z'),
        escalation_deadline_at: new Date('2026-11-05T03:01:00.000Z'),
      });
      deadlineRepo.findEventForUpdateWithClock.mockResolvedValueOnce(earlyEvent);

      try {
        await service.applyCommand(EVENT_ID, validCommand());
        fail('Expected ConflictException');
      } catch (error) {
        expect(error).toBeInstanceOf(ConflictException);
        expect((error as ConflictException).getResponse()).toMatchObject({
          code: 'NOT_DUE',
          retryAt: '2026-11-05T03:01:00.000Z',
        });
      }

      expect(deadlineRepo.insertReceipt).not.toHaveBeenCalled();
      expect(escalationRepo.updateEventStatus).not.toHaveBeenCalled();
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    });
  });

  describe('idempotency & 409 COMMAND_CONFLICT', () => {
    it('returns stored 200 decision on identical command replay without duplicate side effects', async () => {
      const cmd = validCommand();
      deadlineRepo.findReceiptByCommandId.mockResolvedValueOnce({
        command_id: COMMAND_ID,
        event_id: EVENT_ID,
        deadline_version: 1,
        expected_deadline_at: new Date(DEADLINE_ISO),
        payload_hash: hashDeadlineCommand(cmd),
        payload: cmd,
        disposition: 'APPLIED',
        reason: 'ESCALATED',
        aggregate_version: 3,
        notification_id: '00000000-0000-4000-8000-000000000077',
        processed_at: new Date(),
      });

      const res = await service.applyCommand(EVENT_ID, cmd);

      expect(res).toEqual({
        commandId: COMMAND_ID,
        disposition: 'APPLIED',
        reason: 'ESCALATED',
        aggregateVersion: 3,
      });
      expect(deadlineRepo.findEventForUpdateWithClock).not.toHaveBeenCalled();
      expect(escalationRepo.createNotificationIntent).not.toHaveBeenCalled();
    });

    it('throws 409 COMMAND_CONFLICT when commandId is reused with different payload', async () => {
      const original = validCommand({ deadlineVersion: 1 });
      const mutated = validCommand({ deadlineVersion: 2 });
      deadlineRepo.findReceiptByCommandId.mockResolvedValueOnce({
        command_id: COMMAND_ID,
        event_id: EVENT_ID,
        deadline_version: 1,
        expected_deadline_at: new Date(DEADLINE_ISO),
        payload_hash: hashDeadlineCommand(original),
        payload: original,
        disposition: 'APPLIED',
        reason: 'ESCALATED',
        aggregate_version: 3,
        notification_id: '00000000-0000-4000-8000-000000000077',
        processed_at: new Date(),
      });

      try {
        await service.applyCommand(EVENT_ID, mutated);
        fail('Expected ConflictException');
      } catch (error) {
        expect(error).toBeInstanceOf(ConflictException);
        expect((error as ConflictException).getResponse()).toMatchObject({
          code: 'COMMAND_CONFLICT',
        });
      }
      expect(escalationRepo.updateEventStatus).not.toHaveBeenCalled();
    });
  });
});
