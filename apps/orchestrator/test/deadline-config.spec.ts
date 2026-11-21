import { ConfigService } from '@nestjs/config';
import { deriveExecutionArn, readDeadlineConfig } from '../src/escalation/deadline-config';
import { buildDeadlineCommandPayload } from '../src/escalation/dto/deadline-command.dto';

describe('readDeadlineConfig (US-13 / AWS-06)', () => {
  const validArn =
    'arn:aws:states:ap-southeast-1:926883321040:stateMachine:argusai-staging-deadline';

  it('defaults to local driver when DEADLINE_DRIVER is unset or empty', () => {
    expect(readDeadlineConfig(new ConfigService({}))).toEqual({ driver: 'local' });
    expect(readDeadlineConfig(new ConfigService({ DEADLINE_DRIVER: '   ' }))).toEqual({
      driver: 'local',
    });
    expect(readDeadlineConfig(new ConfigService({ DEADLINE_DRIVER: 'local' }))).toEqual({
      driver: 'local',
    });
  });

  it('rejects unknown DEADLINE_DRIVER values', () => {
    expect(() => readDeadlineConfig(new ConfigService({ DEADLINE_DRIVER: 'sqs' }))).toThrow(
      'DEADLINE_DRIVER must be local or stepfunctions',
    );
  });

  it('fails fast when stepfunctions driver is missing AWS_REGION or valid state machine ARN', () => {
    expect(() =>
      readDeadlineConfig(
        new ConfigService({
          DEADLINE_DRIVER: 'stepfunctions',
          DEADLINE_STATE_MACHINE_ARN: validArn,
        }),
      ),
    ).toThrow('AWS_REGION');

    expect(() =>
      readDeadlineConfig(
        new ConfigService({
          DEADLINE_DRIVER: 'stepfunctions',
          AWS_REGION: 'ap-southeast-1',
        }),
      ),
    ).toThrow('DEADLINE_STATE_MACHINE_ARN');

    expect(() =>
      readDeadlineConfig(
        new ConfigService({
          DEADLINE_DRIVER: 'stepfunctions',
          AWS_REGION: 'ap-southeast-1',
          DEADLINE_STATE_MACHINE_ARN: 'not-an-arn',
        }),
      ),
    ).toThrow('valid AWS Step Functions ARN');

    expect(() =>
      readDeadlineConfig(
        new ConfigService({
          DEADLINE_DRIVER: 'stepfunctions',
          AWS_REGION: 'us-east-1',
          DEADLINE_STATE_MACHINE_ARN: validArn,
        }),
      ),
    ).toThrow('region must match AWS_REGION');
  });

  it('returns validated stepfunctions settings with defaults and overrides', () => {
    expect(
      readDeadlineConfig(
        new ConfigService({
          DEADLINE_DRIVER: 'stepfunctions',
          AWS_REGION: 'ap-southeast-1',
          DEADLINE_STATE_MACHINE_ARN: validArn,
          DEADLINE_DISPATCH_POLL_MS: '1500',
          DEADLINE_RECONCILE_POLL_MS: '45000',
          DEADLINE_DISPATCH_MAX_ATTEMPTS: '7',
        }),
      ),
    ).toEqual({
      driver: 'stepfunctions',
      region: 'ap-southeast-1',
      stateMachineArn: validArn,
      dispatchPollMs: 1500,
      reconcilePollMs: 45000,
      maxDispatchAttempts: 7,
    });
  });

  it('derives deterministic execution ARN from state machine ARN and execution name', () => {
    expect(deriveExecutionArn(validArn, 'deadline-00000000-0000-4000-8000-000000000010')).toBe(
      'arn:aws:states:ap-southeast-1:926883321040:execution:argusai-staging-deadline:deadline-00000000-0000-4000-8000-000000000010',
    );
  });

  it('rejects non-integer or non-positive poll/attempt overrides and builds string payloads', () => {
    for (const badValue of ['0', '-5', '1.5', 'not-a-number']) {
      expect(() =>
        readDeadlineConfig(
          new ConfigService({
            DEADLINE_DRIVER: 'stepfunctions',
            AWS_REGION: 'ap-southeast-1',
            DEADLINE_STATE_MACHINE_ARN: validArn,
            DEADLINE_DISPATCH_POLL_MS: badValue,
          }),
        ),
      ).toThrow('DEADLINE_DISPATCH_POLL_MS must be a positive integer');
    }

    expect(
      buildDeadlineCommandPayload({
        commandId: '00000000-0000-4000-8000-000000000010',
        eventId: '00000000-0000-4000-8000-000000000003',
        deadlineVersion: 1,
        expectedDeadlineAt: '2026-11-05T03:01:00Z',
      }),
    ).toEqual({
      schemaVersion: 1,
      commandId: '00000000-0000-4000-8000-000000000010',
      eventId: '00000000-0000-4000-8000-000000000003',
      deadlineVersion: 1,
      expectedDeadlineAt: '2026-11-05T03:01:00Z',
    });
  });
});
