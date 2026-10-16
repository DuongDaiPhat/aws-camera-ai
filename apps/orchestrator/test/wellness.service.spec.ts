import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { WellnessService } from '../src/wellness/wellness.service';
import { WellnessRepository } from '../src/wellness/wellness.repository';
import type { TokenClaims } from '../src/auth/auth.types';

describe('WellnessService (US-20)', () => {
  let service: WellnessService;
  let repository: jest.Mocked<WellnessRepository>;

  const caregiverUser: TokenClaims = {
    sub: '11111111-1111-4111-8111-111111111111',
    email: 'caregiver@example.com',
    role: 'CAREGIVER',
    tokenType: 'access',
    jti: 'jti-1',
  };

  const residentUser: TokenClaims = {
    sub: '22222222-2222-4222-8222-222222222222',
    email: 'resident@example.com',
    role: 'VIEWER',
    tokenType: 'access',
    jti: 'jti-2',
  };

  const otherUser: TokenClaims = {
    sub: '99999999-9999-4999-8999-999999999999',
    email: 'other@example.com',
    role: 'VIEWER',
    tokenType: 'access',
    jti: 'jti-3',
  };

  const mockSchedule = {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    owner_user_id: caregiverUser.sub,
    resident_user_id: residentUser.sub,
    name: 'Kiểm tra sáng',
    check_at: '09:00',
    days_of_week: [1, 2, 3, 4, 5, 6, 7],
    lookback_hours: 6,
    grace_seconds: 300,
    camera_ids: [],
    timezone: 'Asia/Ho_Chi_Minh',
    is_enabled: true,
    version: 1,
    activation_started_at: new Date('2026-10-14T00:00:00Z'),
    last_materialized_at: null,
    last_checked_at: null,
    deleted_at: null,
    created_at: new Date('2026-10-14T00:00:00Z'),
    updated_at: new Date('2026-10-14T00:00:00Z'),
  };

  beforeEach(() => {
    repository = {
      getPoolClient: jest.fn(),
      listSchedules: jest.fn(),
      getScheduleById: jest.fn(),
      findConflictingSchedule: jest.fn(),
      createSchedule: jest.fn(),
      updateSchedule: jest.fn(),
      deleteSchedule: jest.fn(),
      verifyResidentHouseholdLink: jest.fn(),
      findObservationById: jest.fn(),
      saveObservation: jest.fn(),
      getPresenceState: jest.fn(),
      updatePresence: jest.fn(),
      findActivityInWindow: jest.fn(),
      hasActiveUnresolvedWellnessEvent: jest.fn(),
      listChecks: jest.fn(),
      getCheckById: jest.fn(),
      getCheckByEventId: jest.fn(),
      getActiveEnabledSchedules: jest.fn(),
      insertCheckRunIfNotExists: jest.fn(),
      updateScheduleLastCheckedAt: jest.fn(),
      claimPendingRuns: jest.fn(),
      reclaimExpiredLeases: jest.fn(),
      updateRunDecision: jest.fn(),
      recordDeliverySuccess: jest.fn(),
      findDueDeliveryTimeouts: jest.fn(),
    } as unknown as jest.Mocked<WellnessRepository>;

    service = new WellnessService(repository);
  });

  describe('Schedules Management', () => {
    it('cho phép Caregiver tạo lịch khi thông tin hợp lệ', async () => {
      repository.verifyResidentHouseholdLink.mockResolvedValue(true);
      repository.findConflictingSchedule.mockResolvedValue(null);
      repository.createSchedule.mockResolvedValue(mockSchedule);

      const result = await service.createSchedule(caregiverUser, {
        residentUserId: residentUser.sub,
        name: 'Kiểm tra sáng',
        checkAt: '09:00',
        daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
      });

      expect(result).toEqual(mockSchedule);
      expect(repository.createSchedule).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerUserId: caregiverUser.sub,
          residentUserId: residentUser.sub,
          checkAt: '09:00',
        }),
      );
    });

    it('từ chối khi người dùng có role VIEWER cố tạo lịch', async () => {
      await expect(
        service.createSchedule(residentUser, {
          residentUserId: residentUser.sub,
          name: 'Kiểm tra sáng',
          checkAt: '09:00',
          daysOfWeek: [1, 2, 3],
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('từ chối khi resident không thuộc hộ', async () => {
      repository.verifyResidentHouseholdLink.mockResolvedValue(false);

      await expect(
        service.createSchedule(caregiverUser, {
          residentUserId: 'invalid-resident',
          name: 'Kiểm tra sáng',
          checkAt: '09:00',
          daysOfWeek: [1, 2, 3],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('từ chối tạo lịch nếu đã trùng giờ check_at cho cùng resident', async () => {
      repository.verifyResidentHouseholdLink.mockResolvedValue(true);
      repository.findConflictingSchedule.mockResolvedValue(mockSchedule);

      await expect(
        service.createSchedule(caregiverUser, {
          residentUserId: residentUser.sub,
          name: 'Kiểm tra trùng',
          checkAt: '09:00',
          daysOfWeek: [1, 2, 3],
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('xóa mềm lịch thành công khi là Caregiver sở hữu', async () => {
      repository.getScheduleById.mockResolvedValue(mockSchedule);
      repository.deleteSchedule.mockResolvedValue(true);

      await service.deleteSchedule(caregiverUser, mockSchedule.id);
      expect(repository.deleteSchedule).toHaveBeenCalledWith(mockSchedule.id);
    });

    it('không cho phép Caregiver xóa lịch của hộ khác', async () => {
      repository.getScheduleById.mockResolvedValue({
        ...mockSchedule,
        owner_user_id: 'other-owner',
      });

      await expect(service.deleteSchedule(caregiverUser, mockSchedule.id)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('confirmCheck', () => {
    const mockCheckId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const mockEventId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

    const createMockClient = (options: { eventStatus?: string; existingConfirmation?: any }) => {
      return {
        query: jest.fn().mockImplementation((queryText: string) => {
          if (queryText.includes('SELECT id, status, version')) {
            return Promise.resolve({
              rows: [
                {
                  id: mockEventId,
                  status: options.eventStatus ?? 'NOTIFIED',
                  version: 1,
                  escalation_deadline_at: new Date(Date.now() + 200000),
                },
              ],
            });
          }
          if (queryText.includes('SELECT id, event_id, response')) {
            return Promise.resolve({
              rows: options.existingConfirmation ? [options.existingConfirmation] : [],
            });
          }
          if (queryText.includes('INSERT INTO confirmations')) {
            return Promise.resolve({
              rows: [{ id: 'conf-1', responded_at: new Date() }],
            });
          }
          return Promise.resolve({ rows: [] });
        }),
        release: jest.fn(),
      };
    };

    it('xác nhận "Tôi ổn" (IM_OK) trong vòng 5 phút chuyển event sang RESOLVED', async () => {
      const mockClient = createMockClient({ eventStatus: 'NOTIFIED' });
      repository.getPoolClient.mockResolvedValue(mockClient as any);

      repository.getCheckById.mockResolvedValue({
        ...mockSchedule,
        id: mockCheckId,
        event_id: mockEventId,
        request_sent_at: new Date(Date.now() - 60000), // đã gửi 1 phút trước
        confirmation_deadline_at: new Date(Date.now() + 240000), // còn 4 phút nữa mới hết hạn
        schedule_id: mockSchedule.id,
        local_date: '2026-10-14',
        scheduled_for: new Date(),
        schedule_version: 1,
        schedule_snapshot: {},
        lookback_started_at: new Date(),
        lookback_ended_at: new Date(),
        last_activity_at: null,
        presence_state: 'HOME',
        presence_observation_id: null,
        status: 'ALERT_CREATED',
        decision_reason: null,
        evaluated_at: new Date(),
        delivery_deadline_at: null,
        attempt_count: 1,
        available_at: new Date(),
        leased_until: null,
        lease_token: null,
        last_error: null,
      });

      const res = await service.confirmCheck(residentUser, mockCheckId, {
        commandId: 'cmd-uuid-1',
        response: 'IM_OK',
        note: 'Tôi khỏe',
      });

      expect(res.response).toBe('IM_OK');
      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining(
          'UPDATE events\n         SET status = $2,\n             resolved_at',
        ),
        expect.arrayContaining([mockEventId, 'RESOLVED']),
      );
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    });

    it('người dùng khác (không phải resident của check) bị cấm xác nhận', async () => {
      const mockClient = createMockClient({});
      repository.getPoolClient.mockResolvedValue(mockClient as any);

      repository.getCheckById.mockResolvedValue({
        ...mockSchedule,
        id: mockCheckId,
        resident_user_id: residentUser.sub,
        event_id: mockEventId,
        request_sent_at: new Date(),
      } as any);

      await expect(
        service.confirmCheck(otherUser, mockCheckId, {
          commandId: 'cmd-uuid-2',
          response: 'IM_OK',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('từ chối khi quá hạn 5 phút và tự động escalate tới Caregiver', async () => {
      const mockClient = createMockClient({ eventStatus: 'NOTIFIED' });
      repository.getPoolClient.mockResolvedValue(mockClient as any);

      repository.getCheckById.mockResolvedValue({
        ...mockSchedule,
        id: mockCheckId,
        resident_user_id: residentUser.sub,
        event_id: mockEventId,
        request_sent_at: new Date(Date.now() - 400000),
        confirmation_deadline_at: new Date(Date.now() - 100000), // đã quá hạn deadline
      } as any);

      await expect(
        service.confirmCheck(residentUser, mockCheckId, {
          commandId: 'cmd-uuid-3',
          response: 'IM_OK',
        }),
      ).rejects.toThrow(ConflictException);

      // Xác nhận có gọi UPDATE events SET status = 'ESCALATED'
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE events\n             SET status = 'ESCALATED'"),
        [mockEventId],
      );
    });

    it('idempotency: gửi lại cùng commandId và cùng response trả về kết quả 200 trước đó', async () => {
      const mockClient = createMockClient({
        existingConfirmation: {
          id: 'conf-old-1',
          event_id: mockEventId,
          response: 'IM_OK',
          responded_at: new Date('2026-10-14T09:02:00Z'),
          is_authoritative: true,
          source_message_id: 'cmd-replay-1',
        },
      });
      repository.getPoolClient.mockResolvedValue(mockClient as any);

      repository.getCheckById.mockResolvedValue({
        ...mockSchedule,
        id: mockCheckId,
        resident_user_id: residentUser.sub,
        event_id: mockEventId,
        request_sent_at: new Date(),
        confirmation_deadline_at: new Date(Date.now() + 100000),
      } as any);

      const res = await service.confirmCheck(residentUser, mockCheckId, {
        commandId: 'cmd-replay-1',
        response: 'IM_OK',
      });

      expect(res.id).toBe('conf-old-1');
      expect(res.response).toBe('IM_OK');
    });
  });

  describe('submitObservation', () => {
    it('nhận quan sát MOTION hợp lệ và cập nhật presence HOME', async () => {
      repository.findObservationById.mockResolvedValue(null);

      const res = await service.submitObservation({
        observationId: 'obs-1111-1111-1111-111111111111',
        ownerUserId: caregiverUser.sub,
        residentUserId: residentUser.sub,
        knownFaceId: 'face-1111-1111-1111-111111111111',
        identityEventId: 'evt-1111-1111-1111-111111111111',
        cameraId: 'cam-1111-1111-1111-111111111111',
        sourceSessionId: 'sess-1',
        trackId: 'track-1',
        kind: 'MOTION',
        observedAt: '2026-10-14T08:00:00Z',
      });

      expect(res.status).toBe('ACCEPTED');
      expect(res.presenceUpdated).toBe(true);
      expect(repository.saveObservation).toHaveBeenCalled();
      expect(repository.updatePresence).toHaveBeenCalledWith(
        expect.objectContaining({
          state: 'HOME',
        }),
      );
    });

    it('nhận quan sát DEPARTURE và cập nhật presence AWAY', async () => {
      repository.findObservationById.mockResolvedValue(null);

      const res = await service.submitObservation({
        observationId: 'obs-2222-2222-2222-222222222222',
        ownerUserId: caregiverUser.sub,
        residentUserId: residentUser.sub,
        knownFaceId: 'face-1111-1111-1111-111111111111',
        identityEventId: 'evt-1111-1111-1111-111111111111',
        cameraId: 'cam-1111-1111-1111-111111111111',
        sourceSessionId: 'sess-1',
        trackId: 'track-1',
        kind: 'DEPARTURE',
        observedAt: '2026-10-14T08:30:00Z',
        directionalEvidence: {
          boundaryId: 'front_door',
          direction: 'EXIT',
          policyVersion: 'v1',
        },
      });

      expect(res.status).toBe('ACCEPTED');
      expect(res.presenceUpdated).toBe(true);
      expect(repository.updatePresence).toHaveBeenCalledWith(
        expect.objectContaining({
          state: 'AWAY',
        }),
      );
    });
  });
});
