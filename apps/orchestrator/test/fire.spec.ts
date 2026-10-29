import { Test } from '@nestjs/testing';
import { FireAiClient } from '../src/fire/fire-ai.client';
import { FireProcessorService } from '../src/fire/fire-processor.service';
import { FireTelemetry } from '../src/fire/fire-telemetry.service';
import { FireIncidentsRepository } from '../src/fire/fire-incidents.repository';
import { FireConfig } from '../src/fire/fire.config';
import { decodeFireFrame } from '../src/fire/fire-frame.codec';
import {
  validateFireConfirmation,
  validateFireObservation,
} from '../src/fire/fire-evidence.validator';
import { MediaService } from '../src/media/media.service';
import { EventsService } from '../src/events/events.service';
import { confirmedFire, fireConfig, fireFrame, fireResponse } from './fire-fixtures';

describe('US-18 fire evidence and ingestion', () => {
  it('rejects smoke and the former mixed-class policy at the inference boundary', () => {
    const frame = fireFrame(Date.now());
    const result = fireResponse(frame);
    const smoke: unknown = { ...result.detections[0], label: 'smoke' };
    const legacy = Object.assign({}, result, { detections: [smoke] });
    expect(() => validateFireObservation(frame, legacy, fireConfig())).toThrow('Fire-only');
    expect(() =>
      validateFireObservation(
        frame,
        Object.assign({}, result, {
          confidencePolicyVersion: 'fire-temporal-min-v1',
        }),
        fireConfig(),
      ),
    ).toThrow('Fire-only');
  });
  it('validates each qualifying frame instead of trusting confirmed=true', () => {
    const at = Date.now();
    const confirmed = confirmedFire(at);
    const frames = [fireFrame(at - 1000), fireFrame(at - 500), fireFrame(at)];
    const observations = frames.map((item) => ({
      id: item.header.frameId,
      at: Date.parse(item.header.frameTimestamp),
      score: 0.9,
    }));
    expect(() => validateFireConfirmation(confirmed, observations, fireConfig())).not.toThrow();
    expect(() => validateFireConfirmation(confirmed, observations.slice(1), fireConfig())).toThrow(
      'Unobserved',
    );
    expect(() =>
      validateFireConfirmation({ ...confirmed, incidentConfidence: 1 }, observations, fireConfig()),
    ).toThrow('score');
    expect(() =>
      validateFireConfirmation(
        { ...confirmed, qualifyingFrameIds: ['same', 'same', 'same'] },
        observations,
        fireConfig(),
      ),
    ).toThrow('count');
    expect(() =>
      validateFireObservation(frames[2], { ...confirmed, cameraSlug: 'different' }, fireConfig()),
    ).toThrow('identity');
  });

  it('admits full-camera envelopes without person objects and rejects stale/oversize input', () => {
    const frame = fireFrame(Date.now());
    const header = Buffer.from(JSON.stringify(frame.header));
    const prefix = Buffer.alloc(4);
    prefix.writeUInt32BE(header.length);
    const payload = Buffer.concat([prefix, header, frame.image]);
    expect(decodeFireFrame(payload, fireConfig()).header.cameraSlug).toBe('cam_fire');
    expect(() => decodeFireFrame(payload, fireConfig(), Date.now() + 2000)).toThrow('Stale');
    expect(() => decodeFireFrame(Buffer.from([0, 0, 255, 255]), fireConfig())).toThrow();
    expect(() => decodeFireFrame(payload, fireConfig({ FIRE_MAX_IMAGE_PIXELS: 100 }))).toThrow(
      'pixels',
    );
  });

  it('persists only on frame three and does not let duplicates count twice', async () => {
    const repository = {
      findEnabledCamera: jest.fn().mockResolvedValue('camera-id'),
      confirm: jest.fn().mockResolvedValue({
        id: 'incident',
        eventId: 'event',
        cameraId: 'camera-id',
        created: true,
      }),
      clearActive: jest.fn(),
    };
    const media = { storeCameraSnapshot: jest.fn().mockResolvedValue(null) };
    const ai = { detect: jest.fn() };
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
    const service = module.get(FireProcessorService);
    const at = Date.now() - 600;
    const frames = [fireFrame(at), fireFrame(at + 200), fireFrame(at + 400)];
    ai.detect.mockResolvedValueOnce(fireResponse(frames[0]));
    await service.process(frames[0]);
    await service.process(frames[0]);
    expect(ai.detect).toHaveBeenCalledTimes(1);
    ai.detect.mockResolvedValueOnce(fireResponse(frames[1], frames.slice(0, 2)));
    await service.process(frames[1]);
    expect(repository.confirm).not.toHaveBeenCalled();
    ai.detect.mockResolvedValueOnce(fireResponse(frames[2], frames));
    await service.process(frames[2]);
    expect(repository.confirm).toHaveBeenCalledTimes(1);
    expect(module.get(FireTelemetry).counters.confirmedEpisodes).toBe(1);
    const payload = repository.confirm.mock.calls[0][2];
    expect(payload.module).toBe('M3_FIRE');
    expect(payload.results[0].label).toBe('FIRE_SMOKE_DETECTED');
    expect(media.storeCameraSnapshot).toHaveBeenCalledWith(
      'event',
      new Date(frames[2].header.frameTimestamp),
      frames[2].image,
      1280,
      720,
    );
    await module.close();
  });

  it('disabled camera and unobserved model confirmation cannot create an incident', async () => {
    const repository = {
      findEnabledCamera: jest.fn().mockResolvedValue(null),
      confirm: jest.fn(),
      clearActive: jest.fn(),
    };
    const ai = { detect: jest.fn().mockResolvedValue(confirmedFire()) };
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
    const service = module.get(FireProcessorService);
    await service.process(fireFrame(Date.now()));
    expect(ai.detect).not.toHaveBeenCalled();
    repository.findEnabledCamera.mockResolvedValue('camera-id');
    const response = confirmedFire();
    ai.detect.mockResolvedValue(response);
    await service.process(fireFrame(Date.parse(response.observedAt)));
    expect(repository.confirm).not.toHaveBeenCalled();
    await module.close();
  });
});
