import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DescribeExecutionCommand, SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { deriveExecutionArn, readDeadlineConfig, type DeadlineConfig } from './deadline-config';
import { DeadlineRepository, type DeadlineDispatchRecord } from './deadline.repository';
import { DeadlineCommandService } from './deadline-command.service';
import { buildDeadlineCommandPayload } from './dto/deadline-command.dto';

export const DEADLINE_SFN_CLIENT = 'DEADLINE_SFN_CLIENT';

const RETRYABLE_EXECUTION_ERRORS = new Set([
  'DeadlineRetryable',
  'States.Timeout',
  'Sandbox.Timedout',
  'Lambda.ServiceException',
  'Lambda.AWSLambdaException',
  'Lambda.SdkClientException',
  'Lambda.TooManyRequestsException',
]);

function safeErrorCode(error: unknown): string {
  const raw =
    error instanceof Error
      ? 'code' in error && typeof (error as { code?: unknown }).code === 'string'
        ? (error as { code: string }).code
        : error.name
      : 'UNKNOWN_ERROR';
  return /^[A-Za-z0-9_.:-]{1,80}$/.test(raw) ? raw : 'UNKNOWN_ERROR';
}

function isExecutionAlreadyExistsError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const err = error as { name?: string; __type?: string };
  return (
    err.name === 'ExecutionAlreadyExists' ||
    (typeof err.__type === 'string' && err.__type.includes('ExecutionAlreadyExists'))
  );
}

