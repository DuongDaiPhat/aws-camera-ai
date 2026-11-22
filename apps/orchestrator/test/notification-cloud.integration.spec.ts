import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { DatabaseService } from '../src/database/database.service';
import { EscalationRepository } from '../src/escalation/escalation.repository';
import { NotificationCloudService } from '../src/notification-cloud/notification-cloud.service';
import type {
  ClaimRequest,
  OutcomeEnvelope,
} from '../src/notification-cloud/notification-cloud.types';
import type { NotificationJob } from '../src/cloud-queue/queue-contract';

jest.setTimeout(180000);

describe('cloud notifications in PostgreSQL', () => {
  let container: StartedTestContainer | undefined;
  let fixtureAdmin: Pool | undefined;
  let pool: Pool;
  let db: DatabaseService;
  const fixtureName = 'notification_test_' + randomUUID().replace(/-/g, '');
  const owner = randomUUID();
  const device = randomUUID();
  const camera = randomUUID();
  const contact = randomUUID();
  const alternateContact = randomUUID();
  const foreignUser = randomUUID();
  const topic = 'arn:aws:sns:ap-southeast-1:123456789012:camerai-dev-notification';
  const phone = '+15550100234';

  beforeAll(async () => {
    const fixtureUrl = process.env.CAMERAI_NOTIFICATION_TEST_DATABASE_URL;
    if (fixtureUrl) {
      const url = new URL(fixtureUrl);
      fixtureAdmin = new Pool({ connectionString: fixtureUrl });
      await fixtureAdmin.query(`CREATE DATABASE ${fixtureName}`);
      url.pathname = '/' + fixtureName;
      pool = new Pool({ connectionString: url.toString() });
    } else {
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
    }
    db = new DatabaseService(pool);
    const migrations = resolve(__dirname, '../../../db/migrations');
    for (const file of readdirSync(migrations)
      .filter((name) => name.endsWith('.sql'))
      .sort()) {
      await pool.query(readFileSync(resolve(migrations, file), 'utf8'));
    }
    await pool.query(
      `INSERT INTO users(id,email,password_hash,full_name,role,phone_e164)
       VALUES ($1,'owner@example.test','hash','Owner','ADMIN',$3),
              ($2,'foreign@example.test','hash','Other owner','ADMIN',$3)`,
      [owner, foreignUser, phone],
    );
    await pool.query("INSERT INTO devices(id,owner_user_id,name) VALUES ($1,$2,'Fixture')", [
      device,
      owner,
    ]);
    await pool.query(
      "INSERT INTO cameras(id,device_id,name,slug,rtsp_url) VALUES ($1,$2,'Fixture','fixture','rtsp://example.test/fixture')",
      [camera, device],
    );
    await pool.query(
      `INSERT INTO emergency_contacts(id,owner_user_id,name,phone_e164,is_verified,priority_order)
       VALUES ($1,$2,'Fixture contact',$3,true,1),
              ($4,$2,'Alternate contact',$3,true,2)`,
      [contact, owner, phone, alternateContact],
    );
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE events, cloud_notification_routes CASCADE');
    await pool.query("UPDATE cloud_transport_mode SET mode='bullmq', notification_driver='sqs'");
  });

  afterAll(async () => {
    await pool?.end();
    if (fixtureAdmin) {
      await fixtureAdmin.query(`DROP DATABASE IF EXISTS ${fixtureName}`);
      await fixtureAdmin.end();
    }
    await container?.stop();
  });

  function service(overrides: Record<string, string> = {}) {
    return new NotificationCloudService(
      new ConfigService({
        NOTIFICATION_DRIVER: 'sqs',
        APP_ENV: 'dev',
        SENDER_DRY_RUN: 'false',
        SNS_TOPIC_ARN: topic,
        ...overrides,
      }),
      db,
    );
  }

  async function allow(
    channel: NotificationJob['channel'] = 'SNS_EMAIL',
    recipientRef = `user:${owner}`,
    destination = channel === 'SNS_EMAIL' ? 'owner@example.test' : phone,
  ) {
    await pool.query(
      `INSERT INTO cloud_notification_routes(owner_user_id,recipient_ref,channel,destination,
        topic_arn,enabled,verified_at)
       VALUES ($1,$2,$3,$4,$5,true,clock_timestamp())`,
      [owner, recipientRef, channel, destination, channel === 'SNS_EMAIL' ? topic : null],
    );
  }

  async function intent(
    cloud = service(),
    channel: NotificationJob['channel'] | 'TELEGRAM' = 'SNS_EMAIL',
    emergencyContactId?: string,
    recipientUserId?: string,
    eventCameraId: string | null = camera,
  ) {
    const eventId = randomUUID();
    const request: ClaimRequest = {
      schemaVersion: 1,
      claimId: randomUUID(),
      eventId,
      expectedEventVersion: 1,
    };
    const repo = new EscalationRepository(pool, cloud);
    const create = () =>
      db.transaction(async (client) => {
        await client.query(
          `INSERT INTO events(id,camera_id,event_type,status,priority,detected_at)
         VALUES ($1,$2,'PERSON_DETECTED','NOTIFIED','P1',clock_timestamp())`,
          [eventId, eventCameraId],
        );
        return repo.createNotificationIntent(client, {
          eventId,
          channel,
          status: 'PENDING',
          escalationLevel: 0,
          emergencyContactId,
          recipientUserId,
        });
      });
    return { request, create };
  }

  async function createJob(
    cloud = service(),
    channel: NotificationJob['channel'] = 'SNS_EMAIL',
    emergencyContactId?: string,
    recipientUserId?: string,
    eventCameraId: string | null = camera,
  ) {
    const { request, create } = await intent(
      cloud,
      channel,
      emergencyContactId,
      recipientUserId,
      eventCameraId,
    );
    return { id: await create(), request };
  }

  async function claimAttempt(
    cloud: NotificationCloudService,
    job: Awaited<ReturnType<typeof createJob>>,
  ) {
    const response = await cloud.claim(job.id, job.request);
    if (response.disposition !== 'CLAIMED') throw new Error(`Unexpected claim ${response.reason}`);
    return response;
  }

  function outcome(
    id: string,
    eventId: string,
    attemptId: string,
    overrides: Partial<OutcomeEnvelope['payload']> = {},
  ): OutcomeEnvelope {
    const outcomeId = overrides.outcomeId ?? randomUUID();
    return {
      schemaVersion: 1,
      type: 'notification.outcome',
      messageId: outcomeId,
      correlationId: eventId,
      occurredAt: '2026-11-21T09:12:00.000Z',
      payload: {
        outcomeId,
        notificationId: id,
        eventId,
        ownerScopeId: owner,
        attemptId,
        status: 'DRY_RUN',
        providerCalled: false,
        providerId: null,
        reason: null,
        ...overrides,
      },
    };
  }

  async function state(id: string) {
    return (
      await pool.query(
        'SELECT status, error_code, provider_message_id, sent_at, failed_at FROM notifications WHERE id=$1',
        [id],
      )
    ).rows[0];
  }

  it('creates an owner-fenced, PII-free outbox entry through the central escalation repository', async () => {
    const cloud = service();
    const job = await createJob(cloud);
    const context = await cloud.context(job.id);
    expect(context).toEqual({
      cached_result: null,
      envelope: {
        schemaVersion: 1,
        type: 'notification.job',
        messageId: job.id,
        correlationId: job.request.eventId,
        occurredAt: expect.any(String),
        payload: {
          notificationId: job.id,
          eventId: job.request.eventId,
          ownerScopeId: owner,
          expectedEventVersion: 1,
          channel: 'SNS_EMAIL',
        },
      },
    });
    await expect(cloud.context(randomUUID())).rejects.toMatchObject({ status: 404 });
    await pool.query("UPDATE notifications SET delivery_driver='local' WHERE id=$1", [job.id]);
    await expect(cloud.context(job.id)).rejects.toMatchObject({ status: 404 });
  });

  it('skips local and Telegram intents and rolls back an intent on driver drift', async () => {
    const local = service({ NOTIFICATION_DRIVER: 'local' });
    const localJob = await createJob(local);
    const telegram = await intent(service(), 'TELEGRAM');
    await telegram.create();
    expect((await pool.query('SELECT id FROM cloud_jobs')).rows).toHaveLength(0);
    await expect(
      db.transaction((client) =>
        local.enqueueNotification(client, {
          notificationId: localJob.id,
          eventId: localJob.request.eventId,
          ownerScopeId: owner,
          expectedEventVersion: 1,
          channel: 'SNS_EMAIL',
        }),
      ),
    ).rejects.toThrow('transport not enabled');

    await pool.query("UPDATE cloud_transport_mode SET notification_driver='local'");
    const cloud = await intent();
    await expect(cloud.create()).rejects.toThrow('driver differs');
    expect(
      (await pool.query('SELECT id FROM events WHERE id=$1', [cloud.request.eventId])).rows,
    ).toHaveLength(0);
  });

  it('rejects direct enqueue for a mismatched DB version', async () => {
    const cloud = service();
    const job = await createJob(service({ NOTIFICATION_DRIVER: 'local' }));
    await expect(
      db.transaction((client) =>
        cloud.enqueueNotification(client, {
          notificationId: job.id,
          eventId: job.request.eventId,
          ownerScopeId: owner,
          expectedEventVersion: 2,
          channel: 'SNS_EMAIL',
        }),
      ),
    ).rejects.toThrow('version mismatch');
    expect((await pool.query('SELECT id FROM cloud_jobs')).rows).toHaveLength(0);
  });

  it('issues PII-free dry-run claims with stable retry and global claim IDs', async () => {
    const cloud = service();
    const job = await createJob(cloud);
    const granted = await claimAttempt(cloud, job);
    expect(granted).toMatchObject({
      mode: 'DRY_RUN',
      reason: 'BLOCKED_PROVIDER',
      delivery: {
        channel: 'SNS_EMAIL',
        recipientRef: `user:${owner}`,
        message: expect.stringMatching(/^\[ArgusAI\]\[DEV\]/),
      },
    });
    expect(granted.delivery).not.toHaveProperty('topicArn');
    expect(await claimAttempt(cloud, job)).toEqual(granted);
    await expect(
      cloud.claim(job.id, { ...job.request, claimId: randomUUID() }),
    ).rejects.toMatchObject({
      status: 409,
      response: { disposition: 'BUSY', retryAt: granted.leaseUntil },
    });
    const other = await createJob(cloud);
    await expect(
      cloud.claim(other.id, { ...other.request, claimId: job.request.claimId }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('validates the claim against the stored job and event', async () => {
    const cloud = service();
    const job = await createJob(cloud);
    await expect(cloud.claim(randomUUID(), job.request)).rejects.toMatchObject({ status: 404 });
    await expect(
      cloud.claim(job.id, { ...job.request, eventId: randomUUID() }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      cloud.claim(job.id, { ...job.request, expectedEventVersion: 2 }),
    ).rejects.toMatchObject({ status: 409 });
    await pool.query("UPDATE notifications SET channel='SNS_SMS' WHERE id=$1", [job.id]);
    await expect(cloud.claim(job.id, job.request)).rejects.toMatchObject({ status: 409 });
  });

  it.each([
    ["UPDATE events SET status='RESOLVED' WHERE id=$1", 'RESOLVED', 'event'],
    ["UPDATE events SET status='CLOSED' WHERE id=$1", 'RESOLVED', 'event'],
    ["UPDATE events SET status='DETECTED' WHERE id=$1", 'CANCELLED', 'event'],
    ['UPDATE events SET version=2 WHERE id=$1', 'STALE_VERSION', 'event'],
    ["UPDATE cloud_jobs SET created_at=now()-interval '1 hour' WHERE id=$1", 'EXPIRED', 'job'],
    ["UPDATE notifications SET status='CONFIRMED' WHERE id=$1", 'ALREADY_SENT', 'job'],
    ["UPDATE notifications SET status='SENT' WHERE id=$1", 'ALREADY_SENT', 'job'],
    ["UPDATE notifications SET status='FAILED' WHERE id=$1", 'CANCELLED', 'job'],
    ['UPDATE cloud_jobs SET camera_id=NULL WHERE id=$1', 'CANCELLED', 'job'],
  ])('writes a durable no-op for %s', async (statement, reason, target) => {
    const cloud = service();
    const job = await createJob(cloud);
    await pool.query(statement, [target === 'event' ? job.request.eventId : job.id]);
    expect(await cloud.claim(job.id, job.request)).toEqual({
      notificationId: job.id,
      disposition: 'NO_OP',
      reason,
    });
    expect(await cloud.claim(job.id, job.request)).toMatchObject({ disposition: 'NO_OP', reason });
    expect((await pool.query('SELECT * FROM cloud_notification_attempts')).rows).toHaveLength(0);
    expect(
      (await pool.query('SELECT reason FROM cloud_notification_claim_decisions')).rows,
    ).toEqual([{ reason }]);
  });

  it('prevents an expired DRY_RUN grant from being renewed and cancels jobs when switched to local', async () => {
    const cloud = service();
    const job = await createJob(cloud);
    await claimAttempt(cloud, job);
    await expireAttempt(job.id);
    expect(await cloud.claim(job.id, job.request)).toMatchObject({ reason: 'EXPIRED' });
    const other = await createJob(cloud);
    expect(
      await service({ NOTIFICATION_DRIVER: 'local' }).claim(other.id, other.request),
    ).toMatchObject({ reason: 'CANCELLED' });
    const third = await createJob(cloud);
    await pool.query("UPDATE cloud_transport_mode SET notification_driver='local'");
    expect(await cloud.claim(third.id, third.request)).toMatchObject({ reason: 'CANCELLED' });
  });

  async function expireAttempt(id: string) {
    await pool.query(
      `UPDATE cloud_notification_attempts
       SET claimed_at=clock_timestamp()-interval '190s',lease_until=clock_timestamp()-interval '70s'
       WHERE notification_id=$1`,
      [id],
    );
  }

  it('locks out duplicate real sends, then accepts a late authoritative result from the original attempt', async () => {
    await allow();
    const cloud = service();
    const job = await createJob(cloud);
    const granted = await claimAttempt(cloud, job);
    expect(granted).toMatchObject({
      mode: 'REAL',
      delivery: { topicArn: topic, subject: '[ArgusAI][DEV] New incident' },
    });
    await expect(cloud.claim(job.id, job.request)).rejects.toMatchObject({
      status: 409,
      response: { disposition: 'BUSY', retryAt: granted.leaseUntil },
    });
    await expireAttempt(job.id);
    expect(await cloud.claim(job.id, job.request)).toMatchObject({ reason: 'UNCERTAIN' });
    expect(await state(job.id)).toMatchObject({ status: 'PENDING', error_code: 'UNCERTAIN' });
    expect(await cloud.claim(job.id, { ...job.request, claimId: randomUUID() })).toMatchObject({
      reason: 'UNCERTAIN',
    });
    const accepted = outcome(job.id, job.request.eventId, granted.attemptId, {
      status: 'PROVIDER_ACCEPTED',
      providerCalled: true,
      providerId: 'sns-id',
    });
    await cloud.cacheResult(job.id, accepted);
    expect(await cloud.applyResult(accepted)).toEqual({
      outcomeId: accepted.messageId,
      disposition: 'ACCEPTED',
    });
    expect(await state(job.id)).toMatchObject({
      status: 'SENT',
      provider_message_id: 'sns-id',
      sent_at: expect.any(Date),
    });
    expect(await cloud.claim(job.id, job.request)).toMatchObject({ reason: 'ALREADY_SENT' });
  });

  it('prevents simultaneous REAL claims from bypassing the recipient cooldown or cap', async () => {
    await allow();
    const cloud = service({ SENDER_NOTIFICATION_CAP: '2' });
    const one = await createJob(cloud);
    const two = await createJob(cloud);
    const results = await Promise.allSettled([
      cloud.claim(one.id, one.request),
      cloud.claim(two.id, two.request),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toMatchObject([
      { reason: { response: { disposition: 'BUSY' } } },
    ]);
    const index = results.findIndex((result) => result.status === 'fulfilled');
    await expireAttempt(index === 0 ? one.id : two.id);
    expect(await claimAttempt(cloud, index === 0 ? two : one)).toMatchObject({ mode: 'REAL' });
    const three = await createJob(cloud);
    expect(await cloud.claim(three.id, three.request)).toMatchObject({ reason: 'CAP_EXCEEDED' });
  });

  it('shares limits between contact records for the same verified destination', async () => {
    const cloud = service({ SNS_SMS_ENABLED: 'true', SENDER_NOTIFICATION_CAP: '2' });
    await allow('SNS_SMS', `contact:${contact}`);
    await allow('SNS_SMS', `contact:${alternateContact}`);
    const one = await createJob(cloud, 'SNS_SMS', contact);
    const two = await createJob(cloud, 'SNS_SMS', alternateContact);
    const results = await Promise.allSettled([
      cloud.claim(one.id, one.request),
      cloud.claim(two.id, two.request),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toMatchObject([
      { reason: { response: { disposition: 'BUSY' } } },
    ]);
    const first = results[0].status === 'fulfilled';
    await expireAttempt(first ? one.id : two.id);
    expect(await claimAttempt(cloud, first ? two : one)).toMatchObject({ mode: 'REAL' });
    const three = await createJob(cloud, 'SNS_SMS', contact);
    expect(await cloud.claim(three.id, three.request)).toMatchObject({ reason: 'CAP_EXCEEDED' });
  });

  it('uses exact topic allowlisting, verified destination identity and same-household recipient access', async () => {
    await allow();
    const wrongTopic = service({ SNS_TOPIC_ARN: topic + '-other' });
    expect(await claimAttempt(wrongTopic, await createJob(wrongTopic))).toMatchObject({
      reason: 'BLOCKED_PROVIDER',
    });
    const cloud = service({ SENDER_DRY_RUN: 'true' });
    const dryRun = await claimAttempt(cloud, await createJob(cloud));
    expect(dryRun.mode).toBe('DRY_RUN');
    expect(dryRun).not.toHaveProperty('reason');
    expect(dryRun.delivery).not.toHaveProperty('topicArn');
    await pool.query('DELETE FROM cloud_notification_routes');
    await allow('SNS_EMAIL', `user:${foreignUser}`, 'foreign@example.test');
    expect(
      await claimAttempt(cloud, await createJob(cloud, 'SNS_EMAIL', undefined, foreignUser)),
    ).toMatchObject({ reason: 'BLOCKED_PROVIDER' });
    await pool.query('DELETE FROM cloud_notification_routes');
    await allow('SNS_EMAIL', `user:${owner}`, 'different@example.test');
    expect(await claimAttempt(cloud, await createJob(cloud))).toMatchObject({
      reason: 'BLOCKED_PROVIDER',
    });
  });

  it('routes verified SMS and Connect contacts through provider-specific settings', async () => {
    const cloud = service({
      SNS_SMS_ENABLED: 'true',
      CONNECT_INSTANCE_ID: 'instance',
      CONNECT_CONTACT_FLOW_ID: 'flow',
      CONNECT_SOURCE_PHONE_NUMBER: phone,
    });
    await allow('SNS_SMS');
    await allow('CONNECT_CALL', `contact:${contact}`);
    expect(await claimAttempt(cloud, await createJob(cloud, 'SNS_SMS'))).toMatchObject({
      mode: 'REAL',
      delivery: { destination: phone },
    });
    expect(
      await claimAttempt(cloud, await createJob(cloud, 'CONNECT_CALL', contact)),
    ).toMatchObject({
      mode: 'REAL',
      delivery: {
        recipientRef: `contact:${contact}`,
        destination: phone,
        instanceId: 'instance',
        contactFlowId: 'flow',
        sourcePhoneNumber: phone,
      },
    });
    const unsupported = service();
    expect(
      await claimAttempt(unsupported, await createJob(unsupported, 'CONNECT_CALL', contact)),
    ).toMatchObject({ reason: 'BLOCKED_PROVIDER' });
    await pool.query('UPDATE emergency_contacts SET is_enabled=false WHERE id=$1', [contact]);
    try {
      expect(
        await claimAttempt(cloud, await createJob(cloud, 'CONNECT_CALL', contact)),
      ).toMatchObject({ reason: 'BLOCKED_PROVIDER' });
    } finally {
      await pool.query('UPDATE emergency_contacts SET is_enabled=true WHERE id=$1', [contact]);
    }
  });

  it('resolves the first verified same-owner emergency contact for automatic Connect intents', async () => {
    const cloud = service({
      CONNECT_INSTANCE_ID: 'instance',
      CONNECT_CONTACT_FLOW_ID: 'flow',
      CONNECT_SOURCE_PHONE_NUMBER: phone,
    });
    await allow('CONNECT_CALL', `contact:${contact}`);
    await allow('CONNECT_CALL', `contact:${alternateContact}`);
    const job = await createJob(cloud, 'CONNECT_CALL');
    const record = () =>
      pool.query('SELECT emergency_contact_id FROM notifications WHERE id=$1', [job.id]);
    expect((await record()).rows).toEqual([{ emergency_contact_id: contact }]);
    expect(await claimAttempt(cloud, job)).toMatchObject({
      mode: 'REAL',
      delivery: { recipientRef: `contact:${contact}` },
    });
  });

  it('blocks automatic Connect without an eligible contact even with an owner and a foreign route', async () => {
    const cloud = service({
      CONNECT_INSTANCE_ID: 'instance',
      CONNECT_CONTACT_FLOW_ID: 'flow',
      CONNECT_SOURCE_PHONE_NUMBER: phone,
    });
    const foreignContact = randomUUID();
    await pool.query(
      `INSERT INTO emergency_contacts(id,owner_user_id,name,phone_e164,is_verified)
       VALUES ($1,$2,'Foreign contact',$3,true)`,
      [foreignContact, foreignUser, phone],
    );
    await allow('CONNECT_CALL');
    await allow('CONNECT_CALL', `contact:${foreignContact}`);
    await pool.query('UPDATE emergency_contacts SET is_enabled=false WHERE owner_user_id=$1', [
      owner,
    ]);
    try {
      const job = await createJob(cloud, 'CONNECT_CALL');
      expect(
        (await pool.query('SELECT emergency_contact_id FROM notifications WHERE id=$1', [job.id]))
          .rows,
      ).toEqual([{ emergency_contact_id: null }]);
      expect(await claimAttempt(cloud, job)).toMatchObject({
        mode: 'DRY_RUN',
        reason: 'BLOCKED_PROVIDER',
      });
      expect(
        await claimAttempt(cloud, await createJob(cloud, 'CONNECT_CALL', undefined, owner)),
      ).toMatchObject({ mode: 'REAL', delivery: { recipientRef: `user:${owner}` } });
    } finally {
      await pool.query('UPDATE emergency_contacts SET is_enabled=true WHERE owner_user_id=$1', [
        owner,
      ]);
      await pool.query('DELETE FROM emergency_contacts WHERE id=$1', [foreignContact]);
    }
  });

  it('keeps camera-less legacy intents local even when SQS is enabled', async () => {
    const cloud = service();
    const job = await createJob(cloud, 'CONNECT_CALL', undefined, owner, null);
    expect(await state(job.id)).toMatchObject({ status: 'PENDING' });
    await expect(cloud.context(job.id)).rejects.toMatchObject({ status: 404 });
  });

  it('reserves provider cooldown through the first grant lease and releases proven no-call outcomes', async () => {
    await allow();
    const cloud = service();
    const pending = await createJob(cloud);
    const grant = await claimAttempt(cloud, pending);
    await pool.query(
      "UPDATE cloud_notification_attempts SET claimed_at=clock_timestamp()-interval '65s' WHERE notification_id=$1",
      [pending.id],
    );
    const second = await createJob(cloud);
    await expect(cloud.claim(second.id, second.request)).rejects.toMatchObject({
      status: 409,
      response: { retryAt: new Date(Date.parse(grant.leaseUntil) + 60_000).toISOString() },
    });
    await cloud.submitOutcome(
      pending.id,
      outcome(pending.id, pending.request.eventId, grant.attemptId, {
        status: 'FAILED',
        providerCalled: false,
      }).payload,
    );
    expect(await claimAttempt(cloud, second)).toMatchObject({ mode: 'REAL' });
  });

  it('reserves current UTC day budget for a provider grant made before midnight', async () => {
    await allow();
    const cloud = service({ SENDER_NOTIFICATION_CAP: '1' });
    const prior = await createJob(cloud);
    await claimAttempt(cloud, prior);
    await pool.query(
      `UPDATE cloud_notification_attempts
       SET claimed_at=date_trunc('day',clock_timestamp(),'UTC')-interval '1 min',
           lease_until=date_trunc('day',clock_timestamp(),'UTC')+interval '1 min'
       WHERE notification_id=$1`,
      [prior.id],
    );
    const next = await createJob(cloud);
    expect(await cloud.claim(next.id, next.request)).toMatchObject({ reason: 'CAP_EXCEEDED' });
  });

  it.each([
    ['DRY_RUN', 'BLOCKED_PROVIDER', 'BLOCKED_PROVIDER'],
    ['DRY_RUN', 'SENDER_DRY_RUN', 'SENDER_DRY_RUN'],
    ['FAILED', 'LEASE_EXPIRED', 'LEASE_EXPIRED'],
    ['FAILED', 'untrusted external address contact@example.test', 'FAILED'],
  ] as const)('stores only a safe error code for %s reasons', async (status, reason, errorCode) => {
    const cloud = service();
    const job = await createJob(cloud);
    const granted = await claimAttempt(cloud, job);
    await cloud.submitOutcome(
      job.id,
      outcome(job.id, job.request.eventId, granted.attemptId, {
        status,
        reason,
      }).payload,
    );
    expect(await state(job.id)).toMatchObject({ error_code: errorCode });
  });

  it('rejects a queue result without the authenticated durable cache', async () => {
    const cloud = service();
    const job = await createJob(cloud);
    const granted = await claimAttempt(cloud, job);
    const message = outcome(job.id, job.request.eventId, granted.attemptId);
    await expect(cloud.applyResult(message)).rejects.toMatchObject({ status: 409 });
    expect((await cloud.context(job.id)).cached_result).toBeNull();
    expect((await pool.query('SELECT id FROM cloud_result_receipts')).rows).toHaveLength(0);
    expect(
      (await pool.query('SELECT outcome_id FROM cloud_notification_outcomes')).rows,
    ).toHaveLength(0);
    expect(await state(job.id)).toMatchObject({ status: 'PENDING' });
  });

  it('caches a canonical outcome before apply, handles replay, and refuses a conflicting body', async () => {
    const cloud = service();
    const job = await createJob(cloud);
    const granted = await claimAttempt(cloud, job);
    const message = outcome(job.id, job.request.eventId, granted.attemptId);
    expect(await cloud.cacheResult(job.id, message)).toEqual(message);
    expect(await cloud.cacheResult(job.id, message)).toEqual(message);
    expect((await cloud.context(job.id)).cached_result).toEqual(message);
    expect(await state(job.id)).toMatchObject({ status: 'PENDING' });
    await expect(cloud.claim(job.id, job.request)).rejects.toMatchObject({
      status: 409,
      response: { disposition: 'BUSY' },
    });
    const changed = { ...message, payload: { ...message.payload, reason: 'changed' } };
    await expect(cloud.cacheResult(job.id, changed)).rejects.toMatchObject({ status: 409 });
    expect(await cloud.applyResult(message)).toMatchObject({ disposition: 'ACCEPTED' });
    expect(await cloud.applyResult(message)).toMatchObject({ disposition: 'DUPLICATE' });
    expect(await cloud.submitOutcome(job.id, message.payload)).toMatchObject({
      disposition: 'DUPLICATE',
    });
    expect(await state(job.id)).toMatchObject({ status: 'SKIPPED', error_code: 'DRY_RUN' });
    expect((await pool.query('SELECT id FROM cloud_result_receipts')).rows).toHaveLength(1);
    expect(
      (await pool.query('SELECT notification_id FROM cloud_notification_outcomes')).rows,
    ).toEqual([{ notification_id: job.id }]);
    await expect(
      cloud.applyResult(outcome(job.id, job.request.eventId, granted.attemptId)),
    ).rejects.toMatchObject({ status: 409 });
  });

  it.each([
    ['FAILED', 'FAILED'],
    ['UNCERTAIN', 'PENDING'],
  ] as const)(
    'maps %s and records repeat without a second outcome',
    async (outcomeStatus, notificationStatus) => {
      const cloud = service();
      const job = await createJob(cloud);
      const granted = await claimAttempt(cloud, job);
      const message = outcome(job.id, job.request.eventId, granted.attemptId, {
        status: outcomeStatus,
      });
      expect(await cloud.submitOutcome(job.id, message.payload)).toMatchObject({
        disposition: 'ACCEPTED',
      });
      expect(await cloud.submitOutcome(job.id, message.payload)).toMatchObject({
        disposition: 'DUPLICATE',
      });
      expect(await state(job.id)).toMatchObject({
        status: notificationStatus,
        error_code: outcomeStatus,
      });
      expect(await cloud.claim(job.id, job.request)).toMatchObject({
        disposition: 'NO_OP',
        reason: outcomeStatus === 'UNCERTAIN' ? 'UNCERTAIN' : 'CANCELLED',
      });
    },
  );

  it('validates envelope contract, route ID, owner, attempt, channel and mode before persisting', async () => {
    const cloud = service();
    const job = await createJob(cloud);
    const granted = await claimAttempt(cloud, job);
    const message = outcome(job.id, job.request.eventId, granted.attemptId);
    await expect(cloud.cacheResult(job.id, {})).rejects.toMatchObject({ status: 400 });
    await expect(
      cloud.cacheResult(job.id, (await cloud.context(job.id)).envelope),
    ).rejects.toMatchObject({ status: 400 });
    await expect(cloud.cacheResult(randomUUID(), message)).rejects.toMatchObject({ status: 400 });
    await expect(cloud.submitOutcome(randomUUID(), message.payload)).rejects.toMatchObject({
      status: 400,
    });
    await expect(cloud.submitOutcome(job.id, null)).rejects.toMatchObject({ status: 400 });
    await expect(
      cloud.applyResult(outcome(randomUUID(), randomUUID(), randomUUID())),
    ).rejects.toMatchObject({ status: 404 });
    for (const invalid of [
      { ownerScopeId: foreignUser },
      { attemptId: randomUUID() },
      { status: 'PROVIDER_ACCEPTED', providerCalled: true, providerId: 'provider-id' } as const,
      { status: 'FAILED', providerId: 'provider-id' } as const,
    ]) {
      await expect(
        cloud.applyResult({ ...message, payload: { ...message.payload, ...invalid } }),
      ).rejects.toMatchObject({ status: 409 });
    }
    await expect(
      cloud.applyResult(outcome(job.id, randomUUID(), granted.attemptId)),
    ).rejects.toMatchObject({ status: 409 });
    await pool.query(
      "UPDATE cloud_notification_attempts SET channel='SNS_SMS' WHERE attempt_id=$1",
      [granted.attemptId],
    );
    await expect(cloud.applyResult(message)).rejects.toMatchObject({ status: 409 });
    expect((await cloud.context(job.id)).cached_result).toBeNull();
    expect((await pool.query('SELECT id FROM cloud_result_receipts')).rows).toHaveLength(0);
  });

  it('allows only one job to durably cache an outcome ID across concurrent workers', async () => {
    const cloud = service();
    const job = await createJob(cloud);
    const other = await createJob(cloud);
    const first = await claimAttempt(cloud, job);
    const second = await claimAttempt(cloud, other);
    const message = outcome(job.id, job.request.eventId, first.attemptId);
    const collision = outcome(other.id, other.request.eventId, second.attemptId, {
      outcomeId: message.messageId,
    });
    const results = await Promise.allSettled([
      cloud.cacheResult(job.id, message),
      cloud.cacheResult(other.id, collision),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toMatchObject([
      { reason: { status: 409 } },
    ]);
  });

  it('rolls back receipts and canonical cache when an outcome write fails and rejects cross-job receipt collisions', async () => {
    const cloud = service();
    const job = await createJob(cloud);
    const granted = await claimAttempt(cloud, job);
    const message = outcome(job.id, job.request.eventId, granted.attemptId);
    await pool.query(
      "ALTER TABLE cloud_notification_outcomes ADD CONSTRAINT reject_dry_run CHECK (status <> 'DRY_RUN')",
    );
    try {
      await expect(cloud.submitOutcome(job.id, message.payload)).rejects.toThrow('reject_dry_run');
    } finally {
      await pool.query('ALTER TABLE cloud_notification_outcomes DROP CONSTRAINT reject_dry_run');
    }
    expect((await cloud.context(job.id)).cached_result).toBeNull();
    expect((await pool.query('SELECT id FROM cloud_result_receipts')).rows).toHaveLength(0);
    expect(await state(job.id)).toMatchObject({ status: 'PENDING' });
    await cloud.cacheResult(job.id, message);
    await cloud.applyResult(message);
    const other = await createJob(cloud);
    const otherGrant = await claimAttempt(cloud, other);
    await expect(
      cloud.cacheResult(
        other.id,
        outcome(other.id, other.request.eventId, otherGrant.attemptId, {
          outcomeId: message.messageId,
        }),
      ),
    ).rejects.toMatchObject({ status: 409 });
  });
});
