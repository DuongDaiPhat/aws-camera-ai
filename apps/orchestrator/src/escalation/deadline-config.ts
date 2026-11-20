import { ConfigService } from '@nestjs/config';

export type DeadlineDriver = 'local' | 'stepfunctions';

export interface LocalDeadlineConfig {
  readonly driver: 'local';
}

export interface StepFunctionsDeadlineConfig {
  readonly driver: 'stepfunctions';
  readonly region: string;
  readonly stateMachineArn: string;
  readonly dispatchPollMs: number;
  readonly reconcilePollMs: number;
  readonly maxDispatchAttempts: number;
}

export type DeadlineConfig = LocalDeadlineConfig | StepFunctionsDeadlineConfig;

const AWS_REGION_PATTERN = /^[a-z]{2}-[a-z]+-\d$/;
const STATE_MACHINE_ARN_PATTERN =
  /^arn:aws(?:-[a-z]+)?:states:([a-z]{2}-[a-z]+-\d):\d{12}:stateMachine:[A-Za-z0-9._-]+$/;

function readPositiveInt(config: ConfigService, key: string, fallback: number): number {
  const raw = config.get<string | number>(key);
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${key} must be a positive integer`);
  }
  return parsed;
}

export function readDeadlineConfig(config: ConfigService): DeadlineConfig {
  const rawDriver = config.get<string>('DEADLINE_DRIVER')?.trim();
  const driver = rawDriver ? rawDriver.toLowerCase() : 'local';

  if (driver !== 'local' && driver !== 'stepfunctions') {
    throw new Error('DEADLINE_DRIVER must be local or stepfunctions');
  }

  if (driver === 'local') {
    return { driver: 'local' };
  }

  const region = config.get<string>('AWS_REGION')?.trim();
  if (!region || !AWS_REGION_PATTERN.test(region)) {
    throw new Error('DEADLINE_DRIVER=stepfunctions requires a valid AWS_REGION');
  }

  const stateMachineArn = config.get<string>('DEADLINE_STATE_MACHINE_ARN')?.trim();
  if (!stateMachineArn) {
    throw new Error('Missing cloud configuration: DEADLINE_STATE_MACHINE_ARN');
  }

  const arnMatch = STATE_MACHINE_ARN_PATTERN.exec(stateMachineArn);
  if (!arnMatch) {
    throw new Error('DEADLINE_STATE_MACHINE_ARN must be a valid AWS Step Functions ARN');
  }
  if (arnMatch[1] !== region) {
    throw new Error('DEADLINE_STATE_MACHINE_ARN region must match AWS_REGION');
  }

  return {
    driver: 'stepfunctions',
    region,
    stateMachineArn,
    dispatchPollMs: readPositiveInt(config, 'DEADLINE_DISPATCH_POLL_MS', 2000),
    reconcilePollMs: readPositiveInt(config, 'DEADLINE_RECONCILE_POLL_MS', 30000),
    maxDispatchAttempts: readPositiveInt(config, 'DEADLINE_DISPATCH_MAX_ATTEMPTS', 5),
  };
}

export function deriveExecutionArn(stateMachineArn: string, executionName: string): string {
  return `${stateMachineArn.replace(':stateMachine:', ':execution:')}:${executionName}`;
}
