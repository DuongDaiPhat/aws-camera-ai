import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EscalationDeadlineWorkerService } from '../src/escalation/escalation-deadline-worker.service';
import { EscalationRepository } from '../src/escalation/escalation.repository';

describe('EscalationDeadlineWorkerService (US-13)', () => {
  let service: EscalationDeadlineWorkerService;
  let repository: jest.Mocked<EscalationRepository>;
  let mockClient: {
    query: jest.Mock;
    release: jest.Mock;
  };

  beforeEach(async () => {
    mockClient = {
      query: jest.fn().mockResolvedValue({ rows: [] }),
      release: jest.fn(),
    };

    const mockRepo = {
      getPoolClient: jest.fn().mockResolvedValue(mockClient),
      findDueEventsForEscalation: jest.fn(),
      updateEventStatus: jest.fn(),
      createStatusHistory: jest.fn(),
      createNotificationIntent: jest.fn(),
    };

    const mockConfig = {
      get: jest.fn((key: string) => {
        if (key === 'ESCALATION_POLL_INTERVAL_MS') return 10000;
        if (key === 'ESCALATION_BATCH_SIZE') return 5;
        return undefined;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EscalationDeadlineWorkerService,
        { provide: EscalationRepository, useValue: mockRepo },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get<EscalationDeadlineWorkerService>(EscalationDeadlineWorkerService);
    repository = module.get(EscalationRepository);
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  it('không làm gì nếu không có sự kiện nào quá hạn deadline', async () => {
    repository.findDueEventsForEscalation.mockResolvedValueOnce([]);

    const count = await service.scanAndProcessDueDeadlines();

    expect(count).toBe(0);
    expect(repository.updateEventStatus).not.toHaveBeenCalled();
    expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('tự động chuyển các sự kiện quá hạn sang ESCALATED và tạo thông báo cấp 1', async () => {
    const pastDeadline = new Date(Date.now() - 5000);
    const mockDueEvents = [
      {
        id: 'evt-timeout-1',
        event_type: 'FALL_DETECTED' as const,
        status: 'NOTIFIED' as const,
        priority: 'P1' as const,
        confidence: '0.65',
        ai_label: 'fall',
        ai_results: [],
        version: 1,
        detected_at: new Date(Date.now() - 65000),
        escalation_deadline_at: pastDeadline,
        notified_at: new Date(Date.now() - 60000),
        escalated_at: null,
        resolved_at: null,
        closed_at: null,
        rule_snapshot: null,
        triggering_results: [],
      },
    ];

    repository.findDueEventsForEscalation.mockResolvedValueOnce(mockDueEvents);

    const count = await service.scanAndProcessDueDeadlines();

    expect(count).toBe(1);
    expect(repository.updateEventStatus).toHaveBeenCalledWith(
      mockClient,
      'evt-timeout-1',
      1,
      expect.objectContaining({
        status: 'ESCALATED',
        escalationDeadlineAt: null,
      }),
    );
    expect(repository.createStatusHistory).toHaveBeenCalledWith(
      mockClient,
      expect.objectContaining({
        eventId: 'evt-timeout-1',
        fromStatus: 'NOTIFIED',
        toStatus: 'ESCALATED',
        reason: 'TIMEOUT',
        actorType: 'SYSTEM',
      }),
    );
    expect(repository.createNotificationIntent).toHaveBeenCalledWith(
      mockClient,
      expect.objectContaining({
        eventId: 'evt-timeout-1',
        channel: 'CONNECT_CALL',
        status: 'PENDING',
        escalationLevel: 1,
      }),
    );
    expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
  });

  it('ngăn chặn quét song song (concurrency guard)', async () => {
    let resolveFirstQuery: () => void = () => {};
    const firstQueryPromise = new Promise<{ rows: any[] }>((resolve) => {
      resolveFirstQuery = () => resolve({ rows: [] });
    });

    repository.findDueEventsForEscalation.mockImplementationOnce(async () => {
      await firstQueryPromise;
      return [];
    });

    const run1 = service.scanAndProcessDueDeadlines();
    const run2 = await service.scanAndProcessDueDeadlines();

    expect(run2).toBe(0); // Bị bỏ qua do isProcessing = true

    resolveFirstQuery();
    await run1;
  });
});
