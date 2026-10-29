import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { FireConfig } from '../src/fire/fire.config';
import { FireDeliveryService } from '../src/fire/fire-delivery.service';
import { FireIncidentsRepository } from '../src/fire/fire-incidents.repository';
import { AiResultsService } from '../src/ai-results/ai-results.service';
import { fireConfig } from './fire-fixtures';

describe('US-18 durable submission worker', () => {
  it('retries an unapplied receipt with the same payload and drains during feature rollback', async () => {
    const eventId = randomUUID();
    const work = {
      id: randomUUID(),
      event_id: eventId,
      lease_token: randomUUID(),
      pending_payload: {
        schemaVersion: 1,
        resultId: randomUUID(),
        eventId,
        observationId: 'fire:session:episode',
        revision: 1,
        module: 'M3_FIRE',
        modelVersion: 'fire-smoke-yolo26n-v1',
        processedAt: new Date().toISOString(),
        error: null,
        results: [
          {
            module: 'M3_FIRE',
            label: 'FIRE_SMOKE_DETECTED',
            confidence: 0.83,
            boundingBox: null,
            metadata: {},
          },
        ],
      },
    };
    const repository = {
      claim: jest.fn().mockResolvedValue(work),
      applied: jest.fn(),
      retry: jest.fn(),
    };
    const results = {
      submit: jest
        .fn()
        .mockRejectedValueOnce(new Error('Temporary AI result DB failure'))
        .mockResolvedValue({ disposition: 'DUPLICATE' }),
    };
    const module = await Test.createTestingModule({
      providers: [
        FireDeliveryService,
        { provide: FireConfig, useValue: fireConfig({ M3_ENABLED: 'false' }) },
        { provide: FireIncidentsRepository, useValue: repository },
        { provide: AiResultsService, useValue: results },
      ],
    }).compile();
    try {
      const delivery = module.get(FireDeliveryService);
      await delivery.dispatch();
      expect(repository.retry).toHaveBeenCalledWith(work, 5, 'FIRE_RESULT_DELIVERY_FAILED');
      expect(repository.applied).not.toHaveBeenCalled();
      await delivery.dispatch();
      expect(results.submit.mock.calls[1]).toEqual(results.submit.mock.calls[0]);
      expect(repository.applied).toHaveBeenCalledWith(work);
    } finally {
      await module.close();
    }
  });
});
