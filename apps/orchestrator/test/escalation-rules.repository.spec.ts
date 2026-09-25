import type { Pool } from 'pg';
import {
  EscalationRulesRepository,
  RuleNotFoundError,
  RuleVersionConflictError,
} from '../src/escalation-rules/escalation-rules.repository';

describe('EscalationRulesRepository Unit', () => {
  let repository: EscalationRulesRepository;
  let mockPool: { query: jest.Mock; connect: jest.Mock };
  let mockClient: { query: jest.Mock; release: jest.Mock };

  beforeEach(() => {
    mockClient = {
      query: jest.fn(),
      release: jest.fn(),
    };
    mockPool = {
      query: jest.fn(),
      connect: jest.fn().mockResolvedValue(mockClient),
    };
    repository = new EscalationRulesRepository(mockPool as unknown as Pool);
  });

  describe('findAll', () => {
    it('tra ve danh sach cac rules sap xep theo priority', async () => {
      const mockRows = [
        { id: '1', event_type: 'FIRE_SMOKE_DETECTED', priority: 'P0', version: 1 },
        { id: '2', event_type: 'FALL_DETECTED', priority: 'P1', version: 1 },
      ];
      mockPool.query.mockResolvedValueOnce({ rows: mockRows });

      const result = await repository.findAll();
      expect(result).toEqual(mockRows);
      expect(mockPool.query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY'));
    });
  });

  describe('findByEventType', () => {
    it('tra ve rule neu tim thay event_type', async () => {
      const mockRule = {
        id: '1',
        event_type: 'FALL_DETECTED',
        priority: 'P1',
        t_low: '0.60',
        t_high: '0.80',
        t_wait_seconds: 45,
        version: 2,
      };
      mockPool.query.mockResolvedValueOnce({ rows: [mockRule] });

      const result = await repository.findByEventType('FALL_DETECTED');
      expect(result).toEqual(mockRule);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE er.event_type::text = $1'),
        ['FALL_DETECTED'],
      );
    });

    it('tra ve null neu khong tim thay rule', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      const result = await repository.findByEventType('UNKNOWN_EVENT');
      expect(result).toBeNull();
    });
  });

  describe('updateThresholdsAtomic', () => {
    const updateParams = {
      eventType: 'FALL_DETECTED',
      tLow: 0.65,
      tHigh: 0.85,
      tWaitSeconds: 60,
      expectedVersion: 1,
      actorUserId: 'admin-123',
      clientIp: '127.0.0.1',
      userAgent: 'Mozilla/5.0',
      correlationId: 'req-1',
    };

    it('cap nhat thanh cong trong transaction va ghi audit log', async () => {
      // 1. SELECT FOR UPDATE returns current rule
      mockClient.query.mockResolvedValueOnce({}); // BEGIN
      mockClient.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'rule-1',
            event_type: 'FALL_DETECTED',
            version: 1,
            t_low: '0.60',
            t_high: '0.80',
            t_wait_seconds: 45,
          },
        ],
      });
      // 2. UPDATE returns updated rule
      const updatedRecord = {
        id: 'rule-1',
        event_type: 'FALL_DETECTED',
        version: 2,
        t_low: '0.65',
        t_high: '0.85',
        t_wait_seconds: 60,
        updated_by_user_id: 'admin-123',
      };
      mockClient.query.mockResolvedValueOnce({ rows: [updatedRecord] });
      // 3. INSERT audit log
      mockClient.query.mockResolvedValueOnce({});
      // 4. COMMIT
      mockClient.query.mockResolvedValueOnce({});
      // 5. SELECT user name
      mockPool.query.mockResolvedValueOnce({ rows: [{ full_name: 'Quản trị viên' }] });

      const result = await repository.updateThresholdsAtomic(updateParams);

      expect(result.version).toBe(2);
      expect(result.updated_by_name).toBe('Quản trị viên');
      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('nem RuleNotFoundError neu rule khong ton tai', async () => {
      mockClient.query.mockResolvedValueOnce({}); // BEGIN
      mockClient.query.mockResolvedValueOnce({ rows: [] }); // SELECT FOR UPDATE returns empty

      await expect(repository.updateThresholdsAtomic(updateParams)).rejects.toThrow(
        RuleNotFoundError,
      );
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('nem RuleVersionConflictError neu version bi lech so voi expectedVersion', async () => {
      mockClient.query.mockResolvedValueOnce({}); // BEGIN
      mockClient.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'rule-1',
            event_type: 'FALL_DETECTED',
            version: 2, // Current is 2, expected is 1
            t_low: '0.60',
            t_high: '0.80',
            t_wait_seconds: 45,
          },
        ],
      });

      await expect(repository.updateThresholdsAtomic(updateParams)).rejects.toThrow(
        RuleVersionConflictError,
      );
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('rollback va rethrow khi gap loi he thong', async () => {
      mockClient.query.mockResolvedValueOnce({}); // BEGIN
      mockClient.query.mockRejectedValueOnce(new Error('Connection dropped'));

      await expect(repository.updateThresholdsAtomic(updateParams)).rejects.toThrow(
        'Connection dropped',
      );
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();
    });
  });
});
