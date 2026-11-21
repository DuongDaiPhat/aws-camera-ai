import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DescribeExecutionCommand,
  StartExecutionCommand,
  type SFNClient,
} from '@aws-sdk/client-sfn';
import { DeadlineStepFunctionsService } from '../src/escalation/deadline-stepfunctions.service';
import type {
  DeadlineRepository,
  DeadlineDispatchRecord,
} from '../src/escalation/deadline.repository';
import type { DeadlineCommandService } from '../src/escalation/deadline-command.service';
import { EscalationDeadlineWorkerService } from '../src/escalation/escalation-deadline-worker.service';
import type { EscalationRepository } from '../src/escalation/escalation.repository';

const STATE_MACHINE_ARN =
  'arn:aws:states:ap-southeast-1:926883321040:stateMachine:argusai-staging-deadline';
const COMMAND_ID = '00000000-0000-4000-8000-000000000010';
const EVENT_ID = '00000000-0000-4000-8000-000000000003';
const EXECUTION_NAME = `deadline-${COMMAND_ID}`;
const EXECUTION_ARN = `arn:aws:states:ap-southeast-1:926883321040:execution:argusai-staging-deadline:${EXECUTION_NAME}`;

function makeDispatch(overrides: Partial<DeadlineDispatchRecord> = {}): DeadlineDispatchRecord {
  return {
    command_id: COMMAND_ID,
    event_id: EVENT_ID,
    deadline_version: 2,
    expected_deadline_at: new Date('2026-11-05T03:01:00.000Z'),
    execution_name: EXECUTION_NAME,
    state_machine_arn: STATE_MACHINE_ARN,
    execution_arn: null,
    status: 'PENDING',
    attempts: 0,
    available_at: new Date('2026-11-05T03:00:00.000Z'),
    last_error: null,
    started_at: null,
    reconciled_at: null,
    created_at: new Date('2026-11-05T03:00:00.000Z'),
    updated_at: new Date('2026-11-05T03:00:00.000Z'),
    ...overrides,
  };
}

