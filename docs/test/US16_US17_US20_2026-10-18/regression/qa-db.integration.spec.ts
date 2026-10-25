import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { ConfigService } from '@nestjs/config';
import { FallIncidentRepository } from '../src/fall-detection/repository/fall-incident.repository';
import { WellnessRepository } from '../src/wellness/wellness.repository';
import { WellnessSchedulerService } from '../src/wellness/wellness-scheduler.service';
import { WellnessService } from '../src/wellness/wellness.service';
import type { TokenClaims } from '../src/auth/auth.types';

// This connection is only to the disposable QA container created for this run.
const pool = new Pool({
  host: '127.0.0.1',
  port: 55432,
  database: 'qa_runtime',
  user: 'qa',
  password: 'qa-disposable-only',
  max: 6,
});
const wellness = new WellnessRepository(pool);
jest.setTimeout(30000);

async function fixture() {
  const owner = randomUUID(),
    resident = randomUUID(),
    device = randomUUID(),
    camera = randomUUID();
  await pool.query(
    `INSERT INTO users(id,email,full_name,role,password_hash) VALUES ($1,$2,'QA caregiver','CAREGIVER','qa-fixture-unused'),($3,$4,'QA resident','VIEWER','qa-fixture-unused')`,
    [owner, `${owner}@example.invalid`, resident, `${resident}@example.invalid`],
  );
  await pool.query(
    `INSERT INTO devices(id,owner_user_id,name,device_type,status) VALUES($1,$2,'QA','EDGE_GATEWAY','ONLINE')`,
    [device, owner],
  );
  await pool.query(
    `INSERT INTO cameras(id,device_id,name,slug,rtsp_url) VALUES($1,$2,'QA',$3,'rtsp://127.0.0.1/qa')`,
    [camera, device, `qa_${camera.replaceAll('-', '')}`],
  );
  return { owner, resident, camera };
}
async function scheduleFixture() {
  const f = await fixture();
  const schedule = await wellness.createSchedule({
    ownerUserId: f.owner,
    residentUserId: f.resident,
    name: 'QA',
    checkAt: '09:00',
    daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
    lookbackHours: 6,
    graceSeconds: 300,
    cameraIds: [f.camera],
    timezone: 'UTC',
    isEnabled: true,
  });
  const now = new Date();
  await wellness.insertCheckRunIfNotExists({
    scheduleId: schedule.id,
    ownerUserId: f.owner,
    residentUserId: f.resident,
    localDate: now.toISOString().slice(0, 10),
    scheduledFor: now,
    scheduleVersion: 1,
    scheduleSnapshot: { cameraIds: [f.camera] },
    lookbackStartedAt: new Date(now.getTime() - 21600000),
    lookbackEndedAt: now,
    graceSeconds: 300,
    availableAt: now,
  });
  return { ...f, schedule, now };
}

