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
});
