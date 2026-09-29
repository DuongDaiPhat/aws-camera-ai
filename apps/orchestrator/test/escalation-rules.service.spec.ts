import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { EscalationRulesService } from '../src/escalation-rules/escalation-rules.service';
import {
  EscalationRulesRepository,
  RuleNotFoundError,
  RuleVersionConflictError,
  type EscalationRuleRecord,
} from '../src/escalation-rules/escalation-rules.repository';

describe('EscalationRulesService (US-15)', () => {
  let service: EscalationRulesService;
  let repository: jest.Mocked<EscalationRulesRepository>;

  const mockRuleRecord: EscalationRuleRecord = {
    id: '11111111-2222-3333-4444-555555555555',
    event_type: 'FALL_DETECTED',
    priority: 'P1',
    t_low: '0.550',
    t_high: '0.750',
    t_wait_seconds: 60,
    skip_logged_only: false,
    notify_channels: ['TELEGRAM'],
    escalate_channels: ['CONNECT_CALL'],
    max_escalation_level: 3,
    is_enabled: true,
    version: 1,
    updated_at: new Date('2026-09-25T08:00:00Z'),
    updated_by_name: 'Quản trị CameraAI',
  };

  beforeEach(() => {
    repository = {
      findAll: jest.fn(),
      findByEventType: jest.fn(),
      updateThresholdsAtomic: jest.fn(),
    } as unknown as jest.Mocked<EscalationRulesRepository>;

    service = new EscalationRulesService(repository);
  });

  describe('listRules', () => {
    it('trả về danh sách rule với effectiveHighWaitSeconds được tính toán chính xác', async () => {
      repository.findAll.mockResolvedValue([mockRuleRecord]);

      const result = await service.listRules();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        eventType: 'FALL_DETECTED',
        displayName: 'Phát hiện té ngã',
        priority: 'P1',
        tLow: 0.55,
        tHigh: 0.75,
        tWaitSeconds: 60,
        effectiveHighWaitSeconds: 30, // max(1, ceil(60/2))
        version: 1,
        updatedByName: 'Quản trị CameraAI',
      });
    });
  });

  describe('getRuleByEventType', () => {
    it('trả về rule khi tìm thấy', async () => {
      repository.findByEventType.mockResolvedValue(mockRuleRecord);

      const result = await service.getRuleByEventType('FALL_DETECTED');
      expect(result.eventType).toBe('FALL_DETECTED');
      expect(result.tLow).toBe(0.55);
    });

    it('ném NotFoundException khi không tìm thấy', async () => {
      repository.findByEventType.mockResolvedValue(null);

      await expect(service.getRuleByEventType('NON_EXISTENT')).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateThresholds', () => {
    const actor = {
      userId: 'admin-uuid',
      ipAddress: '127.0.0.1',
      userAgent: 'Mozilla/5.0',
      correlationId: 'req-123',
    };

    it('cập nhật thành công và trả về DTO với version mới', async () => {
      const updatedRecord: EscalationRuleRecord = {
        ...mockRuleRecord,
        t_low: '0.600',
        t_high: '0.800',
        t_wait_seconds: 45,
        version: 2,
        updated_at: new Date('2026-09-25T08:05:00Z'),
      };

      repository.updateThresholdsAtomic.mockResolvedValue(updatedRecord);

      const result = await service.updateThresholds(
        'FALL_DETECTED',
        {
          tLow: 0.6,
          tHigh: 0.8,
          tWaitSeconds: 45,
          expectedVersion: 1,
        },
        actor,
      );

      expect(result.version).toBe(2);
      expect(result.tLow).toBe(0.6);
      expect(result.tHigh).toBe(0.8);
      expect(result.tWaitSeconds).toBe(45);
      expect(result.effectiveHighWaitSeconds).toBe(23); // ceil(45/2) = 23
      expect(repository.updateThresholdsAtomic).toHaveBeenCalledWith({
        eventType: 'FALL_DETECTED',
        tLow: 0.6,
        tHigh: 0.8,
        tWaitSeconds: 45,
        expectedVersion: 1,
        actorUserId: actor.userId,
        clientIp: actor.ipAddress,
        userAgent: actor.userAgent,
        correlationId: actor.correlationId,
      });
    });

    it('ném BadRequestException khi T_low > T_high', async () => {
      await expect(
        service.updateThresholds(
          'FALL_DETECTED',
          {
            tLow: 0.9,
            tHigh: 0.7,
            tWaitSeconds: 60,
            expectedVersion: 1,
          },
          actor,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(repository.updateThresholdsAtomic).not.toHaveBeenCalled();
    });

    it('ném BadRequestException khi cấu hình ngưỡng cho WELLNESS_TIMEOUT', async () => {
      await expect(
        service.updateThresholds(
          'WELLNESS_TIMEOUT',
          {
            tLow: 0.5,
            tHigh: 0.8,
            tWaitSeconds: 300,
            expectedVersion: 1,
          },
          actor,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(repository.updateThresholdsAtomic).not.toHaveBeenCalled();
    });

    it('ném NotFoundException khi sửa loại sự kiện không hợp lệ', async () => {
      await expect(
        service.updateThresholds(
          'PERSON_DETECTED', // rule nội bộ không sửa qua form này
          {
            tLow: 0.5,
            tHigh: 0.8,
            tWaitSeconds: 60,
            expectedVersion: 1,
          },
          actor,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('ném ConflictException khi gặp lỗi version conflict (409)', async () => {
      repository.updateThresholdsAtomic.mockRejectedValue(new RuleVersionConflictError(2));

      await expect(
        service.updateThresholds(
          'FALL_DETECTED',
          {
            tLow: 0.6,
            tHigh: 0.8,
            tWaitSeconds: 60,
            expectedVersion: 1,
          },
          actor,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('ném NotFoundException khi repository báo RuleNotFoundError', async () => {
      repository.updateThresholdsAtomic.mockRejectedValue(new RuleNotFoundError());

      await expect(
        service.updateThresholds(
          'FALL_DETECTED',
          {
            tLow: 0.6,
            tHigh: 0.8,
            tWaitSeconds: 60,
            expectedVersion: 1,
          },
          actor,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