describe('QA PostgreSQL16 production repositories', () => {
  beforeAll(async () => {
    const database = (
      await pool.query(
        `SELECT current_database() AS name,current_setting('server_version_num')::int AS version`,
      )
    ).rows[0];
    expect(database.name).toBe('qa_runtime');
    expect(database.version).toBeGreaterThanOrEqual(160000);
    expect(database.version).toBeLessThan(170000);
  });
  afterAll(async () => {
    await pool.end();
  });

  it('US17 persists independent FALL P1 incident and sequential replay deduplicates', async () => {
    const f = await fixture();
    const repository = new FallIncidentRepository(pool);
    const input = {
      cameraId: f.camera,
      sourceSessionId: 'qa',
      trackId: 'qa',
      episodeId: randomUUID(),
      candidateStartedAt: new Date(Date.now() - 16000),
      confirmedAt: new Date(),
      modelVersion: 'qa-lite',
      ruleSnapshot: {},
      resultId: randomUUID(),
      pendingPayload: {},
    };
    const first = await repository.createConfirmedIncident(input);
    const second = await repository.createConfirmedIncident(input);
    expect(first.isNew).toBe(true);
    expect(second.isNew).toBe(false);
    expect(second.eventId).toBe(first.eventId);
    const row = (
      await pool.query('SELECT event_type,priority,detected_at FROM events WHERE id=$1', [
        first.eventId,
      ])
    ).rows[0];
    expect(row.event_type).toBe('FALL_DETECTED');
    expect(row.priority).toBe('P1');
    expect(row.detected_at).toEqual(input.confirmedAt);
  });
  it('US17 concurrent same-episode deliveries both succeed idempotently', async () => {
    const f = await fixture();
    const repository = new FallIncidentRepository(pool);
    const input = {
      cameraId: f.camera,
      sourceSessionId: 'qa',
      trackId: 'qa',
      episodeId: randomUUID(),
      candidateStartedAt: new Date(Date.now() - 16000),
      confirmedAt: new Date(),
      modelVersion: 'qa-lite',
      ruleSnapshot: {},
      resultId: randomUUID(),
      pendingPayload: {},
    };
    const results = await Promise.allSettled([
      repository.createConfirmedIncident(input),
      repository.createConfirmedIncident(input),
    ]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(
      Number(
        (
          await pool.query('SELECT count(*) FROM fall_incidents WHERE episode_id=$1', [
            input.episodeId,
          ])
        ).rows[0].count,
      ),
    ).toBe(1);
  });
  it('US20 schedule CRUD preserves history through soft-delete', async () => {
    const f = await scheduleFixture();
    await expect(wellness.getScheduleById(f.schedule.id)).resolves.toMatchObject({
      id: f.schedule.id,
      resident_user_id: f.resident,
    });
    await expect(wellness.deleteSchedule(f.schedule.id)).resolves.toBe(true);
    expect(
      Number(
        (
          await pool.query('SELECT count(*) FROM wellness_check_runs WHERE schedule_id=$1', [
            f.schedule.id,
          ])
        ).rows[0].count,
      ),
    ).toBe(1);
  });
  it('US20 ledger activity includes both closed-window boundaries and excludes later motion', async () => {
    const f = await fixture();
    const start = new Date('2026-10-18T00:00:00Z');
    const end = new Date('2026-10-18T06:00:00Z');
    const face = randomUUID();
    await pool.query(
      `INSERT INTO known_faces(id,owner_user_id,linked_user_id,person_name,embedding,embedding_dim,model_version)
      VALUES($1,$2,$3,'QA',$4,128,'qa-synthetic')`,
      [face, f.owner, f.resident, Buffer.alloc(512, 1)],
    );
    const identity = (
      await pool.query(
        `INSERT INTO events(camera_id,event_type,status,priority,source,detected_at)
      VALUES($1,'PERSON_DETECTED','DETECTED','P3','FRIGATE',$2) RETURNING id`,
        [f.camera, start],
      )
    ).rows[0].id;
    for (const observedAt of [start, end, new Date(end.getTime() + 1)]) {
      await wellness.saveObservation({
        observation_id: randomUUID(),
        owner_user_id: f.owner,
        resident_user_id: f.resident,
        known_face_id: face,
        camera_id: f.camera,
        identity_event_id: identity,
        source_session_id: 'qa',
        track_id: 'qa',
        kind: 'MOTION',
        observed_at: observedAt,
        received_at: new Date(),
        payload_hash: 'a'.repeat(64),
        evidence: { fixture: 'verified identity and motion' },
      });
      const expected = observedAt > end ? end : observedAt;
      await expect(
        wellness.findActivityInWindow(f.owner, f.resident, [f.camera], start, end),
      ).resolves.toEqual(expected);
    }
  });
  it('US20 real presence ledger must not use a future departure for an earlier check', async () => {
    const f = await fixture();
    const observationId = randomUUID();
    const asOf = new Date('2026-10-18T02:00:00Z'),
      observedAt = new Date('2026-10-18T02:01:00Z');
    await wellness.saveObservation({
      observation_id: observationId,
      owner_user_id: f.owner,
      resident_user_id: f.resident,
      known_face_id: null,
      camera_id: f.camera,
      identity_event_id: null,
      source_session_id: 'qa',
      track_id: 'qa',
      kind: 'DEPARTURE',
      observed_at: observedAt,
      received_at: new Date(),
      payload_hash: 'b'.repeat(64),
      evidence: { direction: 'EXIT', boundaryId: 'qa', policyVersion: 'qa' },
    });
    await wellness.updatePresence({
      owner_user_id: f.owner,
      resident_user_id: f.resident,
      state: 'AWAY',
      observation_id: observationId,
      observed_at: observedAt,
      valid_until: new Date('2026-10-19T02:01:00Z'),
      updated_at: new Date(),
    });
    await expect(wellness.getPresenceState(f.owner, f.resident, asOf)).resolves.toBe('UNKNOWN');
  });
  it('US20 a VIEWER without an active household link cannot be assigned by another caregiver', async () => {
    const f = await fixture();
    await expect(wellness.verifyResidentHouseholdLink(f.owner, f.resident)).resolves.toBe(false);
  });
  it('US20 claim and no-activity evaluation create atomic P2 resident alert', async () => {
    const f = await scheduleFixture();
    const client = await pool.connect();
    let runs;
    try {
      await client.query('BEGIN');
      runs = await wellness.claimPendingRuns(100, 30, client);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    const run = runs.find((r) => r.schedule_id === f.schedule.id)!;
    expect(run.lease_token).toBeTruthy();
    await new WellnessSchedulerService(wellness, new ConfigService()).evaluateSingleRun(run);
    const stored = (
      await pool.query(
        'SELECT status,event_id,request_sent_at FROM wellness_check_runs WHERE id=$1',
        [run.id],
      )
    ).rows[0];
    expect(stored.status).toBe('ALERT_CREATED');
    const event = (
      await pool.query('SELECT priority,event_type FROM events WHERE id=$1', [stored.event_id])
    ).rows[0];
    expect(event).toMatchObject({ priority: 'P2', event_type: 'WELLNESS_TIMEOUT' });
  });
  it.each(['IM_OK', 'NEED_HELP'] as const)(
    'US20 %s confirmation commits against real schema',
    async (response) => {
      const f = await scheduleFixture();
      const event = (
        await pool.query(
          `INSERT INTO events(event_type,status,priority,source,detected_at,wellness_owner_user_id,wellness_resident_user_id)
      VALUES('WELLNESS_TIMEOUT','NOTIFIED','P2','SCHEDULER',now(),$1,$2) RETURNING id`,
          [f.owner, f.resident],
        )
      ).rows[0].id;
      // Establish a valid committed run with a successfully delivered fixture request.
      const run = (
        await pool.query(
          `UPDATE wellness_check_runs SET status='ALERT_CREATED',evaluated_at=now(),event_id=$2,
      request_sent_at=now(),confirmation_deadline_at=now()+interval '300 seconds' WHERE schedule_id=$1 RETURNING id`,
          [f.schedule.id, event],
        )
      ).rows[0];
      const result = await new WellnessService(wellness).confirmCheck(
        { sub: f.resident, role: 'VIEWER' } as TokenClaims,
        run.id,
        { commandId: randomUUID(), response },
      );
      expect(result.response).toBe(response);
      expect(
        (await pool.query('SELECT status FROM events WHERE id=$1', [event])).rows[0].status,
      ).toBe(response === 'IM_OK' ? 'RESOLVED' : 'ESCALATED');
    },
  );
});