@Injectable()
export class DeadlineStepFunctionsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DeadlineStepFunctionsService.name);
  private readonly config: DeadlineConfig;
  private readonly sfn?: SFNClient;
  private readonly ownsSfnClient: boolean;
  private stopped = false;
  private loopPromise?: Promise<void>;
  private delayTimer?: ReturnType<typeof setTimeout>;
  private wakeResolver?: () => void;
  private lastReconcileAt = 0;

  constructor(
    configService: ConfigService,
    private readonly deadlineRepository: DeadlineRepository,
    private readonly deadlineCommandService: DeadlineCommandService,
    @Optional() @Inject(DEADLINE_SFN_CLIENT) injectedSfn?: SFNClient,
  ) {
    this.config = readDeadlineConfig(configService);
    if (this.config.driver === 'stepfunctions') {
      if (injectedSfn) {
        this.sfn = injectedSfn;
        this.ownsSfnClient = false;
      } else {
        this.sfn = new SFNClient({ region: this.config.region, maxAttempts: 3 });
        this.ownsSfnClient = true;
      }
    } else {
      this.ownsSfnClient = false;
    }
  }

  isStepFunctionsEnabled(): boolean {
    return this.config.driver === 'stepfunctions';
  }

  getStateMachineArn(): string | null {
    return this.config.driver === 'stepfunctions' ? this.config.stateMachineArn : null;
  }

  wake(): void {
    if (this.delayTimer) {
      clearTimeout(this.delayTimer);
      this.delayTimer = undefined;
    }
    this.wakeResolver?.();
    this.wakeResolver = undefined;
  }

  async onModuleInit(): Promise<void> {
    if (this.config.driver !== 'stepfunctions') {
      await this.deadlineRepository.assertLocalDriverSafe();
      this.logger.log('DEADLINE_DRIVER=local — Step Functions deadline dispatcher tắt');
      return;
    }

    this.logger.log(
      `DEADLINE_DRIVER=stepfunctions — khởi động Step Functions dispatcher (dispatch=${this.config.dispatchPollMs}ms, reconcile=${this.config.reconcilePollMs}ms)`,
    );
    this.loopPromise = this.runLoop();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    this.wake();
    await this.loopPromise;
    if (this.ownsSfnClient) {
      this.sfn?.destroy();
    }
  }

  private async runLoop(): Promise<void> {
    if (this.config.driver !== 'stepfunctions') {
      return;
    }
    const { dispatchPollMs, reconcilePollMs } = this.config;

    while (!this.stopped) {
      try {
        const now = Date.now();
        if (now - this.lastReconcileAt >= reconcilePollMs) {
          await this.adoptPendingDeadlines();
          await this.reconcileStartedDispatches();
          this.lastReconcileAt = now;
        }

        while (!this.stopped && (await this.dispatchNextPending())) {
          // Drain available pending dispatches promptly without holding DB transactions during AWS calls.
        }
      } catch (error) {
        this.logger.error(
          `Step Functions deadline loop error (${safeErrorCode(error)}); retrying next cycle`,
        );
      }

      if (!this.stopped) {
        await new Promise<void>((resolve) => {
          this.wakeResolver = resolve;
          this.delayTimer = setTimeout(() => {
            this.wakeResolver = undefined;
            this.delayTimer = undefined;
            resolve();
          }, dispatchPollMs);
        });
      }
    }
  }

  async adoptPendingDeadlines(): Promise<number> {
    if (this.config.driver !== 'stepfunctions') {
      return 0;
    }
    const adopted = await this.deadlineRepository.adoptPendingLocalDeadlines(
      this.config.stateMachineArn,
    );
    if (adopted > 0) {
      this.logger.log(`Adopted ${adopted} pre-existing pending deadline(s) into Step Functions`);
    }
    return adopted;
  }

  /**
   * Claims one PENDING dispatch in a short DB tx, invokes StartExecution OUTSIDE the DB tx,
   * and reconciles ExecutionAlreadyExists / transient errors durably.
   */
  async dispatchNextPending(): Promise<boolean> {
    if (this.config.driver !== 'stepfunctions' || !this.sfn) {
      return false;
    }

    const claimed = await this.deadlineRepository.claimNextPendingDispatch();
    if (!claimed) {
      return false;
    }

    const { dispatch } = claimed;
    const stateMachineArn = dispatch.state_machine_arn || this.config.stateMachineArn;
    const command = buildDeadlineCommandPayload({
      commandId: dispatch.command_id,
      eventId: dispatch.event_id,
      deadlineVersion: dispatch.deadline_version,
      expectedDeadlineAt: dispatch.expected_deadline_at,
    });

    try {
      const started = await this.sfn.send(
        new StartExecutionCommand({
          stateMachineArn,
          name: dispatch.execution_name,
          input: JSON.stringify(command),
        }),
      );
      const executionArn =
        started.executionArn ?? deriveExecutionArn(stateMachineArn, dispatch.execution_name);
      await this.deadlineRepository.markDispatchStarted(dispatch.command_id, executionArn);
      this.logger.log(
        {
          commandId: dispatch.command_id,
          eventId: dispatch.event_id,
          deadlineVersion: dispatch.deadline_version,
          executionName: dispatch.execution_name,
          executionArn,
        },
        'Started Step Functions deadline execution',
      );
      return true;
    } catch (error) {
      if (isExecutionAlreadyExistsError(error)) {
        await this.reconcileAlreadyExists(dispatch, stateMachineArn);
        return true;
      }

      const code = safeErrorCode(error);
      const result = await this.deadlineRepository.recordDispatchRetryOrFail(
        dispatch.command_id,
        code,
        this.config.maxDispatchAttempts,
      );
      this.logger.warn(
        {
          commandId: dispatch.command_id,
          eventId: dispatch.event_id,
          attempts: result.attempts,
          failed: result.failed,
          errorCode: code,
        },
        result.failed
          ? 'Step Functions StartExecution exhausted retries; marked FAILED for reconciliation'
          : 'Step Functions StartExecution failed transiently; scheduled retry',
      );
      return true;
    }
  }

  private async reconcileAlreadyExists(
    dispatch: DeadlineDispatchRecord,
    stateMachineArn: string,
  ): Promise<void> {
    if (this.config.driver !== 'stepfunctions' || !this.sfn) {
      return;
    }

    const executionArn =
      dispatch.execution_arn ?? deriveExecutionArn(stateMachineArn, dispatch.execution_name);

    try {
      await this.reconcileExecution(dispatch, executionArn);
    } catch (error) {
      const code = safeErrorCode(error);
      await this.deadlineRepository.recordDispatchRetryOrFail(
        dispatch.command_id,
        `RECONCILE_${code}`,
        this.config.maxDispatchAttempts,
      );
      this.logger.warn(
        {
          commandId: dispatch.command_id,
          eventId: dispatch.event_id,
          executionArn,
          errorCode: code,
        },
        'DescribeExecution during ExecutionAlreadyExists reconciliation failed transiently',
      );
    }
  }

  async reconcileStartedDispatches(): Promise<number> {
    if (this.config.driver !== 'stepfunctions' || !this.sfn) {
      return 0;
    }

    const dispatches = await this.deadlineRepository.findStartedDispatchesForReconcile();
    let reconciledCount = 0;

    for (const dispatch of dispatches) {
      const eventState = await this.deadlineRepository.getDispatchEventState(
        dispatch.event_id,
        dispatch.command_id,
      );

      if (
        !eventState ||
        eventState.has_receipt ||
        eventState.status !== 'NOTIFIED' ||
        eventState.deadline_version !== dispatch.deadline_version
      ) {
        await this.deadlineRepository.markDispatchCompleted(
          dispatch.command_id,
          dispatch.execution_arn,
        );
        reconciledCount += 1;
        continue;
      }

      const stateMachineArn = dispatch.state_machine_arn || this.config.stateMachineArn;
      const executionArn =
        dispatch.execution_arn ?? deriveExecutionArn(stateMachineArn, dispatch.execution_name);

      try {
        if (dispatch.status === 'FAILED') {
          await this.recoverDispatch(dispatch, executionArn);
        } else {
          await this.reconcileExecution(dispatch, executionArn);
        }
        reconciledCount += 1;
      } catch (error) {
        this.logger.warn(
          {
            commandId: dispatch.command_id,
            eventId: dispatch.event_id,
            executionArn,
            errorCode: safeErrorCode(error),
          },
          'DescribeExecution failed while reconciling started deadline execution',
        );
      }
    }

    return reconciledCount;
  }

  private async reconcileExecution(
    dispatch: DeadlineDispatchRecord,
    executionArn: string,
  ): Promise<void> {
    if (!this.sfn) {
      return;
    }

    const described = await this.sfn.send(new DescribeExecutionCommand({ executionArn }));
    const execStatus = described.status;

    if (execStatus === 'RUNNING') {
      await this.deadlineRepository.markDispatchStarted(dispatch.command_id, executionArn);
      return;
    }

    const eventState = await this.deadlineRepository.getDispatchEventState(
      dispatch.event_id,
      dispatch.command_id,
    );
    if (
      !eventState ||
      eventState.has_receipt ||
      eventState.status !== 'NOTIFIED' ||
      eventState.deadline_version !== dispatch.deadline_version
    ) {
      await this.deadlineRepository.markDispatchCompleted(dispatch.command_id, executionArn);
      return;
    }

    if (execStatus === 'SUCCEEDED') {
      await this.deadlineRepository.markDispatchFailed(
        dispatch.command_id,
        'EXECUTION_SUCCEEDED_WITHOUT_DB_RECEIPT',
        executionArn,
      );
      this.logger.error(
        {
          commandId: dispatch.command_id,
          eventId: dispatch.event_id,
          executionArn,
        },
        'Step Functions execution SUCCEEDED but event is still NOTIFIED without receipt',
      );
      return;
    }

    const executionError = described.error ?? '';
    const isRecoverableFailure =
      execStatus === 'TIMED_OUT' ||
      (execStatus === 'FAILED' && RETRYABLE_EXECUTION_ERRORS.has(executionError));

    if (isRecoverableFailure) {
      await this.recoverDispatch(dispatch, executionArn);
      return;
    }

    const failureReason = `EXECUTION_${execStatus ?? 'UNKNOWN'}${executionError ? `:${executionError}` : ''}`;
    await this.deadlineRepository.markDispatchFailed(
      dispatch.command_id,
      failureReason.slice(0, 120),
      executionArn,
    );
    this.logger.error(
      {
        commandId: dispatch.command_id,
        eventId: dispatch.event_id,
        executionArn,
        executionStatus: execStatus,
        executionError: executionError || null,
      },
      'Step Functions deadline execution ended in terminal failure; requires reconciliation',
    );
  }
  private async recoverDispatch(
    dispatch: DeadlineDispatchRecord,
    executionArn: string,
  ): Promise<void> {
    const command = buildDeadlineCommandPayload({
      commandId: dispatch.command_id,
      eventId: dispatch.event_id,
      deadlineVersion: dispatch.deadline_version,
      expectedDeadlineAt: dispatch.expected_deadline_at,
    });
    try {
      await this.deadlineCommandService.applyCommand(dispatch.event_id, command);
      await this.deadlineRepository.markDispatchCompleted(dispatch.command_id, executionArn);
    } catch (error) {
      // Preserve ownership and retry eligibility even when the DB is temporarily unavailable.
      await this.deadlineRepository.touchReconciledAt(dispatch.command_id);
      this.logger.warn(
        { commandId: dispatch.command_id, errorCode: safeErrorCode(error) },
        'Deadline recovery deferred; retrying shared idempotent command',
      );
    }
  }
}
