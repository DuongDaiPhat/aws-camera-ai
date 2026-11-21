import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { FireMediaService } from '../src/fire/fire-media.service';
import { FireIncidentsRepository } from '../src/fire/fire-incidents.repository';
import { EventMediaRepository } from '../src/media/event-media.repository';
import { EventsService } from '../src/events/events.service';
import { STORAGE_SERVICE } from '../src/storage/storage.interface';

describe('US-18 camera recording recovery', () => {
  const work = {
    id: 'incident',
    event_id: 'event',
    camera_slug: 'cam_fire',
    first_qualified_at: new Date('2026-10-27T09:06:42.000Z'),
    confirmed_at: new Date('2026-10-27T09:06:43.000Z'),
  };
  const repository = { claimMedia: jest.fn().mockResolvedValue(work) };
  const media = {
    findMediaByEventIdAndType: jest.fn().mockResolvedValue(null),
    createEventMedia: jest.fn(),
  };
  const storage = {
    download: jest.fn().mockRejectedValue(new Error('Exact snapshot was never uploaded')),
    upload: jest.fn(),
  };
  const events = { publishCommittedUpdate: jest.fn() };
  let fetchMock: jest.SpiedFunction<typeof fetch>;

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  async function fixture(maxBytes = 1024): Promise<TestingModule> {
    return Test.createTestingModule({
      providers: [
        FireMediaService,
        { provide: ConfigService, useValue: new ConfigService({ FIRE_CLIP_MAX_BYTES: maxBytes }) },
        { provide: FireIncidentsRepository, useValue: repository },
        { provide: EventMediaRepository, useValue: media },
        { provide: STORAGE_SERVICE, useValue: storage },
        { provide: EventsService, useValue: events },
      ],
    }).compile();
  }

  it('stores a whole-camera MP4 and emits an update without substituting another snapshot', async () => {
    const mp4 = Buffer.from([0, 0, 0, 20, 102, 116, 121, 112, 105, 115, 111, 109]);
    fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(mp4));
    const module = await fixture();
    try {
      await module.get(FireMediaService).dispatch();
      expect(String(fetchMock.mock.calls[0][0])).toContain('/api/cam_fire/start/');
      expect(storage.upload).toHaveBeenCalledWith(
        expect.stringContaining('/event/clip.mp4'),
        mp4,
        'video/mp4',
        { tags: { retention: 'expire-7d' } },
      );
      expect(media.createEventMedia).toHaveBeenCalledTimes(1);
      expect(media.createEventMedia).toHaveBeenCalledWith(
        expect.objectContaining({ mediaType: 'CLIP', durationMs: 11000 }),
      );
      expect(events.publishCommittedUpdate).toHaveBeenCalledWith('event');
      expect(String(fetchMock.mock.calls[0][0])).toContain(
        `/start/${work.first_qualified_at.getTime() / 1000 - 5}/end/${work.confirmed_at.getTime() / 1000 + 5}/`,
      );
    } finally {
      await module.close();
    }
  });

  it('preserves retained fire clips with retain=true instead of retention=expire-7d', async () => {
    const mp4 = Buffer.from([0, 0, 0, 20, 102, 116, 121, 112, 105, 115, 111, 109]);
    repository.claimMedia.mockResolvedValueOnce({ ...work, retain: true });
    fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(mp4));
    const module = await fixture();
    try {
      await module.get(FireMediaService).dispatch();
      expect(storage.upload).toHaveBeenCalledWith(
        expect.stringContaining('/event/clip.mp4'),
        mp4,
        'video/mp4',
        { retain: true },
      );
    } finally {
      await module.close();
    }
  });

  it.each([
    ['excessive bytes', 'x'.repeat(33)],
    ['invalid MP4', 'not-a-video'],
  ])('rejects %s without attaching false media', async (_label, body) => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body));
    const module = await fixture(32);
    try {
      await expect(module.get(FireMediaService).dispatch()).rejects.toThrow();
      expect(storage.upload).not.toHaveBeenCalled();
      expect(media.createEventMedia).not.toHaveBeenCalled();
    } finally {
      await module.close();
    }
  });

  it('recovers missing snapshot DB record from storage, handles busy/empty claims, HTTP errors, and lifecycle polling', async () => {
    const snap = Buffer.from([0xff, 0xd8, 0xff]);
    storage.download.mockResolvedValueOnce(snap);
    media.findMediaByEventIdAndType
      .mockResolvedValueOnce(null) // SNAPSHOT missing
      .mockResolvedValueOnce({ id: 'clip-exists' }); // CLIP already exists

    const module = await fixture();
    try {
      const svc = module.get(FireMediaService);
      await svc.dispatch();
      expect(media.createEventMedia).toHaveBeenCalledWith(
        expect.objectContaining({
          mediaType: 'SNAPSHOT',
          objectKey: 'events/2026/10/27/event/snapshot.jpg',
        }),
      );
      expect(events.publishCommittedUpdate).toHaveBeenCalledWith('event');

      // Empty claim returns early
      repository.claimMedia.mockResolvedValueOnce(null);
      await svc.dispatch();

      // Busy guard skips overlapping dispatch
      Object.assign(svc, { busy: true });
      repository.claimMedia.mockClear();
      await svc.dispatch();
      expect(repository.claimMedia).not.toHaveBeenCalled();
      Object.assign(svc, { busy: false });

      // Non-OK HTTP response throws
      media.findMediaByEventIdAndType.mockResolvedValue({ id: 'snap-exists' });
      media.findMediaByEventIdAndType
        .mockResolvedValueOnce({ id: 'snap-exists' })
        .mockResolvedValueOnce(null);
      jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, { status: 502 }));
      await expect(svc.dispatch()).rejects.toThrow('Fire camera clip HTTP 502');
    } finally {
      await module.close();
    }
  });

  it('starts and stops polling interval via onModuleInit/onModuleDestroy and validates positive config', async () => {
    jest.useFakeTimers();
    try {
      repository.claimMedia.mockRejectedValueOnce(new Error('poll error'));
      const mod = await Test.createTestingModule({
        providers: [
          FireMediaService,
          { provide: ConfigService, useValue: new ConfigService({ FIRE_DELIVERY_POLL_MS: 500 }) },
          { provide: FireIncidentsRepository, useValue: repository },
          { provide: EventMediaRepository, useValue: media },
          { provide: STORAGE_SERVICE, useValue: storage },
          { provide: EventsService, useValue: events },
        ],
      }).compile();
      const svc = mod.get(FireMediaService);
      svc.onModuleInit();
      await jest.advanceTimersByTimeAsync(500);
      expect(repository.claimMedia).toHaveBeenCalled();
      svc.onModuleDestroy();
      await mod.close();

      expect(
        () =>
          new FireMediaService(
            new ConfigService({ FIRE_MEDIA_READY_DELAY_SECONDS: '0' }),
            repository as unknown as FireIncidentsRepository,
            media as unknown as EventMediaRepository,
            storage as never,
            events as unknown as EventsService,
          ),
      ).toThrow('Invalid FIRE_MEDIA_READY_DELAY_SECONDS');
    } finally {
      jest.useRealTimers();
    }
  });
});
