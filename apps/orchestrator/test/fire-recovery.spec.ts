import { ConfigService } from '@nestjs/config';
import { FireFramesConsumer } from '../src/fire/fire-frames.consumer';
import { FireProcessorService } from '../src/fire/fire-processor.service';
import { FireTelemetry } from '../src/fire/fire-telemetry.service';
import { FireConfig } from '../src/fire/fire.config';
import { FireAiClient } from '../src/fire/fire-ai.client';
import { FireIncidentsRepository } from '../src/fire/fire-incidents.repository';
import { MediaService } from '../src/media/media.service';
import { EventsService } from '../src/events/events.service';
import { Test } from '@nestjs/testing';
import { confirmedFire, fireConfig, fireFrame, fireResponse } from './fire-fixtures';
import type { FireFrame } from '../src/fire/fire.dto';

describe('US-18 recovery', () => {
  it('requests three fresh observations when an earlier AI confirmation response was lost', async () => {
    const at = Date.now() - 600;
    const repository = {
      findEnabledCamera: jest.fn().mockResolvedValue('camera-id'),
      confirm: jest.fn().mockResolvedValue({ created: false }),
      clearActive: jest.fn(),
    };
    const evidence: FireFrame[] = [];
    const ai = {
      detect: jest
        .fn()
        .mockImplementation(async (frame: FireFrame) => {
          evidence.push(frame);
          return fireResponse(frame, evidence);
        })
        .mockResolvedValueOnce({ ...confirmedFire(at), reason: 'ACTIVE_EPISODE' }),
    };
    const module = await Test.createTestingModule({
      providers: [
        FireProcessorService,
        FireTelemetry,
        { provide: FireConfig, useValue: fireConfig() },
        { provide: FireAiClient, useValue: ai },
        { provide: FireIncidentsRepository, useValue: repository },
        { provide: MediaService, useValue: { storeCameraSnapshot: jest.fn() } },
        { provide: EventsService, useValue: { publishCommittedUpdate: jest.fn() } },
      ],
    }).compile();
    try {
      const service = module.get(FireProcessorService);
      await service.process(fireFrame(at));
      expect(repository.confirm).not.toHaveBeenCalled();
      await service.process(fireFrame(at + 200));
      await service.process(fireFrame(at + 400));
      expect(repository.confirm).not.toHaveBeenCalled();
      await service.process(fireFrame(at + 600));
      expect(repository.confirm).toHaveBeenCalledTimes(1);
      expect(evidence[0].header.sourceSessionId).not.toBe('source-1');
      expect(new Set(evidence.map((frame) => frame.header.sourceSessionId)).size).toBe(1);
    } finally {
      await module.close();
    }
  });

  it('retains the same confirmation payload and JPEG across a temporary DB failure', async () => {
    jest.useFakeTimers();
    const repository = {
      findEnabledCamera: jest.fn().mockResolvedValue('camera-id'),
      confirm: jest
        .fn()
        .mockRejectedValueOnce(new Error('DB temporarily unavailable'))
        .mockResolvedValue({ created: true, eventId: 'event' }),
    };
    const ai = { detect: jest.fn() };
    const media = { storeCameraSnapshot: jest.fn().mockResolvedValue(null) };
    const module = await Test.createTestingModule({
      providers: [
        FireProcessorService,
        FireTelemetry,
        { provide: FireConfig, useValue: fireConfig() },
        { provide: FireAiClient, useValue: ai },
        { provide: FireIncidentsRepository, useValue: repository },
        { provide: MediaService, useValue: media },
        { provide: EventsService, useValue: { publishCommittedUpdate: jest.fn() } },
      ],
    }).compile();
    try {
      await module.init();
      const processor = module.get(FireProcessorService);
      const frames = [0, 200, 400].map((offset) => fireFrame(Date.now() - 600 + offset));
      for (const [index, frame] of frames.entries()) {
        ai.detect.mockResolvedValueOnce(fireResponse(frame, frames.slice(0, index + 1)));
        await processor.process(frame);
      }
      expect(repository.confirm).toHaveBeenCalledTimes(1);
      const original = repository.confirm.mock.calls[0];
      await jest.advanceTimersByTimeAsync(6000);
      expect(repository.confirm).toHaveBeenCalledTimes(2);
      expect(repository.confirm.mock.calls[1]).toEqual(original);
      expect(media.storeCameraSnapshot).toHaveBeenCalledWith(
        'event',
        new Date(frames[2].header.frameTimestamp),
        frames[2].image,
        1280,
        720,
      );
      await jest.advanceTimersByTimeAsync(6000);
      expect(repository.confirm).toHaveBeenCalledTimes(2);
    } finally {
      await module.close();
      jest.useRealTimers();
    }
  });

  it('a restarted consumer requests a fresh AI session without altering publisher identity', async () => {
    const processor = { process: jest.fn().mockResolvedValue(undefined) };
    const module = await Test.createTestingModule({
      providers: [
        FireFramesConsumer,
        FireTelemetry,
        { provide: ConfigService, useValue: new ConfigService() },
        { provide: FireConfig, useValue: fireConfig() },
        { provide: FireProcessorService, useValue: processor },
      ],
    }).compile();
    const consumer = module.get(FireFramesConsumer);
    const frame = fireFrame(Date.now());
    consumer.accept(frame);
    await Promise.resolve();
    const session = processor.process.mock.calls[0][0].header.sourceSessionId;
    expect(frame.header.sourceSessionId).toBe('source-1');
    expect(session).not.toBe('source-1');
    // A second provider instance represents a process restart while the bridge stays up.
    const next = new FireFramesConsumer(
      new ConfigService(),
      fireConfig(),
      module.get(FireProcessorService),
      module.get(FireTelemetry),
    );
    next.accept(frame);
    expect(processor.process.mock.calls[1][0].header.sourceSessionId).not.toBe(session);
    next.onModuleDestroy();
    await module.close();
  });
});
