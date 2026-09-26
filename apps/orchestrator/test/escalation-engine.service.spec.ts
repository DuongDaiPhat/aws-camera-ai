import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { EscalationEngineService } from '../src/escalation/escalation-engine.service';
import { EscalationRepository } from '../src/escalation/escalation.repository';
import { EscalationRulesRepository } from '../src/escalation-rules/escalation-rules.repository';
import type { EscalationRuleRecord } from '../src/escalation-rules/escalation-rules.repository';

describe('EscalationEngineService (US-13)', () => {
  let service: EscalationEngineService;
  let repository: jest.Mocked<EscalationRepository>;
  let mockClient: {
    query: jest.Mock;
    release: jest.Mock;
  };

  const defaultRules: EscalationRuleRecord[] = [
    {
      id: 'rule-1',
      event_type: 'FALL_DETECTED',
      priority: 'P1',
      t_low: '0.55',
      t_high: '0.75',
      t_wait_seconds: 60,
      skip_logged_only: false,
      notify_channels: ['TELEGRAM'],
      escalate_channels: ['CONNECT_CALL'],
      max_escalation_level: 2,
      is_enabled: true,
      version: 1,
      updated_at: new Date(),
      updated_by_name: null,
    },
    {
      id: 'rule-2',
      event_type: 'FIRE_SMOKE_DETECTED',
      priority: 'P0',
      t_low: '0.5',
      t_high: '0.7',
      t_wait_seconds: 30,
      skip_logged_only: true,
      notify_channels: ['TELEGRAM'],
      escalate_channels: ['CONNECT_CALL'],
      max_escalation_level: 2,
      is_enabled: true,
      version: 1,
      updated_at: new Date(),
      updated_by_name: null,
    },
  ];

  beforeEach(async () => {
    mockClient = {
      query: jest.fn().mockResolvedValue({ rows: [] }),
      release: jest.fn(),
    };

    const mockRepo = {
      getPoolClient: jest.fn().mockResolvedValue(mockClient),
      findEventForUpdate: jest.fn(),
      updateEventStatus: jest.fn(),
      createStatusHistory: jest.fn(),
      createConfirmation: jest.fn(),
      findAuthoritativeConfirmation: jest.fn(),
      createNotificationIntent: jest.fn(),
      findDueEventsForEscalation: jest.fn(),
    };

    const mockRulesRepo = {
      findAll: jest.fn().mockResolvedValue(defaultRules),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EscalationEngineService,
        { provide: EscalationRepository, useValue: mockRepo },
        { provide: EscalationRulesRepository, useValue: mockRulesRepo },
      ],
    }).compile();

    service = module.get<EscalationEngineService>(EscalationEngineService);
    repository = module.get(EscalationRepository);
  });

  describe('evaluateAndTransition', () => {
    it('chuyển DETECTED sang NOTIFIED và tạo notification intent khi rơi vào vùng xám', async () => {
      const detectedAt = new Date('2026-09-25T12:00:00Z');
      const mockEvent = {
        id: 'evt-1',
        event_type: 'FALL_DETECTED' as const,
        status: 'DETECTED' as const,
        priority: 'P1' as const,
        confidence: '0.65',
        ai_label: 'fall',
        ai_results: [],
        version: 1,
        detected_at: detectedAt,
        escalation_deadline_at: null,
        notified_at: null,
        escalated_at: null,
        resolved_at: null,
        closed_at: null,
        rule_snapshot: null,
        triggering_results: [],
      };

      repository.findEventForUpdate.mockResolvedValueOnce(mockEvent);
      repository.updateEventStatus.mockResolvedValueOnce({
        ...mockEvent,
        status: 'NOTIFIED',
        version: 2,
      });

      const updated = await service.evaluateAndTransition('evt-1', {
        eventType: 'FALL_DETECTED',
        confidence: 0.65,
        detectedAt,
      });

      expect(updated.status).toBe('NOTIFIED');
      expect(repository.findEventForUpdate).toHaveBeenCalledWith(mockClient, 'evt-1');
      expect(repository.updateEventStatus).toHaveBeenCalled();
      expect(repository.createNotificationIntent).toHaveBeenCalledWith(
        mockClient,
        expect.objectContaining({
          eventId: 'evt-1',
          channel: 'TELEGRAM',
          status: 'PENDING',
        }),
      );
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('bỏ qua transition nếu chuyển trạng thái không hợp lệ', async () => {
      const detectedAt = new Date('2026-09-25T12:00:00Z');
      const mockEvent = {
        id: 'evt-resolved',
        event_type: 'FALL_DETECTED' as const,
        status: 'RESOLVED' as const, // Trạng thái cuối cùng
        priority: 'P1' as const,
        confidence: '0.65',
        ai_label: 'fall',
        ai_results: [],
        version: 2,
        detected_at: detectedAt,
        escalation_deadline_at: null,
        notified_at: null,
        escalated_at: null,
        resolved_at: new Date(),
        closed_at: null,
        rule_snapshot: null,
        triggering_results: [],
      };

      repository.findEventForUpdate.mockResolvedValueOnce(mockEvent);

      const res = await service.evaluateAndTransition('evt-resolved', {
        eventType: 'FALL_DETECTED',
        confidence: 0.65,
        detectedAt,
      });

      expect(res.status).toBe('RESOLVED');
      expect(repository.updateEventStatus).not.toHaveBeenCalled();
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    });

    it('ném NotFoundException nếu không tìm thấy sự kiện', async () => {
      repository.findEventForUpdate.mockResolvedValueOnce(null);

      await expect(
        service.evaluateAndTransition('evt-not-found', {
          eventType: 'FALL_DETECTED',
          confidence: 0.9,
          detectedAt: new Date(),
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('confirmInitial', () => {
    const mockNotifiedEvent = {
      id: 'evt-1',
      event_type: 'FALL_DETECTED' as const,
      status: 'NOTIFIED' as const,
      priority: 'P1' as const,
      confidence: '0.65',
      ai_label: 'fall',
      ai_results: [],
      version: 1,
      detected_at: new Date(),
      escalation_deadline_at: new Date(Date.now() + 60000),
      notified_at: new Date(),
      escalated_at: null,
      resolved_at: null,
      closed_at: null,
      rule_snapshot: null,
      triggering_results: [],
    };

    it('xử lý IM_OK thành công chuyển sang RESOLVED', async () => {
      repository.findEventForUpdate.mockResolvedValueOnce(mockNotifiedEvent);
      repository.findAuthoritativeConfirmation.mockResolvedValueOnce(null);
      repository.createConfirmation.mockResolvedValueOnce({
        id: 'conf-1',
        event_id: 'evt-1',
        user_id: 'user-1',
        emergency_contact_id: null,
        channel: 'DASHBOARD',
        response: 'IM_OK',
        phase: 'INITIAL',
        is_authoritative: true,
        note: 'Bà đứng dậy rồi',
        responded_at: new Date(),
        confirmed_by_name: 'Lan Anh',
      });

      const res = await service.confirmInitial('evt-1', 'user-1', {
        response: 'IM_OK',
        note: 'Bà đứng dậy rồi',
      });

      expect(res.resultingStatus).toBe('RESOLVED');
      expect(res.response).toBe('IM_OK');
      expect(repository.updateEventStatus).toHaveBeenCalledWith(
        mockClient,
        'evt-1',
        1,
        expect.objectContaining({
          status: 'RESOLVED',
          escalationDeadlineAt: null,
        }),
      );
      expect(repository.createStatusHistory).toHaveBeenCalledWith(
        mockClient,
        expect.objectContaining({
          fromStatus: 'NOTIFIED',
          toStatus: 'RESOLVED',
          reason: 'USER_CONFIRMED_IM_OK',
        }),
      );
    });

    it('xử lý NEED_HELP chuyển sang ESCALATED và tạo thông báo khẩn cấp', async () => {
      repository.findEventForUpdate.mockResolvedValueOnce(mockNotifiedEvent);
      repository.findAuthoritativeConfirmation.mockResolvedValueOnce(null);
      repository.createConfirmation.mockResolvedValueOnce({
        id: 'conf-2',
        event_id: 'evt-1',
        user_id: 'user-1',
        emergency_contact_id: null,
        channel: 'DASHBOARD',
        response: 'NEED_HELP',
        phase: 'INITIAL',
        is_authoritative: true,
        note: 'Bà bị đau chân',
        responded_at: new Date(),
        confirmed_by_name: 'Lan Anh',
      });

      const res = await service.confirmInitial('evt-1', 'user-1', {
        response: 'NEED_HELP',
        note: 'Bà bị đau chân',
      });

      expect(res.resultingStatus).toBe('ESCALATED');
      expect(repository.updateEventStatus).toHaveBeenCalledWith(
        mockClient,
        'evt-1',
        1,
        expect.objectContaining({
          status: 'ESCALATED',
          escalationDeadlineAt: null,
        }),
      );
      expect(repository.createNotificationIntent).toHaveBeenCalledWith(
        mockClient,
        expect.objectContaining({
          eventId: 'evt-1',
          channel: 'CONNECT_CALL',
        }),
      );
    });

    it('từ chối phản hồi ACKNOWLEDGED trong giai đoạn ban đầu', async () => {
      await expect(
        service.confirmInitial('evt-1', 'user-1', {
          response: 'ACKNOWLEDGED' as any,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('ném ConflictException ALREADY_CONFIRMED và ghi log audit nếu đã có người xác nhận', async () => {
      repository.findEventForUpdate.mockResolvedValueOnce(mockNotifiedEvent);
      repository.findAuthoritativeConfirmation.mockResolvedValueOnce({
        id: 'conf-existing',
        event_id: 'evt-1',
        user_id: 'user-other',
        emergency_contact_id: null,
        channel: 'TELEGRAM',
        response: 'IM_OK',
        phase: 'INITIAL',
        is_authoritative: true,
        note: null,
        responded_at: new Date(),
        confirmed_by_name: 'Khác',
      });

      await expect(
        service.confirmInitial('evt-1', 'user-1', {
          response: 'IM_OK',
        }),
      ).rejects.toThrow(ConflictException);

      // Phải ghi nhận lần bấm thứ hai với isAuthoritative = false để kiểm toán
      expect(repository.createConfirmation).toHaveBeenCalledWith(
        mockClient,
        expect.objectContaining({
          eventId: 'evt-1',
          userId: 'user-1',
          isAuthoritative: false,
        }),
      );
    });

    it('ném ConflictException INVALID_STATE nếu sự kiện không ở NOTIFIED', async () => {
      const nonNotifiedEvent = { ...mockNotifiedEvent, status: 'ESCALATED' as const };
      repository.findEventForUpdate.mockResolvedValueOnce(nonNotifiedEvent);
      repository.findAuthoritativeConfirmation.mockResolvedValueOnce(null);

      await expect(
        service.confirmInitial('evt-1', 'user-1', {
          response: 'IM_OK',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('closeEmergency', () => {
    const mockEscalatedEvent = {
      id: 'evt-esc',
      event_type: 'FALL_DETECTED' as const,
      status: 'ESCALATED' as const,
      priority: 'P1' as const,
      confidence: '0.65',
      ai_label: 'fall',
      ai_results: [],
      version: 2,
      detected_at: new Date(),
      escalation_deadline_at: null,
      notified_at: new Date(),
      escalated_at: new Date(),
      resolved_at: null,
      closed_at: null,
      rule_snapshot: null,
      triggering_results: [],
    };

    it('đóng sự kiện ESCALATED sang CLOSED thành công', async () => {
      repository.findEventForUpdate.mockResolvedValueOnce(mockEscalatedEvent);
      repository.findAuthoritativeConfirmation.mockResolvedValueOnce(null);
      repository.createConfirmation.mockResolvedValueOnce({
        id: 'conf-close',
        event_id: 'evt-esc',
        user_id: 'user-admin',
        emergency_contact_id: null,
        channel: 'DASHBOARD',
        response: 'ACKNOWLEDGED',
        phase: 'EMERGENCY',
        is_authoritative: true,
        note: 'Đã đưa đi trạm y tế',
        responded_at: new Date(),
        confirmed_by_name: 'Quản trị viên',
      });

      const res = await service.closeEmergency('evt-esc', 'user-admin', {
        note: 'Đã đưa đi trạm y tế',
      });

      expect(res.resultingStatus).toBe('CLOSED');
      expect(res.response).toBe('ACKNOWLEDGED');
      expect(res.phase).toBe('EMERGENCY');
      expect(repository.updateEventStatus).toHaveBeenCalledWith(
        mockClient,
        'evt-esc',
        2,
        expect.objectContaining({
          status: 'CLOSED',
        }),
      );
    });

    it('ném ConflictException INVALID_STATE nếu sự kiện chưa ở trạng thái ESCALATED', async () => {
      const nonEscalated = { ...mockEscalatedEvent, status: 'NOTIFIED' as const };
      repository.findEventForUpdate.mockResolvedValueOnce(nonEscalated);

      await expect(
        service.closeEmergency('evt-esc', 'user-admin', {
          note: 'Xong',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('ném ConflictException ALREADY_CONFIRMED nếu sự kiện khẩn cấp đã được đóng trước đó', async () => {
      repository.findEventForUpdate.mockResolvedValueOnce(mockEscalatedEvent);
      repository.findAuthoritativeConfirmation.mockResolvedValueOnce({
        id: 'conf-closed-before',
        event_id: 'evt-esc',
        user_id: 'user-prior',
        emergency_contact_id: null,
        channel: 'DASHBOARD',
        response: 'ACKNOWLEDGED',
        phase: 'EMERGENCY',
        is_authoritative: true,
        note: 'Đã xử lý xong trước',
        responded_at: new Date(),
        confirmed_by_name: 'Người trước',
      });

      await expect(
        service.closeEmergency('evt-esc', 'user-admin', {
          note: 'Xong',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });
});
