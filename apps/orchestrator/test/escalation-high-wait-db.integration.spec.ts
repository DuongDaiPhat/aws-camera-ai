import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { BadRequestException } from '@nestjs/common';
import { Pool } from 'pg';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { EscalationRulesRepository } from '../src/escalation-rules/escalation-rules.repository';
import { EscalationRulesService } from '../src/escalation-rules/escalation-rules.service';
import type { EscalationRuleDto } from '../src/escalation-rules/dto/escalation-rule-response.dto';
import { EscalationEngineService } from '../src/escalation/escalation-engine.service';
import { EscalationRepository } from '../src/escalation/escalation.repository';

describe('Manual high wait — PostgreSQL and escalation engine', () => {
  let container: StartedTestContainer;
  let pool: Pool;
  let rules: EscalationRulesRepository;
  let service: EscalationRulesService;
  let engine: EscalationEngineService;
  const actor = { userId: randomUUID() };
  const cameraId = randomUUID();
  const detectedAt = new Date('2026-09-29T13:00:00Z');
  const startupTimeoutMs = 120_000;

  jest.setTimeout(startupTimeoutMs);

  beforeAll(async () => {
    container = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({
        POSTGRES_DB: 'high_wait_test',
        POSTGRES_USER: 'test',
        POSTGRES_PASSWORD: 'test',
      })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .withStartupTimeout(startupTimeoutMs)
      .start();
    pool = new Pool({
      host: container.getHost(),
      port: container.getMappedPort(5432),
      database: 'high_wait_test',
      user: 'test',
      password: 'test',
    });
    const directory = resolve(__dirname, '../../../db/migrations');
    for (const file of (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort()) {
      await pool.query(await readFile(resolve(directory, file), 'utf8'));
    }
    await pool.query(
      `INSERT INTO users (id, email, password_hash, full_name, role)
      VALUES ($1, 'manual-wait@example.test', 'test-hash', 'Test admin', 'ADMIN')`,
      [actor.userId],
    );
    const deviceId = randomUUID();
    await pool.query(
      `INSERT INTO devices (id, owner_user_id, name, status) VALUES ($1, $2, 'Test gateway', 'ONLINE')`,
      [deviceId, actor.userId],
    );
    await pool.query(
      `INSERT INTO cameras (id, device_id, name, slug, rtsp_url)
      VALUES ($1, $2, 'Test kitchen', 'cam_manual_wait', 'rtsp://test/cam')`,
      [cameraId, deviceId],
    );
    rules = new EscalationRulesRepository(pool);
    service = new EscalationRulesService(rules);
    engine = new EscalationEngineService(new EscalationRepository(pool), rules);
  });

  beforeEach(async () => {
    await pool.query(`UPDATE escalation_rules SET t_wait_seconds = 60, high_wait_seconds = 30,
      t_low = 0.6, t_high = 0.8 WHERE event_type = 'RESTRICTED_ZONE'`);
  });

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  async function saveHighWait(
    highWaitSeconds: number | null,
    tWaitSeconds = 60,
  ): Promise<EscalationRuleDto> {
    const current = await service.getRuleByEventType('RESTRICTED_ZONE');
    return service.updateThresholds(
      'RESTRICTED_ZONE',
      {
        tLow: 0.6,
        tHigh: 0.8,
        tWaitSeconds,
        highWaitSeconds,
        expectedVersion: current.version,
      },
      actor,
    );
  }

  async function createEvent(): Promise<string> {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO events (id, camera_id, event_type, status, priority, source, confidence, detected_at)
      VALUES ($1, $2, 'RESTRICTED_ZONE', 'DETECTED', 'P1', 'FRIGATE', 0.85, $3)`,
      [id, cameraId, detectedAt],
    );
    return id;
  }

  it('lưu giá trị nhập tay, trả lại khi đọc và ghi before/after trong audit', async () => {
    const updated = await saveHighWait(17);
    expect(updated.highWaitSeconds).toBe(17);
    expect(updated.effectiveHighWaitSeconds).toBe(17);
    const reloaded = await service.getRuleByEventType('RESTRICTED_ZONE');
    expect(reloaded.highWaitSeconds).toBe(17);
    const audit = await pool.query<{
      metadata: { before: { highWaitSeconds: number }; after: { highWaitSeconds: number } };
    }>(
      `SELECT metadata FROM audit_logs WHERE action = 'ESCALATION_RULE_UPDATED'
       AND entity_id = (SELECT id FROM escalation_rules WHERE event_type = 'RESTRICTED_ZONE')
       AND metadata->>'version' = $1 ORDER BY created_at DESC LIMIT 1`,
      [String(updated.version)],
    );
    expect(audit.rows[0].metadata.before.highWaitSeconds).toBe(30);
    expect(audit.rows[0].metadata.after.highWaitSeconds).toBe(17);
  });

  it('đổi riêng T_wait vẫn giữ thời gian nhánh cao, không tự chia đôi', async () => {
    const current = await saveHighWait(17);
    const updated = await service.updateThresholds(
      'RESTRICTED_ZONE',
      {
        tLow: 0.6,
        tHigh: 0.8,
        tWaitSeconds: 600,
        expectedVersion: current.version,
      },
      actor,
    );
    expect(updated.tWaitSeconds).toBe(600);
    expect(updated.highWaitSeconds).toBe(17);
    expect(updated.effectiveHighWaitSeconds).toBe(17);
  });

  it.each([60, 61, -1, 1.5, null])(
    'từ chối nhánh không hợp lệ %s và không đổi version',
    async (seconds) => {
      const before = await service.getRuleByEventType('RESTRICTED_ZONE');
      await expect(saveHighWait(seconds)).rejects.toThrow(BadRequestException);
      const after = await service.getRuleByEventType('RESTRICTED_ZONE');
      expect(after.version).toBe(before.version);
      expect(after.highWaitSeconds).toBe(before.highWaitSeconds);
    },
  );

  it('không cho giảm T_wait xuống bằng giá trị nhánh cao đã lưu khi bỏ qua field', async () => {
    const current = await saveHighWait(17);
    await expect(
      service.updateThresholds(
        'RESTRICTED_ZONE',
        {
          tLow: 0.6,
          tHigh: 0.8,
          tWaitSeconds: 17,
          expectedVersion: current.version,
        },
        actor,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('DB cũng chặn high wait >= base wait dù bỏ qua API', async () => {
    await expect(
      pool.query(
        `UPDATE escalation_rules SET high_wait_seconds = t_wait_seconds WHERE event_type = 'RESTRICTED_ZONE'`,
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('engine dùng 17 giây thật, không reset event cũ; sự kiện mới dùng cấu hình 12 giây', async () => {
    await saveHighWait(17);
    const firstId = await createEvent();
    const input = { eventType: 'RESTRICTED_ZONE' as const, confidence: 0.85, detectedAt };
    const first = await engine.evaluateAndTransition(firstId, input);
    expect(first.status).toBe('NOTIFIED');
    expect(first.escalation_deadline_at).toEqual(new Date(detectedAt.getTime() + 17_000));
    expect(first.rule_snapshot).toMatchObject({ highWaitSeconds: 17, effectiveWaitSeconds: 17 });

    await saveHighWait(12);
    const oldEvent = await engine.evaluateAndTransition(firstId, input);
    expect(oldEvent.escalation_deadline_at).toEqual(first.escalation_deadline_at);
    expect(oldEvent.rule_snapshot).toEqual(first.rule_snapshot);
    const second = await engine.evaluateAndTransition(await createEvent(), input);
    expect(second.escalation_deadline_at).toEqual(new Date(detectedAt.getTime() + 12_000));
  });

  it('nhánh thường vẫn dùng T_wait; nhánh 0 giây hết hạn tại lúc phát hiện', async () => {
    await saveHighWait(0);
    const normal = await engine.evaluateAndTransition(await createEvent(), {
      eventType: 'RESTRICTED_ZONE',
      confidence: 0.7,
      detectedAt,
    });
    expect(normal.escalation_deadline_at).toEqual(new Date(detectedAt.getTime() + 60_000));
    const high = await engine.evaluateAndTransition(await createEvent(), {
      eventType: 'RESTRICTED_ZONE',
      confidence: 0.9,
      detectedAt,
    });
    expect(high.escalation_deadline_at).toEqual(detectedAt);
  });
});
