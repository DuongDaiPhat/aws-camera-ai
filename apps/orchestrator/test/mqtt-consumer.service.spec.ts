import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';

import { EventRecord, EventsRepository } from '../src/events/events.repository';
import { EventsService } from '../src/events/events.service';
import { MqttConsumerService } from '../src/ingestion/mqtt-consumer.service';
import { EventMediaRecord, EventMediaRepository } from '../src/media/event-media.repository';
import { MediaService } from '../src/media/media.service';
import { FrigateDetectionTrackerService } from '../src/frigate/frigate-detection-tracker.service';

function createEvent(overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    id: 'event-uuid-1',
    camera_id: 'cam-uuid-1',
    zone_id: null,
    event_type: 'PERSON_DETECTED',
    status: 'DETECTED',
    priority: 'P3',
    source: 'FRIGATE',
    track_id: 'track-101',
    dedup_key: 'frigate:cam_living_room:track-101',
    confidence: 0.84,
    ai_results: [],
    correlation_id: 'corr-uuid-1',
    detected_at: new Date(1_726_387_200_456),
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

function createSnapshotMedia(): EventMediaRecord {
  return {
    id: 'media-snapshot-1',
    event_id: 'event-uuid-1',
    media_type: 'SNAPSHOT',
    storage_provider: 'MINIO',
    bucket: 'camerai-media',
    object_key: 'events/2026/09/18/event-uuid-1/snapshot.jpg',
    content_type: 'image/jpeg',
    size_bytes: 1024,
    width: null,
    height: null,
    duration_ms: null,
    checksum_sha256: null,
    expires_at: null,
    created_at: new Date(),
  };
}

function buildSnapshotUpdateMessage(trackId: string): Buffer {
  return Buffer.from(
    JSON.stringify({
      type: 'update',
      after: {
        id: trackId,
        camera: 'cam_living_room',
        frame_time: 1_726_387_205,
        label: 'person',
        score: 0.9,
        current_zones: [],
        has_snapshot: true,
      },
    }),
  );
}

describe('MqttConsumerService (US-03, US-04)', () => {
  let service: MqttConsumerService;
  let eventsRepository: jest.Mocked<EventsRepository>;
  let mediaService: jest.Mocked<MediaService>;
  let eventMediaRepository: jest.Mocked<EventMediaRepository>;
  let eventsService: jest.Mocked<EventsService>;
  let detectionTracker: jest.Mocked<FrigateDetectionTrackerService>;

  beforeEach(async () => {
    const mockEventsRepository = {
      findCameraBySlug: jest.fn(),
      findZoneByCameraAndSlug: jest.fn(),
      createEvent: jest.fn(),
      findEventByDedupKey: jest.fn(),
      updateEvent: jest.fn(),
      findEventSummaryById: jest.fn().mockResolvedValue(null),
    };
    const mockMediaService = {
      downloadAndStoreSnapshot: jest.fn(),
      downloadAndStoreClip: jest.fn(),
    };
    const mockEventMediaRepository = {
      findMediaByEventIdAndType: jest.fn().mockResolvedValue(null),
    };
    const mockEventsService = {
      toEventSummary: jest.fn(),
      emitEvent: jest.fn(),
    };
    const mockDetectionTracker = {
      track: jest.fn(),
    };
    const mockConfigService = {
      get: jest.fn((_key: string, defaultValue?: unknown) => defaultValue),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MqttConsumerService,
        { provide: EventsRepository, useValue: mockEventsRepository },
        { provide: MediaService, useValue: mockMediaService },
        { provide: EventMediaRepository, useValue: mockEventMediaRepository },
        { provide: EventsService, useValue: mockEventsService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: FrigateDetectionTrackerService, useValue: mockDetectionTracker },
      ],
    }).compile();

    service = module.get(MqttConsumerService);
    eventsRepository = module.get(EventsRepository);
    mediaService = module.get(MediaService);
    eventMediaRepository = module.get(EventMediaRepository);
    eventsService = module.get(EventsService);
    detectionTracker = module.get(FrigateDetectionTrackerService);
  });

  it('khởi tạo thành công', () => {
    expect(service).toBeDefined();
  });

  it('tạo một PERSON_DETECTED P3 với dedup key ổn định theo Frigate track', async () => {
    const event = createEvent();
    eventsRepository.findCameraBySlug.mockResolvedValueOnce({
      id: 'cam-uuid-1',
      name: 'Phong khach',
      slug: 'cam_living_room',
    });
    eventsRepository.createEvent.mockResolvedValueOnce(event);

    await service.handleMessage(
      'frigate/events',
      Buffer.from(
        JSON.stringify({
          type: 'new',
          after: {
            id: 'track-101',
            camera: 'cam_living_room',
            frame_time: 1_726_387_200.456,
            label: 'person',
            score: 0.84,
            box: [100, 50, 200, 300],
            current_zones: [],
            has_snapshot: false,
            has_clip: false,
          },
        }),
      ),
    );

    expect(eventsRepository.createEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        cameraId: 'cam-uuid-1',
        eventType: 'PERSON_DETECTED',
        priority: 'P3',
        trackId: 'track-101',
        dedupKey: 'frigate:cam_living_room:track-101',
      }),
    );
    expect(detectionTracker.track).toHaveBeenCalledWith(
      'new',
      expect.objectContaining({
        id: 'track-101',
        camera: 'cam_living_room',
        box: [100, 50, 200, 300],
      }),
    );
  });

  it('chỉ ghi zone observation, không tự coi mọi current_zone là vùng cấm', async () => {
    eventsRepository.findCameraBySlug.mockResolvedValueOnce({
      id: 'cam-uuid-kitchen',
      name: 'Phong bep',
      slug: 'cam_kitchen',
    });
    eventsRepository.findZoneByCameraAndSlug.mockResolvedValueOnce({
      id: 'zone-uuid-stove',
      camera_id: 'cam-uuid-kitchen',
      name: 'Khu vuc bep',
      slug: 'restricted_stove',
    });
    eventsRepository.createEvent.mockResolvedValueOnce(
      createEvent({
        camera_id: 'cam-uuid-kitchen',
        zone_id: 'zone-uuid-stove',
        event_type: 'PERSON_DETECTED',
        priority: 'P3',
        track_id: 'track-102',
        dedup_key: 'frigate:cam_kitchen:track-102',
      }),
    );

    await service.handleMessage(
      'frigate/events',
      Buffer.from(
        JSON.stringify({
          type: 'new',
          after: {
            id: 'track-102',
            camera: 'cam_kitchen',
            frame_time: 1_726_387_200.123,
            label: 'person',
            score: 0.9,
            current_zones: ['restricted_stove'],
          },
        }),
      ),
    );

    expect(eventsRepository.findZoneByCameraAndSlug).toHaveBeenCalledWith(
      'cam-uuid-kitchen',
      'restricted_stove',
    );
    expect(eventsRepository.createEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        zoneId: 'zone-uuid-stove',
        eventType: 'PERSON_DETECTED',
        priority: 'P3',
        dedupKey: 'frigate:cam_kitchen:track-102',
      }),
    );
  });

  it('không crash và không ghi DB khi JSON hoặc message type không hợp lệ', async () => {
    await expect(
      service.handleMessage('frigate/events', Buffer.from('not-json')),
    ).resolves.not.toThrow();
    await expect(
      service.handleMessage(
        'frigate/events',
        Buffer.from(
          JSON.stringify({
            type: 'unexpected',
            after: {
              id: 'track-invalid',
              camera: 'cam_living_room',
              frame_time: 1_726_387_200,
              label: 'person',
              score: 0.8,
            },
          }),
        ),
      ),
    ).resolves.not.toThrow();

    expect(eventsRepository.createEvent).not.toHaveBeenCalled();
  });

  it('bỏ qua label không phải person', async () => {
    await service.handleMessage(
      'frigate/events',
      Buffer.from(
        JSON.stringify({
          type: 'new',
          after: {
            id: 'track-car',
            camera: 'cam_yard',
            frame_time: 1_726_387_200,
            label: 'car',
            score: 0.92,
          },
        }),
      ),
    );

    expect(eventsRepository.createEvent).not.toHaveBeenCalled();
  });

  it('cập nhật cùng track qua ranh giới 10 giây vẫn chỉ dùng một event', async () => {
    const createdEvent = createEvent({
      track_id: 'track-boundary',
      dedup_key: 'frigate:cam_living_room:track-boundary',
      confidence: 0.8,
    });
    const updatedEvent = createEvent({
      track_id: 'track-boundary',
      dedup_key: 'frigate:cam_living_room:track-boundary',
      confidence: 0.9,
    });
    eventsRepository.findCameraBySlug.mockResolvedValue({
      id: 'cam-uuid-1',
      name: 'Phong khach',
      slug: 'cam_living_room',
    });
    eventsRepository.createEvent.mockResolvedValueOnce(createdEvent);
    eventsRepository.findEventByDedupKey.mockResolvedValueOnce(createdEvent);
    eventsRepository.updateEvent.mockResolvedValueOnce(updatedEvent);

    const baseAfter = {
      id: 'track-boundary',
      camera: 'cam_living_room',
      label: 'person',
      current_zones: [],
    };
    await service.handleMessage(
      'frigate/events',
      Buffer.from(
        JSON.stringify({
          type: 'new',
          after: { ...baseAfter, frame_time: 1_726_387_209.5, score: 0.8 },
        }),
      ),
    );
    await service.handleMessage(
      'frigate/events',
      Buffer.from(
        JSON.stringify({
          type: 'update',
          after: { ...baseAfter, frame_time: 1_726_387_210.5, score: 0.9 },
        }),
      ),
    );

    expect(eventsRepository.createEvent).toHaveBeenCalledTimes(1);
    expect(eventsRepository.findEventByDedupKey).toHaveBeenCalledWith(
      'frigate:cam_living_room:track-boundary',
    );
    expect(eventsRepository.updateEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: createdEvent.id, detectionConfidence: 0.9 }),
    );
  });

  it('lưu snapshot khi snapshot chỉ sẵn sàng ở message update', async () => {
    const existingEvent = createEvent({ track_id: 'track-snapshot' });
    eventsRepository.findCameraBySlug.mockResolvedValueOnce({
      id: 'cam-uuid-1',
      name: 'Phong khach',
      slug: 'cam_living_room',
    });
    eventsRepository.findEventByDedupKey.mockResolvedValueOnce(existingEvent);
    eventsRepository.updateEvent.mockResolvedValueOnce(existingEvent);

    await service.handleMessage(
      'frigate/events',
      Buffer.from(
        JSON.stringify({
          type: 'update',
          after: {
            id: 'track-snapshot',
            camera: 'cam_living_room',
            frame_time: 1_726_387_205,
            label: 'person',
            score: 0.9,
            current_zones: [],
            has_snapshot: true,
          },
        }),
      ),
    );

    expect(mediaService.downloadAndStoreSnapshot).toHaveBeenCalledWith(
      existingEvent.id,
      'track-snapshot',
      existingEvent.detected_at,
    );
  });

  it('phát event.updated lên SSE khi snapshot vừa về cho sự kiện đã hiển thị', async () => {
    const existingEvent = createEvent({ track_id: 'track-late-snapshot' });
    const summary = { id: existingEvent.id, thumbnailUrl: 'https://minio/snapshot.jpg' };
    eventsRepository.findCameraBySlug.mockResolvedValueOnce({
      id: 'cam-uuid-1',
      name: 'Phong khach',
      slug: 'cam_living_room',
    });
    eventsRepository.findEventByDedupKey.mockResolvedValueOnce(existingEvent);
    eventsRepository.updateEvent.mockResolvedValueOnce(existingEvent);
    eventMediaRepository.findMediaByEventIdAndType.mockResolvedValueOnce(null);
    mediaService.downloadAndStoreSnapshot.mockResolvedValueOnce(createSnapshotMedia());
    eventsRepository.findEventSummaryById.mockResolvedValueOnce(
      summary as unknown as Awaited<ReturnType<EventsRepository['findEventSummaryById']>>,
    );
    eventsService.toEventSummary.mockResolvedValueOnce(
      summary as unknown as Awaited<ReturnType<EventsService['toEventSummary']>>,
    );

    await service.handleMessage(
      'frigate/events',
      buildSnapshotUpdateMessage('track-late-snapshot'),
    );

    expect(eventsService.emitEvent).toHaveBeenCalledWith(summary, 'event.updated');
  });

  it('không phát lại SSE khi snapshot đã được lưu từ trước', async () => {
    const existingEvent = createEvent({ track_id: 'track-have-snapshot' });
    eventsRepository.findCameraBySlug.mockResolvedValueOnce({
      id: 'cam-uuid-1',
      name: 'Phong khach',
      slug: 'cam_living_room',
    });
    eventsRepository.findEventByDedupKey.mockResolvedValueOnce(existingEvent);
    eventsRepository.updateEvent.mockResolvedValueOnce(existingEvent);
    eventMediaRepository.findMediaByEventIdAndType.mockResolvedValueOnce(createSnapshotMedia());
    mediaService.downloadAndStoreSnapshot.mockResolvedValueOnce(createSnapshotMedia());

    await service.handleMessage(
      'frigate/events',
      buildSnapshotUpdateMessage('track-have-snapshot'),
    );

    expect(eventsService.emitEvent).not.toHaveBeenCalled();
  });

  it('cập nhật track end và lưu clip cho event P1', async () => {
    const restrictedEvent = createEvent({
      event_type: 'RESTRICTED_ZONE',
      priority: 'P1',
      track_id: 'track-clip',
      dedup_key: 'frigate:cam_kitchen:track-clip',
    });
    eventsRepository.findCameraBySlug.mockResolvedValueOnce({
      id: 'cam-uuid-kitchen',
      name: 'Phong bep',
      slug: 'cam_kitchen',
    });
    eventsRepository.findEventByDedupKey.mockResolvedValueOnce(restrictedEvent);
    eventsRepository.updateEvent.mockResolvedValueOnce(restrictedEvent);

    await service.handleMessage(
      'frigate/events',
      Buffer.from(
        JSON.stringify({
          type: 'end',
          after: {
            id: 'track-clip',
            camera: 'cam_kitchen',
            frame_time: 1_726_387_215,
            start_time: 1_726_387_200,
            end_time: 1_726_387_215,
            label: 'person',
            score: 0.9,
            current_zones: [],
            has_clip: true,
          },
        }),
      ),
    );

    expect(eventsRepository.updateEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: restrictedEvent.id,
        eventType: 'PERSON_DETECTED',
        priority: 'P3',
      }),
    );
    expect(mediaService.downloadAndStoreClip).toHaveBeenCalledWith(
      restrictedEvent.id,
      'track-clip',
      restrictedEvent.detected_at,
      15_000,
    );
  });
});