describe('DeadlineStepFunctionsService & local worker gating (US-13 / AWS-06)', () => {
  let sfnMock: { send: jest.Mock; destroy: jest.Mock };
  let deadlineRepo: jest.Mocked<DeadlineRepository>;
  let commandService: jest.Mocked<DeadlineCommandService>;
  let stepFunctionsConfig: ConfigService;

  beforeEach(() => {
    sfnMock = {
      send: jest.fn(),
      destroy: jest.fn(),
    };
    deadlineRepo = {
      adoptPendingLocalDeadlines: jest.fn().mockResolvedValue(0),
      claimNextPendingDispatch: jest.fn().mockResolvedValue(null),
      markDispatchStarted: jest.fn().mockResolvedValue(undefined),
      markDispatchCompleted: jest.fn().mockResolvedValue(undefined),
      markDispatchFailed: jest.fn().mockResolvedValue(undefined),
      recordDispatchRetryOrFail: jest.fn().mockResolvedValue({ attempts: 1, failed: false }),
      touchReconciledAt: jest.fn().mockResolvedValue(undefined),
      getDispatchEventState: jest.fn(),
      findStartedDispatchesForReconcile: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<DeadlineRepository>;

    commandService = {
      applyCommand: jest.fn(),
    } as unknown as jest.Mocked<DeadlineCommandService>;

    stepFunctionsConfig = new ConfigService({
      DEADLINE_DRIVER: 'stepfunctions',
      AWS_REGION: 'ap-southeast-1',
      DEADLINE_STATE_MACHINE_ARN: STATE_MACHINE_ARN,
    });
  });

  it('starts execution with deterministic deadline-<commandId> name and exact G0 input', async () => {
    const dispatch = makeDispatch();
    deadlineRepo.claimNextPendingDispatch.mockResolvedValueOnce({
      dispatch,
      eventState: {
        id: EVENT_ID,
        status: 'NOTIFIED',
        deadline_version: 2,
        escalation_deadline_at: dispatch.expected_deadline_at,
        has_receipt: false,
      },
    });
    sfnMock.send.mockResolvedValueOnce({ executionArn: EXECUTION_ARN });

    const service = new DeadlineStepFunctionsService(
      stepFunctionsConfig,
      deadlineRepo,
      commandService,
      sfnMock as unknown as SFNClient,
    );

    const processed = await service.dispatchNextPending();

    expect(processed).toBe(true);
    expect(sfnMock.send).toHaveBeenCalledTimes(1);
    const cmd = sfnMock.send.mock.calls[0][0];
    expect(cmd).toBeInstanceOf(StartExecutionCommand);
    expect(cmd.input).toEqual({
      stateMachineArn: STATE_MACHINE_ARN,
      name: EXECUTION_NAME,
      input: JSON.stringify({
        schemaVersion: 1,
        commandId: COMMAND_ID,
        eventId: EVENT_ID,
        deadlineVersion: 2,
        expectedDeadlineAt: '2026-11-05T03:01:00.000Z',
      }),
    });
    expect(deadlineRepo.markDispatchStarted).toHaveBeenCalledWith(COMMAND_ID, EXECUTION_ARN);
  });

  it('reconciles ExecutionAlreadyExists when existing execution is RUNNING', async () => {
    const dispatch = makeDispatch();
    deadlineRepo.claimNextPendingDispatch.mockResolvedValueOnce({
      dispatch,
      eventState: {
        id: EVENT_ID,
        status: 'NOTIFIED',
        deadline_version: 2,
        escalation_deadline_at: dispatch.expected_deadline_at,
        has_receipt: false,
      },
    });

    const alreadyExists = Object.assign(new Error('Execution already exists'), {
      name: 'ExecutionAlreadyExists',
    });
    sfnMock.send
      .mockRejectedValueOnce(alreadyExists)
      .mockResolvedValueOnce({ status: 'RUNNING', executionArn: EXECUTION_ARN });

    const service = new DeadlineStepFunctionsService(
      stepFunctionsConfig,
      deadlineRepo,
      commandService,
      sfnMock as unknown as SFNClient,
    );

    await service.dispatchNextPending();

    expect(sfnMock.send).toHaveBeenCalledTimes(2);
    expect(sfnMock.send.mock.calls[1][0]).toBeInstanceOf(DescribeExecutionCommand);
    expect(sfnMock.send.mock.calls[1][0].input).toEqual({ executionArn: EXECUTION_ARN });
    expect(deadlineRepo.markDispatchStarted).toHaveBeenCalledWith(COMMAND_ID, EXECUTION_ARN);
  });

  it('reconciles ExecutionAlreadyExists when closed execution already produced DB receipt', async () => {
    const dispatch = makeDispatch();
    deadlineRepo.claimNextPendingDispatch.mockResolvedValueOnce({
      dispatch,
      eventState: {
        id: EVENT_ID,
        status: 'NOTIFIED',
        deadline_version: 2,
        escalation_deadline_at: dispatch.expected_deadline_at,
        has_receipt: false,
      },
    });
    const alreadyExists = Object.assign(new Error('Execution already exists'), {
      name: 'ExecutionAlreadyExists',
    });
    sfnMock.send
      .mockRejectedValueOnce(alreadyExists)
      .mockResolvedValueOnce({ status: 'SUCCEEDED' });
    deadlineRepo.getDispatchEventState.mockResolvedValueOnce({
      id: EVENT_ID,
      status: 'ESCALATED',
      deadline_version: 2,
      escalation_deadline_at: null,
      has_receipt: true,
    });

    const service = new DeadlineStepFunctionsService(
      stepFunctionsConfig,
      deadlineRepo,
      commandService,
      sfnMock as unknown as SFNClient,
    );

    await service.dispatchNextPending();

    expect(deadlineRepo.markDispatchCompleted).toHaveBeenCalledWith(COMMAND_ID, EXECUTION_ARN);
  });

  it('recovers retryable failed execution via shared idempotent applyCommand', async () => {
    const dispatch = makeDispatch({ status: 'STARTED', execution_arn: EXECUTION_ARN });
    deadlineRepo.findStartedDispatchesForReconcile.mockResolvedValueOnce([dispatch]);
    deadlineRepo.getDispatchEventState
      .mockResolvedValueOnce({
        id: EVENT_ID,
        status: 'NOTIFIED',
        deadline_version: 2,
        escalation_deadline_at: dispatch.expected_deadline_at,
        has_receipt: false,
      })
      .mockResolvedValueOnce({
        id: EVENT_ID,
        status: 'NOTIFIED',
        deadline_version: 2,
        escalation_deadline_at: dispatch.expected_deadline_at,
        has_receipt: false,
      });
    sfnMock.send.mockResolvedValueOnce({
      status: 'FAILED',
      error: 'DeadlineRetryable',
    });
    commandService.applyCommand.mockResolvedValueOnce({
      commandId: COMMAND_ID,
      disposition: 'APPLIED',
      reason: 'ESCALATED',
      aggregateVersion: 3,
    });

    const service = new DeadlineStepFunctionsService(
      stepFunctionsConfig,
      deadlineRepo,
      commandService,
      sfnMock as unknown as SFNClient,
    );

    const count = await service.reconcileStartedDispatches();

    expect(count).toBe(1);
    expect(commandService.applyCommand).toHaveBeenCalledWith(EVENT_ID, {
      schemaVersion: 1,
      commandId: COMMAND_ID,
      eventId: EVENT_ID,
      deadlineVersion: 2,
      expectedDeadlineAt: '2026-11-05T03:01:00.000Z',
    });
    expect(deadlineRepo.markDispatchCompleted).toHaveBeenCalledWith(COMMAND_ID, EXECUTION_ARN);
  });

  it('marks terminal execution failures as FAILED for alerting without bypassing command guard', async () => {
    const dispatch = makeDispatch({ status: 'STARTED', execution_arn: EXECUTION_ARN });
    deadlineRepo.findStartedDispatchesForReconcile.mockResolvedValueOnce([dispatch]);
    deadlineRepo.getDispatchEventState
      .mockResolvedValueOnce({
        id: EVENT_ID,
        status: 'NOTIFIED',
        deadline_version: 2,
        escalation_deadline_at: dispatch.expected_deadline_at,
        has_receipt: false,
      })
      .mockResolvedValueOnce({
        id: EVENT_ID,
        status: 'NOTIFIED',
        deadline_version: 2,
        escalation_deadline_at: dispatch.expected_deadline_at,
        has_receipt: false,
      });
    sfnMock.send.mockResolvedValueOnce({
      status: 'FAILED',
      error: 'DeadlineTerminalError',
    });

    const service = new DeadlineStepFunctionsService(
      stepFunctionsConfig,
      deadlineRepo,
      commandService,
      sfnMock as unknown as SFNClient,
    );

    await service.reconcileStartedDispatches();

    expect(commandService.applyCommand).not.toHaveBeenCalled();
    expect(deadlineRepo.markDispatchFailed).toHaveBeenCalledWith(
      COMMAND_ID,
      'EXECUTION_FAILED:DeadlineTerminalError',
      EXECUTION_ARN,
    );
  });

  it('schedules retry on transient StartExecution errors', async () => {
    const dispatch = makeDispatch();
    deadlineRepo.claimNextPendingDispatch.mockResolvedValueOnce({
      dispatch,
      eventState: {
        id: EVENT_ID,
        status: 'NOTIFIED',
        deadline_version: 2,
        escalation_deadline_at: dispatch.expected_deadline_at,
        has_receipt: false,
      },
    });
    sfnMock.send.mockRejectedValueOnce(
      Object.assign(new Error('throttled'), { name: 'ThrottlingException' }),
    );

    const service = new DeadlineStepFunctionsService(
      stepFunctionsConfig,
      deadlineRepo,
      commandService,
      sfnMock as unknown as SFNClient,
    );

    await service.dispatchNextPending();

    expect(deadlineRepo.recordDispatchRetryOrFail).toHaveBeenCalledWith(
      COMMAND_ID,
      'ThrottlingException',
      5,
    );
  });

  it('disables local EscalationDeadlineWorker polling when DEADLINE_DRIVER=stepfunctions', async () => {
    const mockEscalationRepo = {
      getPoolClient: jest.fn(),
      findDueEventsForEscalation: jest.fn(),
    } as unknown as EscalationRepository;

    const worker = new EscalationDeadlineWorkerService(mockEscalationRepo, stepFunctionsConfig);
    worker.onModuleInit();
    const processed = await worker.scanAndProcessDueDeadlines();
    worker.onModuleDestroy();

    expect(processed).toBe(0);
    expect(mockEscalationRepo.getPoolClient).not.toHaveBeenCalled();
    expect(mockEscalationRepo.findDueEventsForEscalation).not.toHaveBeenCalled();
  });

  it('handles local driver mode cleanly as no-op and creates/destroys owned SFN client in stepfunctions mode', async () => {
    const localService = new DeadlineStepFunctionsService(
      new ConfigService({ DEADLINE_DRIVER: 'local' }),
      deadlineRepo,
      commandService,
    );
    expect(localService.isStepFunctionsEnabled()).toBe(false);
    expect(localService.getStateMachineArn()).toBeNull();
    await localService.onModuleInit();
    expect(await localService.adoptPendingDeadlines()).toBe(0);
    expect(await localService.dispatchNextPending()).toBe(false);
    expect(await localService.reconcileStartedDispatches()).toBe(0);
    await localService.onModuleDestroy();

    const ownedClientService = new DeadlineStepFunctionsService(
      stepFunctionsConfig,
      deadlineRepo,
      commandService,
    );
    expect(ownedClientService.isStepFunctionsEnabled()).toBe(true);
    expect(ownedClientService.getStateMachineArn()).toBe(STATE_MACHINE_ARN);
    await ownedClientService.onModuleDestroy();
  });

  it('runs background loop across error recovery, timer sleep, wake, and shutdown', async () => {
    const fastConfig = new ConfigService({
      DEADLINE_DRIVER: 'stepfunctions',
      AWS_REGION: 'ap-southeast-1',
      DEADLINE_STATE_MACHINE_ARN: STATE_MACHINE_ARN,
      DEADLINE_DISPATCH_POLL_MS: '15',
      DEADLINE_RECONCILE_POLL_MS: '5',
    });

    deadlineRepo.adoptPendingLocalDeadlines
      .mockRejectedValueOnce(new Error('transient db glitch'))
      .mockResolvedValueOnce(2)
      .mockResolvedValue(0);

    const service = new DeadlineStepFunctionsService(
      fastConfig,
      deadlineRepo,
      commandService,
      sfnMock as unknown as SFNClient,
    );

    await service.onModuleInit();
    await new Promise((resolve) => setTimeout(resolve, 60));
    service.wake();
    await service.onModuleDestroy();

    expect(deadlineRepo.adoptPendingLocalDeadlines).toHaveBeenCalledWith(STATE_MACHINE_ARN);
    expect(deadlineRepo.findStartedDispatchesForReconcile).toHaveBeenCalled();
  });

  it('covers dispatch edge cases: empty claim, missing executionArn, __type already-exists, reconcile failure, and exhausted retries', async () => {
    const service = new DeadlineStepFunctionsService(
      stepFunctionsConfig,
      deadlineRepo,
      commandService,
      sfnMock as unknown as SFNClient,
    );

    deadlineRepo.claimNextPendingDispatch.mockResolvedValueOnce(null);
    expect(await service.dispatchNextPending()).toBe(false);

    // StartExecution returns without executionArn -> falls back to deriveExecutionArn
    const dispatch = makeDispatch({ state_machine_arn: '' });
    deadlineRepo.claimNextPendingDispatch.mockResolvedValueOnce({
      dispatch,
      eventState: {
        id: EVENT_ID,
        status: 'NOTIFIED',
        deadline_version: 2,
        escalation_deadline_at: dispatch.expected_deadline_at,
        has_receipt: false,
      },
    });
    sfnMock.send.mockResolvedValueOnce({});
    expect(await service.dispatchNextPending()).toBe(true);
    expect(deadlineRepo.markDispatchStarted).toHaveBeenCalledWith(COMMAND_ID, EXECUTION_ARN);

    // __type ExecutionAlreadyExists where DescribeExecution fails -> records RECONCILE_* retry
    deadlineRepo.claimNextPendingDispatch.mockResolvedValueOnce({
      dispatch: makeDispatch(),
      eventState: {
        id: EVENT_ID,
        status: 'NOTIFIED',
        deadline_version: 2,
        escalation_deadline_at: dispatch.expected_deadline_at,
        has_receipt: false,
      },
    });
    sfnMock.send
      .mockRejectedValueOnce({ __type: 'com.amazonaws.swf#ExecutionAlreadyExists' })
      .mockRejectedValueOnce(Object.assign(new Error('throttled'), { code: 'Throttled' }));
    await service.dispatchNextPending();
    expect(deadlineRepo.recordDispatchRetryOrFail).toHaveBeenCalledWith(
      COMMAND_ID,
      'RECONCILE_Throttled',
      5,
    );

    // Exhausted retries (failed: true) and non-Error rejection -> UNKNOWN_ERROR
    deadlineRepo.claimNextPendingDispatch.mockResolvedValueOnce({
      dispatch: makeDispatch(),
      eventState: {
        id: EVENT_ID,
        status: 'NOTIFIED',
        deadline_version: 2,
        escalation_deadline_at: dispatch.expected_deadline_at,
        has_receipt: false,
      },
    });
    sfnMock.send.mockRejectedValueOnce('weird-error-string');
    deadlineRepo.recordDispatchRetryOrFail.mockResolvedValueOnce({ attempts: 5, failed: true });
    await service.dispatchNextPending();
    expect(deadlineRepo.recordDispatchRetryOrFail).toHaveBeenCalledWith(
      COMMAND_ID,
      'UNKNOWN_ERROR',
      5,
    );
  });

  it('covers reconcileStartedDispatches branches: completed early, DescribeExecution error, SUCCEEDED without receipt, TIMED_OUT NOT_DUE/recovery failure, ABORTED', async () => {
    const service = new DeadlineStepFunctionsService(
      stepFunctionsConfig,
      deadlineRepo,
      commandService,
      sfnMock as unknown as SFNClient,
    );

    const baseDispatch = makeDispatch({ status: 'STARTED', execution_arn: null });
    const notifiedState = {
      id: EVENT_ID,
      status: 'NOTIFIED' as const,
      deadline_version: 2,
      escalation_deadline_at: baseDispatch.expected_deadline_at,
      has_receipt: false,
    };

    // 1. Pre-check already resolved -> markDispatchCompleted without DescribeExecution
    deadlineRepo.findStartedDispatchesForReconcile.mockResolvedValueOnce([baseDispatch]);
    deadlineRepo.getDispatchEventState.mockResolvedValueOnce({
      ...notifiedState,
      status: 'RESOLVED',
    });
    expect(await service.reconcileStartedDispatches()).toBe(1);
    expect(deadlineRepo.markDispatchCompleted).toHaveBeenCalledWith(COMMAND_ID, null);

    // 2. DescribeExecution throws -> swallowed and logged
    deadlineRepo.findStartedDispatchesForReconcile.mockResolvedValueOnce([baseDispatch]);
    deadlineRepo.getDispatchEventState.mockResolvedValueOnce(notifiedState);
    sfnMock.send.mockRejectedValueOnce(new Error('Invalid error with spaces!'));
    expect(await service.reconcileStartedDispatches()).toBe(0);

    // 3. SUCCEEDED without DB receipt -> markDispatchFailed
    deadlineRepo.findStartedDispatchesForReconcile.mockResolvedValueOnce([baseDispatch]);
    deadlineRepo.getDispatchEventState
      .mockResolvedValueOnce(notifiedState)
      .mockResolvedValueOnce(notifiedState);
    sfnMock.send.mockResolvedValueOnce({ status: 'SUCCEEDED' });
    await service.reconcileStartedDispatches();
    expect(deadlineRepo.markDispatchFailed).toHaveBeenCalledWith(
      COMMAND_ID,
      'EXECUTION_SUCCEEDED_WITHOUT_DB_RECEIPT',
      EXECUTION_ARN,
    );

    // 4. TIMED_OUT -> applyCommand throws ConflictException(NOT_DUE) -> touchReconciledAt
    deadlineRepo.findStartedDispatchesForReconcile.mockResolvedValueOnce([baseDispatch]);
    deadlineRepo.getDispatchEventState
      .mockResolvedValueOnce(notifiedState)
      .mockResolvedValueOnce(notifiedState);
    sfnMock.send.mockResolvedValueOnce({ status: 'TIMED_OUT' });
    commandService.applyCommand.mockRejectedValueOnce(
      new ConflictException({ code: 'NOT_DUE', retryAt: '2026-11-05T03:02:00Z' }),
    );
    await service.reconcileStartedDispatches();
    expect(deadlineRepo.touchReconciledAt).toHaveBeenCalledWith(COMMAND_ID);

    // 5. TIMED_OUT -> applyCommand throws unexpected error -> markDispatchFailed(RECOVERY_...)
    deadlineRepo.findStartedDispatchesForReconcile.mockResolvedValueOnce([baseDispatch]);
    deadlineRepo.getDispatchEventState
      .mockResolvedValueOnce(notifiedState)
      .mockResolvedValueOnce(notifiedState);
    sfnMock.send.mockResolvedValueOnce({ status: 'TIMED_OUT' });
    commandService.applyCommand.mockRejectedValueOnce(new Error('DB down'));
    await service.reconcileStartedDispatches();
    expect(deadlineRepo.markDispatchFailed).toHaveBeenCalledWith(
      COMMAND_ID,
      'RECOVERY_Error',
      EXECUTION_ARN,
    );

    // 6. ABORTED (no error) -> EXECUTION_ABORTED and undefined status -> EXECUTION_UNKNOWN
    deadlineRepo.findStartedDispatchesForReconcile.mockResolvedValueOnce([
      baseDispatch,
      baseDispatch,
    ]);
    deadlineRepo.getDispatchEventState
      .mockResolvedValueOnce(notifiedState)
      .mockResolvedValueOnce(notifiedState)
      .mockResolvedValueOnce(notifiedState)
      .mockResolvedValueOnce(notifiedState);
    sfnMock.send.mockResolvedValueOnce({ status: 'ABORTED' }).mockResolvedValueOnce({});
    await service.reconcileStartedDispatches();
    expect(deadlineRepo.markDispatchFailed).toHaveBeenCalledWith(
      COMMAND_ID,
      'EXECUTION_ABORTED',
      EXECUTION_ARN,
    );
    expect(deadlineRepo.markDispatchFailed).toHaveBeenCalledWith(
      COMMAND_ID,
      'EXECUTION_UNKNOWN',
      EXECUTION_ARN,
    );
  });
});
