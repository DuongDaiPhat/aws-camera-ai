import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AiResultOutboxService } from '../src/ai-results/ai-result-outbox.service';
import { AiResultsRepository } from '../src/ai-results/ai-results.repository';
import { EscalationEngineService } from '../src/escalation/escalation-engine.service';
import { EventsRepository } from '../src/events/events.repository';
import { EventsService } from '../src/events/events.service';

describe('AI result outbox (US-11)', () => {
  const eventId = '11111111-1111-4111-8111-111111111111';
  const messageId = '22222222-2222-4222-8222-222222222222';
  const candidate = {
    eventType: 'UNKNOWN_PERSON',
    resultId: '44444444-4444-4444-8444-444444444444',
    observationId: 'face-observation',
    processedAt: '2026-09-26T10:00:01.000Z',
    module: 'M1_FACE',
    label: 'UNKNOWN',
    confidence: 0.85,
    modelVersion: 'face-v1',
  };
  const escalationMessage = {
    id: messageId,
    event_id: eventId,
    aggregate_version: '1',
    message_type: 'evaluate-escalation',
    payload: { candidates: [candidate] },
  };
  const snapshot = {
    event_type: 'UNKNOWN_PERSON',
    status: 'DETECTED',
    detected_at: new Date('2026-09-26T10:00:00.000Z'),
    confidence: '0.850',
    ai_label: 'UNKNOWN',
    aggregate_version: '1',
  };
  const repository = {
    claimOutboxMessage: jest.fn(),
    findEscalationSnapshot: jest.fn(),
    markOutboxProcessed: jest.fn(),
    releaseOutboxMessage: jest.fn(),
  };
  const eventsRepository = { findEventSummaryById: jest.fn() };
  const eventsService = { toEventSummary: jest.fn(), emitEvent: jest.fn() };
  const escalationEngine = { evaluateAndTransition: jest.fn() };
  let worker: AiResultOutboxService;

  beforeEach(async () => {
    jest.clearAllMocks();
    repository.claimOutboxMessage.mockResolvedValueOnce(escalationMessage).mockResolvedValue(null);
    repository.findEscalationSnapshot.mockResolvedValue(snapshot);
    repository.markOutboxProcessed.mockResolvedValue(undefined);
    repository.releaseOutboxMessage.mockResolvedValue(undefined);
    escalationEngine.evaluateAndTransition.mockResolvedValue({ status: 'NOTIFIED' });
    const module = await Test.createTestingModule({
      providers: [
        AiResultOutboxService,
        { provide: ConfigService, useValue: { getOrThrow: (): string => '3' } },
        { provide: AiResultsRepository, useValue: repository },
        { provide: EventsRepository, useValue: eventsRepository },
        { provide: EventsService, useValue: eventsService },
        { provide: EscalationEngineService, useValue: escalationEngine },
      ],
    }).compile();
    worker = module.get(AiResultOutboxService);
  });

  it('chuyển đủ candidates và outbox ID cho state service', async () => {
    await worker.dispatchAvailable();

    expect(escalationEngine.evaluateAndTransition).toHaveBeenCalledWith(
      eventId,
      {
        eventType: 'UNKNOWN_PERSON',
        detectedAt: snapshot.detected_at,
        aiResults: [candidate],
        confidence: 0.85,
        aiLabel: 'UNKNOWN',
      },
      messageId,
    );
    expect(repository.markOutboxProcessed).not.toHaveBeenCalled();
  });

  it('bỏ qua bản đánh giá cũ khi event đã có aggregate mới hơn', async () => {
    repository.findEscalationSnapshot.mockResolvedValue({ ...snapshot, aggregate_version: '2' });

    await worker.dispatchAvailable();

    expect(escalationEngine.evaluateAndTransition).not.toHaveBeenCalled();
    expect(repository.markOutboxProcessed).toHaveBeenCalledWith(messageId);
  });

  it('giữ outbox để retry khi state service lỗi', async () => {
    escalationEngine.evaluateAndTransition.mockRejectedValue(new Error('database unavailable'));

    await worker.dispatchAvailable();

    expect(repository.releaseOutboxMessage).toHaveBeenCalledWith(
      messageId,
      3,
      'database unavailable',
    );
  });

  it('phát SSE sau khi bản đánh giá đã xử lý', async () => {
    const updateMessage = {
      ...escalationMessage,
      id: '33333333-3333-4333-8333-333333333333',
      message_type: 'event.updated',
      payload: { eventId, aggregateVersion: 1 },
    };
    repository.claimOutboxMessage
      .mockReset()
      .mockResolvedValueOnce(escalationMessage)
      .mockResolvedValueOnce(updateMessage)
      .mockResolvedValue(null);
    eventsRepository.findEventSummaryById.mockResolvedValue({ id: eventId });
    eventsService.toEventSummary.mockResolvedValue({ id: eventId, status: 'NOTIFIED' });

    await worker.dispatchAvailable();

    expect(eventsService.emitEvent).toHaveBeenCalledWith(
      { id: eventId, status: 'NOTIFIED' },
      'event.updated',
    );
    expect(escalationEngine.evaluateAndTransition.mock.invocationCallOrder[0]).toBeLessThan(
      eventsService.emitEvent.mock.invocationCallOrder[0],
    );
  });
});
