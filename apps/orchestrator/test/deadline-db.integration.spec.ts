import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SFNClient } from '@aws-sdk/client-sfn';
import { Pool } from 'pg';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { EscalationRepository } from '../src/escalation/escalation.repository';
import { EscalationEngineService } from '../src/escalation/escalation-engine.service';
import { EscalationDeadlineWorkerService } from '../src/escalation/escalation-deadline-worker.service';
import { EscalationRulesRepository } from '../src/escalation-rules/escalation-rules.repository';
import { DeadlineRepository } from '../src/escalation/deadline.repository';
import { DeadlineCommandService } from '../src/escalation/deadline-command.service';
import { DeadlineStepFunctionsService } from '../src/escalation/deadline-stepfunctions.service';

jest.setTimeout(180000);

const STATE_MACHINE_ARN =
  'arn:aws:states:ap-southeast-1:926883321040:stateMachine:argusai-staging-deadline';

describe('Deadline Step Functions PostgreSQL integration (US-13 / AWS-06)', () => {
  let container: StartedTestContainer | undefined;
  let pool: Pool;
  let escalationRepo: EscalationRepository;
  let deadlineRepo: DeadlineRepository;
  let deadlineCommandService: DeadlineCommandService;
  let escalationEngine: EscalationEngineService;
  let stepFunctionsService: DeadlineStepFunctionsService;

  const ownerId = randomUUID();
  const deviceId = randomUUID();
  const cameraId = randomUUID();

  beforeAll(async () => {
    container = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({ POSTGRES_USER: 'test', POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'test' })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
      .start();

    pool = new Pool({
      host: container.getHost(),
      port: container.getMappedPort(5432),
      user: 'test',
      password: 'test',
      database: 'test',
    });

    const migrationsDir = resolve(__dirname, '../../../db/migrations');
    for (const file of readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort()) {
      await pool.query(readFileSync(resolve(migrationsDir, file), 'utf8'));
    }

    await pool.query(
      `INSERT INTO users(id, email, password_hash, full_name, role)
       VALUES ($1, 'deadline-owner@example.test', 'hash', 'Deadline Owner', 'ADMIN')`,
      [ownerId],
    );
    await pool.query(
      `INSERT INTO devices(id, owner_user_id, name, status)
       VALUES ($1, $2, 'cam-dev', 'ONLINE')`,
      [deviceId, ownerId],
    );
    await pool.query(
      `INSERT INTO cameras(id, device_id, name, slug, rtsp_url)
       VALUES ($1, $2, 'Front', 'front', 'rtsp://example.test/front')`,
      [cameraId, deviceId],
    );

    escalationRepo = new EscalationRepository(pool);
    deadlineRepo = new DeadlineRepository(pool);
    deadlineCommandService = new DeadlineCommandService(escalationRepo, deadlineRepo);
    const rulesRepo = new EscalationRulesRepository(pool);
    const sfnConfig = new ConfigService({
      DEADLINE_DRIVER: 'stepfunctions',
      AWS_REGION: 'ap-southeast-1',
      DEADLINE_STATE_MACHINE_ARN: STATE_MACHINE_ARN,
    });
    const fakeSfn = { send: jest.fn(), destroy: jest.fn() } as unknown as SFNClient;
    stepFunctionsService = new DeadlineStepFunctionsService(
      sfnConfig,
      deadlineRepo,
      deadlineCommandService,
      fakeSfn,
    );
    escalationEngine = new EscalationEngineService(
      escalationRepo,
      rulesRepo,
      deadlineRepo,
      stepFunctionsService,
    );
  });

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  async function seedDetectedEvent(detectedAt: Date): Promise<string> {
    const eventId = randomUUID();
    await pool.query(
      `INSERT INTO events(id, camera_id, event_type, status, priority, detected_at)
       VALUES ($1, $2, 'FALL_DETECTED', 'DETECTED', 'P1', $3)`,
      [eventId, cameraId, detectedAt],
    );
    return eventId;
  }

  it('atomically bumps deadline_version and enqueues Step Functions dispatch on NOTIFIED transition', async () => {
    const detectedAt = new Date(Date.now() + 120_000);
    const eventId = await seedDetectedEvent(detectedAt);

    const updated = await escalationEngine.evaluateAndTransition(eventId, {
      eventType: 'FALL_DETECTED',
      confidence: 0.65,
      detectedAt,
    });

    expect(updated.status).toBe('NOTIFIED');
    expect(updated.deadline_version).toBe(2);

    const dispatches = await pool.query(
      'SELECT * FROM deadline_workflow_dispatches WHERE event_id = $1',
      [eventId],
    );
    expect(dispatches.rows).toHaveLength(1);
    expect(dispatches.rows[0].deadline_version).toBe(2);
    expect(dispatches.rows[0].status).toBe('PENDING');
    expect(dispatches.rows[0].execution_name).toBe(`deadline-${dispatches.rows[0].command_id}`);
  });

  it('enforces NOT_DUE without receipt, then APPLIED on due, idempotent replay, and COMMAND_CONFLICT', async () => {
    const detectedAt = new Date(Date.now() + 60_000);
    const eventId = await seedDetectedEvent(detectedAt);
    await escalationEngine.evaluateAndTransition(eventId, {
      eventType: 'FALL_DETECTED',
      confidence: 0.65,
      detectedAt,
    });

    const dispatch = (
      await pool.query('SELECT * FROM deadline_workflow_dispatches WHERE event_id = $1', [eventId])
    ).rows[0];
    const command = {
      schemaVersion: 1 as const,
      commandId: dispatch.command_id as string,
      eventId,
      deadlineVersion: dispatch.deadline_version as number,
      expectedDeadlineAt: (dispatch.expected_deadline_at as Date).toISOString(),
    };

    // 1. Early invocation -> 409 NOT_DUE, no receipt persisted
    try {
      await deadlineCommandService.applyCommand(eventId, command);
      fail('Expected NOT_DUE');
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'NOT_DUE',
        retryAt: command.expectedDeadlineAt,
      });
    }
    expect(
      (
        await pool.query('SELECT * FROM deadline_command_receipts WHERE command_id = $1', [
          command.commandId,
        ])
      ).rows,
    ).toHaveLength(0);

    // 2. Move DB deadline into the past so DB clock sees it as due
    await pool.query(
      `UPDATE events SET escalation_deadline_at = now() - interval '2 seconds' WHERE id = $1`,
      [eventId],
    );

    const applied = await deadlineCommandService.applyCommand(eventId, command);
    expect(applied).toEqual({
      commandId: command.commandId,
      disposition: 'APPLIED',
      reason: 'ESCALATED',
      aggregateVersion: 3,
    });

    const intentsAfterFirst = await pool.query(
      `SELECT id FROM notifications WHERE event_id = $1 AND escalation_level = 1`,
      [eventId],
    );
    expect(intentsAfterFirst.rows).toHaveLength(1);

    // 3. Replay identical command -> same 200 decision, still only 1 intent
    const replayed = await deadlineCommandService.applyCommand(eventId, command);
    expect(replayed).toEqual(applied);
    const intentsAfterReplay = await pool.query(
      `SELECT id FROM notifications WHERE event_id = $1 AND escalation_level = 1`,
      [eventId],
    );
    expect(intentsAfterReplay.rows).toHaveLength(1);

    // 4. Reuse commandId with different payload -> 409 COMMAND_CONFLICT
    try {
      await deadlineCommandService.applyCommand(eventId, {
        ...command,
        deadlineVersion: command.deadlineVersion + 1,
      });
      fail('Expected COMMAND_CONFLICT');
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'COMMAND_CONFLICT',
      });
    }

    // 5. Dispatch row marked COMPLETED
    const updatedDispatch = (
      await pool.query('SELECT status FROM deadline_workflow_dispatches WHERE command_id = $1', [
        command.commandId,
      ])
    ).rows[0];
    expect(updatedDispatch.status).toBe('COMPLETED');
  });

  it('serializes concurrent Ack (IM_OK) and Deadline command so exactly one wins', async () => {
    const detectedAt = new Date(Date.now() - 120_000);
    const eventId = await seedDetectedEvent(detectedAt);
    await escalationEngine.evaluateAndTransition(eventId, {
      eventType: 'FALL_DETECTED',
      confidence: 0.65,
      detectedAt,
    });

    const dispatch = (
      await pool.query('SELECT * FROM deadline_workflow_dispatches WHERE event_id = $1', [eventId])
    ).rows[0];
    const command = {
      schemaVersion: 1 as const,
      commandId: dispatch.command_id as string,
      eventId,
      deadlineVersion: dispatch.deadline_version as number,
      expectedDeadlineAt: (dispatch.expected_deadline_at as Date).toISOString(),
    };

    const [ackOutcome, deadlineOutcome] = await Promise.allSettled([
      escalationEngine.confirmInitial(eventId, ownerId, { response: 'IM_OK' }),
      deadlineCommandService.applyCommand(eventId, command),
    ]);

    expect(deadlineOutcome.status).toBe('fulfilled');
    if (deadlineOutcome.status !== 'fulfilled') return;

    const eventRow = (await pool.query('SELECT status FROM events WHERE id = $1', [eventId]))
      .rows[0];
    const escalationIntents = (
      await pool.query(
        `SELECT id FROM notifications WHERE event_id = $1 AND escalation_level = 1`,
        [eventId],
      )
    ).rows;

    if (ackOutcome.status === 'fulfilled') {
      // Ack committed first -> event RESOLVED, deadline returned NO_OP/RESOLVED, 0 escalation intents
      expect(eventRow.status).toBe('RESOLVED');
      expect(deadlineOutcome.value).toMatchObject({
        commandId: command.commandId,
        disposition: 'NO_OP',
        reason: 'RESOLVED',
      });
      expect(escalationIntents).toHaveLength(0);
    } else {
      // Deadline committed first -> event ESCALATED, 1 escalation intent, Ack rejected with ConflictException
      expect(ackOutcome.reason).toBeInstanceOf(ConflictException);
      expect(eventRow.status).toBe('ESCALATED');
      expect(deadlineOutcome.value).toMatchObject({
        commandId: command.commandId,
        disposition: 'APPLIED',
        reason: 'ESCALATED',
      });
      expect(escalationIntents).toHaveLength(1);
    }
  });

  it('prevents local poller from double-escalating cloud-dispatched deadlines even in local mode', async () => {
    const detectedAt = new Date(Date.now() - 120_000);
    const eventId = await seedDetectedEvent(detectedAt);
    await escalationEngine.evaluateAndTransition(eventId, {
      eventType: 'FALL_DETECTED',
      confidence: 0.65,
      detectedAt,
    });

    const localWorker = new EscalationDeadlineWorkerService(
      escalationRepo,
      new ConfigService({ DEADLINE_DRIVER: 'local' }),
    );
    const processed = await localWorker.scanAndProcessDueDeadlines();
    expect(processed).toBe(0);

    const status = (await pool.query('SELECT status FROM events WHERE id = $1', [eventId])).rows[0]
      .status;
    expect(status).toBe('NOTIFIED');
  });
  it('blocks driver handoff for FAILED cloud deadlines, recovers once, then allows local startup', async () => {
    const eventId = await seedDetectedEvent(new Date(Date.now() - 120000));
    await escalationEngine.evaluateAndTransition(eventId, {
      eventType: 'FALL_DETECTED',
      confidence: 0.65,
      detectedAt: new Date(Date.now() - 120000),
    });
    await pool.query(
      "UPDATE deadline_workflow_dispatches SET status='FAILED', available_at=now()-interval '1 second' WHERE event_id=$1",
      [eventId],
    );
    await expect(deadlineRepo.assertLocalDriverSafe()).rejects.toThrow('drain/reconcile');
    await stepFunctionsService.reconcileStartedDispatches();
    await stepFunctionsService.reconcileStartedDispatches();
    const result = await pool.query('SELECT status FROM events WHERE id=$1', [eventId]);
    expect(result.rows[0].status).toBe('ESCALATED');
    const notifications = await pool.query(
      'SELECT id FROM notifications WHERE event_id=$1 AND escalation_level=1',
      [eventId],
    );
    expect(notifications.rows).toHaveLength(1);
    // Finish other test-owned deadlines before checking global mode handoff.
    await pool.query(
      "UPDATE events SET status='CLOSED', escalation_deadline_at=NULL WHERE camera_id=$1 AND status='NOTIFIED'",
      [cameraId],
    );
    await expect(deadlineRepo.assertLocalDriverSafe()).resolves.toBeUndefined();
  });
});
