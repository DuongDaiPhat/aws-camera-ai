import { Pool } from 'pg';
import {
  EscalationRulesRepository,
  RuleNotFoundError,
  RuleVersionConflictError,
} from '../src/escalation-rules/escalation-rules.repository';

describe('EscalationRulesRepository Integration (US-15)', () => {
  let pool: Pool;
  let repository: EscalationRulesRepository;

  beforeAll(() => {
    pool = new Pool({
      host: process.env.POSTGRES_HOST || 'localhost',
      port: Number(process.env.POSTGRES_PORT || 5432),
      database: process.env.POSTGRES_DB || 'camerai',
      user: process.env.POSTGRES_USER || 'camerai',
      password: process.env.POSTGRES_PASSWORD || 'change_me_local_only',
    });
    repository = new EscalationRulesRepository(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('findAll trả về đúng 6 default rules theo thứ tự priority (P0 -> P3)', async () => {
    const rules = await repository.findAll();
    expect(rules.length).toBeGreaterThanOrEqual(6);

    const eventTypes = rules.map((r) => r.event_type);
    expect(eventTypes).toContain('FIRE_SMOKE_DETECTED');
    expect(eventTypes).toContain('FALL_DETECTED');
    expect(eventTypes).toContain('RESTRICTED_ZONE');
    expect(eventTypes).toContain('UNKNOWN_PERSON');
    expect(eventTypes).toContain('WELLNESS_TIMEOUT');
    expect(eventTypes).toContain('PERSON_DETECTED');

    // Rule đầu tiên phải là P0 (FIRE_SMOKE_DETECTED)
    expect(rules[0].priority).toBe('P0');
  });

  it('findByEventType trả về chi tiết rule', async () => {
    const rule = await repository.findByEventType('FIRE_SMOKE_DETECTED');
    expect(rule).not.toBeNull();
    expect(rule?.event_type).toBe('FIRE_SMOKE_DETECTED');
    expect(rule?.priority).toBe('P0');
    expect(Number(rule?.t_low)).toBe(0.5);
    expect(Number(rule?.t_high)).toBe(0.7);
    expect(rule?.t_wait_seconds).toBe(30);
  });

  it('updateThresholdsAtomic cập nhật nguyên tử, tăng version và ghi audit log', async () => {
    const current = await repository.findByEventType('UNKNOWN_PERSON');
    expect(current).not.toBeNull();
    const initialVersion = current!.version;

    // Tìm admin user ID từ DB
    const adminUser = await pool.query<{ id: string }>(
      `SELECT id FROM users WHERE role = 'ADMIN' LIMIT 1`,
    );
    const adminId = adminUser.rows[0].id;

    // 1. Cập nhật hợp lệ
    const updated = await repository.updateThresholdsAtomic({
      eventType: 'UNKNOWN_PERSON',
      tLow: 0.65,
      tHigh: 0.85,
      tWaitSeconds: 150,
      expectedVersion: initialVersion,
      actorUserId: adminId,
      clientIp: '127.0.0.1',
      userAgent: 'Jest Test Agent',
      correlationId: 'test-corr-id',
    });

    expect(updated.version).toBe(initialVersion + 1);
    expect(Number(updated.t_low)).toBe(0.65);
    expect(Number(updated.t_high)).toBe(0.85);
    expect(updated.t_wait_seconds).toBe(150);

    // 2. Xác minh audit log được tạo
    const auditRes = await pool.query<{
      action: string;
      entity_type: string;
      metadata: { before: { tWaitSeconds: number }; after: { tWaitSeconds: number } };
    }>(
      `SELECT action, entity_type, metadata FROM audit_logs WHERE action = 'ESCALATION_RULE_UPDATED' ORDER BY created_at DESC LIMIT 1`,
    );
    expect(auditRes.rows.length).toBe(1);
    expect(auditRes.rows[0].action).toBe('ESCALATION_RULE_UPDATED');
    expect(auditRes.rows[0].metadata.after.tWaitSeconds).toBe(150);

    // 3. Thử cập nhật lại với version cũ -> phải ném RuleVersionConflictError
    await expect(
      repository.updateThresholdsAtomic({
        eventType: 'UNKNOWN_PERSON',
        tLow: 0.6,
        tHigh: 0.8,
        tWaitSeconds: 120,
        expectedVersion: initialVersion, // Stale version
        actorUserId: adminId,
      }),
    ).rejects.toThrow(RuleVersionConflictError);

    // 4. Khôi phục lại giá trị mặc định cho UNKNOWN_PERSON
    await repository.updateThresholdsAtomic({
      eventType: 'UNKNOWN_PERSON',
      tLow: 0.6,
      tHigh: 0.8,
      tWaitSeconds: 120,
      expectedVersion: updated.version,
      actorUserId: adminId,
    });
  });

  it('updateThresholdsAtomic ném RuleNotFoundError khi event_type không tồn tại', async () => {
    const adminUser = await pool.query<{ id: string }>(
      `SELECT id FROM users WHERE role = 'ADMIN' LIMIT 1`,
    );
    const adminId = adminUser.rows[0].id;

    await expect(
      repository.updateThresholdsAtomic({
        eventType: 'NON_EXISTENT_EVENT_TYPE',
        tLow: 0.5,
        tHigh: 0.7,
        tWaitSeconds: 30,
        expectedVersion: 1,
        actorUserId: adminId,
      }),
    ).rejects.toThrow(RuleNotFoundError);
  });
});
