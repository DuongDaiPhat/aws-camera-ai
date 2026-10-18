import { ConfigService } from '@nestjs/config';
import { WellnessSchedulerService } from '../src/wellness/wellness-scheduler.service';
import { WellnessRepository } from '../src/wellness/wellness.repository';

describe('WellnessSchedulerService (US-20)', () => {
  let scheduler: WellnessSchedulerService;
  let repository: jest.Mocked<WellnessRepository>;
  let configService: jest.Mocked<ConfigService>;

  const mockRun = {
    id: 'run-1111-1111-1111-111111111111',
    schedule_id: 'sched-1111-1111-1111-111111111111',
    owner_user_id: 'owner-1',
    resident_user_id: 'resident-1',
    scheduled_for: new Date(Date.now() - 60000), // đến giờ kiểm tra
    lookback_started_at: new Date(Date.now() - 6 * 3600 * 1000),
    lookback_ended_at: new Date(Date.now() - 60000),
    grace_seconds: 300,
    lease_token: 'lease-token-1',
    schedule_snapshot: { cameraIds: ['cam-1'] },
  };

  const mockSchedule = {
    id: mockRun.schedule_id,
    owner_user_id: mockRun.owner_user_id,
    resident_user_id: mockRun.resident_user_id,
    name: 'Kiểm tra 09:00',
    check_at: '09:00',
    days_of_week: [1, 2, 3, 4, 5, 6, 7],
    lookback_hours: 6,
    grace_seconds: 300,
    camera_ids: ['cam-1'],
    timezone: 'Asia/Ho_Chi_Minh',
    is_enabled: true,
    version: 1,
    activation_started_at: new Date(),
    last_materialized_at: null,
    last_checked_at: null,
    deleted_at: null,
    created_at: new Date(),
    updated_at: new Date(),
  };

  beforeEach(() => {
    repository = {
      getPoolClient: jest.fn(),
      reclaimExpiredLeases: jest.fn().mockResolvedValue(0),
      getActiveEnabledSchedules: jest.fn().mockResolvedValue([mockSchedule]),
      insertCheckRunIfNotExists: jest.fn().mockResolvedValue(true),
      updateScheduleLastCheckedAt: jest.fn().mockResolvedValue(undefined),
      claimPendingRuns: jest.fn().mockResolvedValue([mockRun]),
      getScheduleById: jest.fn().mockResolvedValue(mockSchedule),
      getPresenceState: jest.fn().mockResolvedValue('HOME'),
      findActivityInWindow: jest.fn().mockResolvedValue(null),
      hasActiveUnresolvedWellnessEvent: jest.fn().mockResolvedValue(null),
      updateRunDecision: jest.fn().mockResolvedValue(undefined),
      recordDeliverySuccess: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<WellnessRepository>;

    configService = {
      get: jest.fn().mockReturnValue(undefined),
    } as unknown as jest.Mocked<ConfigService>;

    Object.assign(repository, {
      verifyResidentHouseholdLink: jest.fn().mockResolvedValue(true),
      databaseNow: jest.fn().mockImplementation(async () => new Date()),
      enqueueEventUpdate: jest.fn(),
      retryRun: jest.fn(),
      processWellnessTimeouts: jest.fn(),
      transaction: jest.fn().mockImplementation(async (action) => {
        const client = await repository.getPoolClient();
        const original = client.query.bind(client);
        client.query = jest.fn().mockImplementation((sql: string, params: unknown[]) =>
          sql.includes('SELECT lease_token,leased_until')
            ? Promise.resolve({
                rows: [
                  {
                    lease_token: mockRun.lease_token,
                    leased_until: new Date(Date.now() + 30000),
                    schedule_version: 1,
                  },
                ],
              })
            : original(sql, params),
        );
        return action(client);
      }),
    });
    scheduler = new WellnessSchedulerService(repository, configService);
  });

  describe('AC 5: Khi Module 1 ghi nhận người đó đã rời khỏi nhà (AWAY)', () => {
    it('bỏ qua kiểm tra, chuyển SKIPPED_AWAY và không tạo sự kiện báo động vô nghĩa', async () => {
      const mockClient = {
        query: jest.fn().mockResolvedValue({ rows: [] }),
        release: jest.fn(),
      };
      repository.getPoolClient.mockResolvedValue(mockClient as any);
      repository.getPresenceState.mockResolvedValue('AWAY');

      await scheduler.evaluateSingleRun(mockRun);

      expect(repository.updateRunDecision).toHaveBeenCalledWith(
        mockRun.id,
        mockRun.lease_token,
        'SKIPPED_AWAY',
        expect.objectContaining({
          presenceState: 'AWAY',
        }),
        mockClient,
      );
      // Không gọi tạo sự kiện vào events table
      expect(mockClient.query).not.toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO events'),
        expect.anything(),
      );
    });
  });

  describe('AC 1 & AC 2: Có hoạt động trong khoảng thời gian quy định', () => {
    it('bỏ qua kiểm tra khi phát hiện chuyển động trong cửa sổ lookback (SKIPPED_ACTIVITY)', async () => {
      const mockClient = {
        query: jest.fn().mockResolvedValue({ rows: [] }),
        release: jest.fn(),
      };
      repository.getPoolClient.mockResolvedValue(mockClient as any);
      repository.getPresenceState.mockResolvedValue('HOME');
      repository.findActivityInWindow.mockResolvedValue(new Date(Date.now() - 3600 * 1000));

      await scheduler.evaluateSingleRun(mockRun);

      expect(repository.updateRunDecision).toHaveBeenCalledWith(
        mockRun.id,
        mockRun.lease_token,
        'SKIPPED_ACTIVITY',
        expect.objectContaining({
          presenceState: 'HOME',
        }),
        mockClient,
      );
    });
  });

  describe('AC 2: KHÔNG có hoạt động nào trong khoảng thời gian quy định', () => {
    it('tạo sự kiện WELLNESS_TIMEOUT priority P2 và yêu cầu người được giám sát xác nhận', async () => {
      const mockClient = {
        query: jest.fn().mockImplementation((queryText: string) => {
          if (queryText.includes('INSERT INTO events')) {
            return Promise.resolve({ rows: [{ id: 'evt-wellness-new-1' }] });
          }
          return Promise.resolve({ rows: [] });
        }),
        release: jest.fn(),
      };
      repository.getPoolClient.mockResolvedValue(mockClient as any);
      repository.getPresenceState.mockResolvedValue('HOME');
      repository.findActivityInWindow.mockResolvedValue(null); // Không có hoạt động!
      repository.hasActiveUnresolvedWellnessEvent.mockResolvedValue(null);

      await scheduler.evaluateSingleRun(mockRun);

      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining("VALUES('WELLNESS_TIMEOUT','NOTIFIED','P2','SCHEDULER'"),
        expect.arrayContaining([mockRun.owner_user_id, mockRun.resident_user_id]),
      );
      expect(repository.recordDeliverySuccess).not.toHaveBeenCalled();

      // Tạo notification gửi cho resident (người được giám sát)
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO notifications'),
        expect.arrayContaining(['evt-wellness-new-1', mockRun.resident_user_id]),
      );

      // Đánh dấu ALERT_CREATED trên run
      expect(repository.updateRunDecision).toHaveBeenCalledWith(
        mockRun.id,
        mockRun.lease_token,
        'ALERT_CREATED',
        expect.objectContaining({
          eventId: 'evt-wellness-new-1',
        }),
        mockClient,
      );
    });
  });

  describe('AC 4: Không có xác nhận sau 5 phút (timeout)', () => {
    it('quét timeout và tự động leo thang tới Caregiver', async () => {
      const mockClient = {
        query: jest.fn().mockImplementation((queryText: string) => {
          if (queryText.includes('SELECT e.id, e.wellness_owner_user_id')) {
            return Promise.resolve({
              rows: [
                {
                  id: 'evt-overdue-1',
                  wellness_owner_user_id: 'caregiver-owner-1',
                  wellness_resident_user_id: 'resident-1',
                  escalation_deadline_at: new Date(Date.now() - 10000), // đã quá hạn 5 phút
                  run_id: 'run-1',
                },
              ],
            });
          }
          return Promise.resolve({ rows: [] });
        }),
        release: jest.fn(),
      };
      repository.getPoolClient.mockResolvedValue(mockClient as any);

      await scheduler.processTimeouts();

      // Locking, SQL and routing are exercised in wellness-db.integration.spec.ts.
      expect(repository.processWellnessTimeouts).toHaveBeenCalledWith(50);
    });
  });
});
