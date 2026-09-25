import { ForbiddenException, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { EscalationRulesController } from '../src/escalation-rules/escalation-rules.controller';
import { EscalationRulesService } from '../src/escalation-rules/escalation-rules.service';
import { RolesGuard } from '../src/auth/roles.guard';
import type { EscalationRuleDto } from '../src/escalation-rules/dto/escalation-rule-response.dto';
import type { AuthenticatedRequest } from '../src/auth/jwt-auth.guard';

describe('EscalationRulesController & RolesGuard (US-15)', () => {
  let controller: EscalationRulesController;
  let service: jest.Mocked<EscalationRulesService>;

  const mockRuleDto: EscalationRuleDto = {
    version: 1,
    effectiveHighWaitSeconds: 15,
    eventType: 'FIRE_SMOKE_DETECTED',
    displayName: 'Phát hiện cháy / khói',
    priority: 'P0',
    tLow: 0.5,
    tHigh: 0.7,
    tWaitSeconds: 30,
    skipLoggedOnly: true,
    notifyChannels: ['TELEGRAM'],
    escalateChannels: ['CONNECT_CALL'],
    maxEscalationLevel: 3,
    isEnabled: true,
    updatedAt: '2026-09-25T08:00:00.000Z',
    updatedByName: 'Admin',
  };

  beforeEach(() => {
    service = {
      listRules: jest.fn(),
      getRuleByEventType: jest.fn(),
      updateThresholds: jest.fn(),
    } as unknown as jest.Mocked<EscalationRulesService>;

    controller = new EscalationRulesController(service);
  });

  describe('listRules', () => {
    it('trả về danh sách bọc trong trường data', async () => {
      service.listRules.mockResolvedValue([mockRuleDto]);

      const result = await controller.listRules();
      expect(result).toEqual({ data: [mockRuleDto] });
      expect(service.listRules).toHaveBeenCalledTimes(1);
    });
  });

  describe('updateThresholds', () => {
    it('gọi service với actor info từ request', async () => {
      service.updateThresholds.mockResolvedValue({
        ...mockRuleDto,
        version: 2,
        tWaitSeconds: 40,
      });

      const mockRequest = {
        auth: {
          sub: 'admin-id-123',
          role: 'ADMIN',
          email: 'admin@camerai.local',
        },
        headers: {
          'x-forwarded-for': '192.168.1.100',
          'user-agent': 'Chrome/120',
          'x-correlation-id': 'corr-abc',
        },
        ip: '127.0.0.1',
      } as unknown as AuthenticatedRequest;

      const result = await controller.updateThresholds(
        'FIRE_SMOKE_DETECTED',
        {
          tLow: 0.5,
          tHigh: 0.7,
          tWaitSeconds: 40,
          expectedVersion: 1,
        },
        mockRequest,
      );

      expect(result.version).toBe(2);
      expect(service.updateThresholds).toHaveBeenCalledWith(
        'FIRE_SMOKE_DETECTED',
        {
          tLow: 0.5,
          tHigh: 0.7,
          tWaitSeconds: 40,
          expectedVersion: 1,
        },
        {
          userId: 'admin-id-123',
          ipAddress: '192.168.1.100',
          userAgent: 'Chrome/120',
          correlationId: 'corr-abc',
        },
      );
    });
  });

  describe('RolesGuard', () => {
    let reflector: Reflector;
    let guard: RolesGuard;

    beforeEach(() => {
      reflector = new Reflector();
      guard = new RolesGuard(reflector);
    });

    function createMockContext(role?: string): ExecutionContext {
      return {
        getHandler: () => ({}),
        getClass: () => ({}),
        switchToHttp: () => ({
          getRequest: () => ({
            auth: role ? { role, sub: 'user-1' } : undefined,
          }),
        }),
      } as unknown as ExecutionContext;
    }

    it('cho phép truy cập khi user có role ADMIN khớp với yêu cầu', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['ADMIN']);

      const context = createMockContext('ADMIN');
      expect(guard.canActivate(context)).toBe(true);
    });

    it('ném ForbiddenException khi user có role CAREGIVER hoặc VIEWER', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['ADMIN']);

      const contextCaregiver = createMockContext('CAREGIVER');
      expect(() => guard.canActivate(contextCaregiver)).toThrow(ForbiddenException);

      const contextViewer = createMockContext('VIEWER');
      expect(() => guard.canActivate(contextViewer)).toThrow(ForbiddenException);
    });

    it('ném ForbiddenException khi user không có role hoặc chưa xác thực', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['ADMIN']);

      const contextAnonymous = createMockContext();
      expect(() => guard.canActivate(contextAnonymous)).toThrow(ForbiddenException);
    });

    it('cho phép truy cập nếu endpoint không đặt yêu cầu role', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);

      const context = createMockContext('VIEWER');
      expect(guard.canActivate(context)).toBe(true);
    });
  });
});
