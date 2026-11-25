import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';

import { EventRecord, EventsRepository } from '../src/events/events.repository';
import { EventsService } from '../src/events/events.service';
import { MqttConsumerService } from '../src/ingestion/mqtt-consumer.service';
import { EventMediaRecord, EventMediaRepository } from '../src/media/event-media.repository';
import { MediaService } from '../src/media/media.service';
import { FrigateDetectionTrackerService } from '../src/frigate/frigate-detection-tracker.service';
import { ZoneResultProducerService } from '../src/ingestion/zone-result-producer.service';
import { AiResultsService } from '../src/ai-results/ai-results.service';
import { FaceRecognitionCoordinatorService } from '../src/face-recognition/face-recognition-coordinator.service';
import { FrigateMediaAdapter } from '../src/media/frigate-media.adapter';

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
  let aiResultsService: jest.Mocked<AiResultsService>;
  let frigateMedia: jest.Mocked<Pick<FrigateMediaAdapter, 'getTimestampedFullFrame'>>;

  beforeEach(async () => {
    const mockEventsRepository = {
      findCameraBySlug: jest.fn(),
      findEligibleZones: jest.fn(),
      findZoneByCameraAndSlug: jest.fn(),
      createEvent: jest.fn(),
      findEventByDedupKey: jest.fn(),
      updateEvent: jest.fn(),
      findEventSummaryById: jest.fn().mockResolvedValue(null),
    };
    const mockMediaService = {
      downloadAndStoreSnapshot: jest.fn(),
      downloadAndStoreClip: jest.fn(),
      storeCameraSnapshot: jest.fn(),
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
    const mockFrigateMedia = {
      getTimestampedFullFrame: jest.fn().mockReturnValue(null),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MqttConsumerService,
        ZoneResultProducerService,
        { provide: AiResultsService, useValue: { submit: jest.fn() } },
        { provide: EventsRepository, useValue: mockEventsRepository },
        { provide: MediaService, useValue: mockMediaService },
        { provide: EventMediaRepository, useValue: mockEventMediaRepository },
        { provide: EventsService, useValue: mockEventsService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: FrigateDetectionTrackerService, useValue: mockDetectionTracker },
        { provide: FrigateMediaAdapter, useValue: mockFrigateMedia },
      ],
    }).compile();

    service = module.get(MqttConsumerService);
    eventsRepository = module.get(EventsRepository);
    mediaService = module.get(MediaService);
    eventMediaRepository = module.get(EventMediaRepository);
    eventsService = module.get(EventsService);
    detectionTracker = module.get(FrigateDetectionTrackerService);
    aiResultsService = module.get(AiResultsService);
    frigateMedia = module.get(FrigateMediaAdapter);
  });

  it('khởi tạo thành công', () => {
    expect(service).toBeDefined();
  });

  it('retains the original incident key for a coordinator-verified continuation', async () => {
    const event = createEvent();
    eventsRepository.findCameraBySlug.mockResolvedValue({
      id: 'cam-uuid-1',
      name: 'Room',
      slug: 'cam_living_room',
    });
    const resolveContinuationDedupKey = jest
      .fn()
      .mockResolvedValue('frigate:cam_living_room:track-101');
    Object.assign(service, {
      faceCoordinator: { resolveContinuationDedupKey, handleTrackEvent: jest.fn() },
    });
    eventsRepository.findEventByDedupKey.mockResolvedValue(event);
    eventsRepository.updateEvent.mockResolvedValue(event);
    await service.handleMessage('frigate/events', buildSnapshotUpdateMessage('new-raw-id'));
    await service.handleMessage('frigate/events', buildSnapshotUpdateMessage('new-raw-id'));
    expect(eventsRepository.createEvent).not.toHaveBeenCalled();
    expect(eventsRepository.findEventByDedupKey).toHaveBeenCalledWith(
      'frigate:cam_living_room:track-101',
    );
    expect(resolveContinuationDedupKey).toHaveBeenCalledTimes(1);
  });

  it('starts face sampling while snapshot storage is still pending', async () => {
    const event = createEvent();
    eventsRepository.findCameraBySlug.mockResolvedValue({
      id: 'cam-uuid-1',
      name: 'Room',
      slug: 'cam_living_room',
    });
    eventsRepository.createEvent.mockResolvedValue(event);
    let releaseMedia!: (value: null) => void;
    let startedMedia!: () => void;
    const mediaStarted = new Promise<void>((resolve) => {
      startedMedia = resolve;
    });
    mediaService.downloadAndStoreSnapshot.mockImplementation(() => {
      startedMedia();
      return new Promise((resolve) => {
        releaseMedia = resolve;
      });
    });
    const handleTrackEvent = jest.fn().mockResolvedValue(undefined);
    Object.assign(service, { faceCoordinator: { handleTrackEvent } });
    const handling = service.handleMessage(
      'frigate/events',
      buildSnapshotUpdateMessage('track-101'),
    );
    await mediaStarted;
    expect(handleTrackEvent).toHaveBeenCalledTimes(1);
    releaseMedia(null);
    await handling;
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

  it('giữ phân loại M4 của US-12 khi current_zone là vùng cấm hợp lệ', async () => {
    eventsRepository.findCameraBySlug.mockResolvedValueOnce({
      id: 'cam-uuid-kitchen',
      name: 'Phong bep',
      slug: 'cam_kitchen',
      timezone: 'Asia/Bangkok',
      zone_config_applied: true,
      zone_config_version: 7,
    });
    eventsRepository.findEligibleZones.mockResolvedValueOnce([
      {
        id: 'zone-uuid-stove',
        camera_id: 'cam-uuid-kitchen',
        name: 'Khu vuc bep',
        slug: 'restricted_stove',
        zone_type: 'RESTRICTED',
        min_dwell_seconds: 2,
        active_from: null,
        active_to: null,
      },
    ]);
    eventsRepository.createEvent.mockResolvedValueOnce(
      createEvent({
        camera_id: 'cam-uuid-kitchen',
        zone_id: 'zone-uuid-stove',
        event_type: 'RESTRICTED_ZONE',
        priority: 'P1',
        track_id: 'track-102',
        dedup_key: 'frigate:cam_kitchen:track-102',
        detected_at: new Date(1_726_387_200_000),
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

    expect(eventsRepository.findEligibleZones).toHaveBeenCalledWith('cam-uuid-kitchen', [
      'restricted_stove',
    ]);
    expect(eventsRepository.createEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        zoneId: 'zone-uuid-stove',
        zoneName: 'Khu vuc bep',
        eventType: 'RESTRICTED_ZONE',
        priority: 'P1',
        dedupKey: 'frigate:cam_kitchen:track-102',
      }),
    );
    expect(aiResultsService.submit).toHaveBeenCalledWith(
      'event-uuid-1',
      expect.objectContaining({
        module: 'M4_ZONE',
        results: [
          expect.objectContaining({
            label: 'RESTRICTED_ZONE',
            confidence: 0.9,
            metadata: expect.objectContaining({
              zoneId: 'zone-uuid-stove',
              dwellSeconds: null,
              dwellEvidence: 'FRIGATE_CURRENT_ZONE_LOITERING',
              zoneConfigVersion: 7,
            }),
          }),
        ],
      }),
    );
  });

  it('khong dung entered_zones de ket luan nguoi van o trong vung', async () => {
    eventsRepository.findCameraBySlug.mockResolvedValueOnce({
      id: 'cam-uuid-kitchen',
      name: 'Phong bep',
      slug: 'cam_kitchen',
      timezone: 'Asia/Bangkok',
      zone_config_applied: true,
    });
    eventsRepository.createEvent.mockResolvedValueOnce(createEvent());

    await service.handleMessage(
      'frigate/events',
      Buffer.from(
        JSON.stringify({
          type: 'new',
          after: {
            id: 'track-left-zone',
            camera: 'cam_kitchen',
            frame_time: 1_726_387_200,
            label: 'person',
            score: 0.9,
            current_zones: [],
            entered_zones: ['restricted_stove'],
          },
        }),
      ),
    );

    expect(eventsRepository.findEligibleZones).not.toHaveBeenCalled();
    expect(aiResultsService.submit).not.toHaveBeenCalled();
    expect(eventsRepository.createEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'PERSON_DETECTED', zoneId: null }),
    );
  });

  it('khong nang M4 khi version zone chua duoc Frigate ap dung', async () => {
    eventsRepository.findCameraBySlug.mockResolvedValueOnce({
      id: 'cam-uuid-kitchen',
      name: 'Phong bep',
      slug: 'cam_kitchen',
      timezone: 'Asia/Bangkok',
      zone_config_applied: false,
    });
    eventsRepository.createEvent.mockResolvedValueOnce(createEvent());

    await service.handleMessage(
      'frigate/events',
      Buffer.from(
        JSON.stringify({
          type: 'new',
          after: {
            id: 'track-pending-zone',
            camera: 'cam_kitchen',
            frame_time: 1_726_387_200,
            label: 'person',
            score: 0.9,
            current_zones: ['restricted_stove'],
          },
        }),
      ),
    );

    expect(eventsRepository.findEligibleZones).not.toHaveBeenCalled();
    expect(aiResultsService.submit).not.toHaveBeenCalled();
    expect(eventsRepository.createEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'PERSON_DETECTED', zoneId: null }),
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

  it.each(['REST_AREA', 'NORMAL', 'INACTIVE', 'WRONG_CAMERA'])(
    'không gửi receipt M4 cho vùng %s',
    async (scenario) => {
      eventsRepository.findCameraBySlug.mockResolvedValue({
        id: 'cam-uuid-1',
        name: 'Bếp',
        slug: 'cam_kitchen',
        timezone: 'UTC',
        zone_config_applied: true,
        zone_config_version: 7,
      });
      eventsRepository.findEligibleZones.mockResolvedValue([
        {
          id: 'zone-uuid-stove',
          camera_id: scenario === 'WRONG_CAMERA' ? 'other-camera' : 'cam-uuid-1',
          name: 'Bếp',
          slug: 'restricted_stove',
          zone_type:
            scenario === 'REST_AREA'
              ? 'REST_AREA'
              : scenario === 'NORMAL'
                ? 'NORMAL'
                : 'RESTRICTED',
          min_dwell_seconds: 2,
          active_from: scenario === 'INACTIVE' ? '00:00' : null,
          active_to: scenario === 'INACTIVE' ? '00:01' : null,
        },
      ]);
      eventsRepository.createEvent.mockResolvedValue(createEvent());
      await service.handleMessage(
        'frigate/events',
        Buffer.from(
          JSON.stringify({
            type: 'new',
            after: {
              id: 'track-101',
              camera: 'cam_kitchen',
              frame_time: 1_726_387_200,
              label: 'person',
              score: 0.9,
              current_zones: ['restricted_stove'],
            },
          }),
        ),
      );
      expect(aiResultsService.submit).not.toHaveBeenCalled();
      expect(eventsRepository.createEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'PERSON_DETECTED',
          zoneId: null,
        }),
      );
    },
  );

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
    eventsRepository.findEventSummaryById.mockResolvedValueOnce({
      ...summary,
      camera_owner_user_id: 'camera-owner',
    } as unknown as Awaited<ReturnType<EventsRepository['findEventSummaryById']>>);
    eventsService.toEventSummary.mockResolvedValueOnce(
      summary as unknown as Awaited<ReturnType<EventsService['toEventSummary']>>,
    );

    await service.handleMessage(
      'frigate/events',
      buildSnapshotUpdateMessage('track-late-snapshot'),
    );

    expect(eventsService.emitEvent).toHaveBeenCalledWith(summary, 'event.updated', [
      'camera-owner',
    ]);
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
        eventType: 'RESTRICTED_ZONE',
        priority: 'P1',
      }),
    );
    expect(mediaService.downloadAndStoreClip).toHaveBeenCalledWith(
      restrictedEvent.id,
      'track-clip',
      restrictedEvent.detected_at,
      15_000,
    );
  });

  it('forwards new/update/end person events to FaceRecognitionCoordinatorService when present', async () => {
    const handleTrackEvent = jest.fn().mockResolvedValue(undefined);
    const coordinator = { handleTrackEvent } as unknown as FaceRecognitionCoordinatorService;
    const camera = {
      id: 'cam-uuid-1',
      name: 'Phong khach',
      slug: 'cam_living_room',
      owner_user_id: 'owner-uuid-1',
    };
    const event = createEvent({ track_id: 'track-coord' });
    const mockEventsRepo = {
      findCameraBySlug: jest.fn().mockResolvedValue(camera),
      findEligibleZones: jest.fn(),
      findZoneByCameraAndSlug: jest.fn(),
      createEvent: jest.fn().mockResolvedValue(event),
      findEventByDedupKey: jest.fn().mockResolvedValue(event),
      updateEvent: jest.fn().mockResolvedValue(event),
      findEventSummaryById: jest.fn().mockResolvedValue(null),
    };
    const moduleWithCoordinator: TestingModule = await Test.createTestingModule({
      providers: [
        MqttConsumerService,
        ZoneResultProducerService,
        { provide: AiResultsService, useValue: { submit: jest.fn() } },
        { provide: EventsRepository, useValue: mockEventsRepo },
        {
          provide: MediaService,
          useValue: { downloadAndStoreSnapshot: jest.fn(), downloadAndStoreClip: jest.fn() },
        },
        {
          provide: EventMediaRepository,
          useValue: { findMediaByEventIdAndType: jest.fn().mockResolvedValue(null) },
        },
        { provide: EventsService, useValue: { toEventSummary: jest.fn(), emitEvent: jest.fn() } },
        {
          provide: ConfigService,
          useValue: { get: jest.fn((_k: string, d?: unknown) => d) },
        },
        { provide: FrigateDetectionTrackerService, useValue: { track: jest.fn() } },
        { provide: FaceRecognitionCoordinatorService, useValue: coordinator },
      ],
    }).compile();

    const consumerWithCoord = moduleWithCoordinator.get(MqttConsumerService);
    await consumerWithCoord.handleMessage(
      'frigate/events',
      Buffer.from(
        JSON.stringify({
          type: 'new',
          after: {
            id: 'track-coord',
            camera: 'cam_living_room',
            frame_time: 1_726_387_200,
            label: 'person',
            score: 0.9,
            current_zones: [],
          },
        }),
      ),
    );
    await consumerWithCoord.handleMessage(
      'frigate/events',
      Buffer.from(
        JSON.stringify({
          type: 'end',
          after: {
            id: 'track-coord',
            camera: 'cam_living_room',
            frame_time: 1_726_387_205,
            label: 'person',
            score: 0.9,
            current_zones: [],
          },
        }),
      ),
    );

    expect(handleTrackEvent).toHaveBeenCalledTimes(2);
    expect(handleTrackEvent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ messageType: 'new', isCreated: true, camera }),
    );
    expect(handleTrackEvent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ messageType: 'end', isCreated: false, camera }),
    );
  });

  it.each(['update', 'end'] as const)(
    'stores timestamped full frame fallback snapshot and emits event.updated on %s when has_snapshot is false',
    async (messageType) => {
      const existingEvent = createEvent({ track_id: `track-fallback-${messageType}` });
      const summary = { id: existingEvent.id, thumbnailUrl: 'https://minio/snapshot.jpg' };
      const imageBytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
      eventsRepository.findCameraBySlug.mockResolvedValueOnce({
        id: 'cam-uuid-1',
        name: 'Phong khach',
        slug: 'cam_living_room',
      });
      eventsRepository.findEventByDedupKey.mockResolvedValueOnce(existingEvent);
      eventsRepository.updateEvent.mockResolvedValueOnce(existingEvent);
      eventMediaRepository.findMediaByEventIdAndType.mockResolvedValueOnce(null);
      frigateMedia.getTimestampedFullFrame.mockReturnValueOnce({
        imageBytes,
        frameWidth: 1280,
        frameHeight: 720,
        capturedAt: 1_726_387_205_000,
      });
      mediaService.storeCameraSnapshot.mockResolvedValueOnce(createSnapshotMedia());
      eventsRepository.findEventSummaryById.mockResolvedValueOnce({
        ...summary,
        camera_owner_user_id: 'camera-owner',
      } as unknown as Awaited<ReturnType<EventsRepository['findEventSummaryById']>>);
      eventsService.toEventSummary.mockResolvedValueOnce(
        summary as unknown as Awaited<ReturnType<EventsService['toEventSummary']>>,
      );

      await service.handleMessage(
        'frigate/events',
        Buffer.from(
          JSON.stringify({
            type: messageType,
            after: {
              id: `track-fallback-${messageType}`,
              camera: 'cam_living_room',
              frame_time: 1_726_387_205,
              label: 'person',
              score: 0.9,
              current_zones: [],
              has_snapshot: false,
            },
          }),
        ),
      );

      expect(frigateMedia.getTimestampedFullFrame).toHaveBeenCalledWith('cam_living_room');
      expect(mediaService.storeCameraSnapshot).toHaveBeenCalledWith(
        existingEvent.id,
        existingEvent.detected_at,
        imageBytes,
        1280,
        720,
      );
      expect(mediaService.downloadAndStoreSnapshot).not.toHaveBeenCalled();
      expect(eventsService.emitEvent).toHaveBeenCalledWith(summary, 'event.updated', [
        'camera-owner',
      ]);
    },
  );

  it('skips timestamped fallback snapshot when a SNAPSHOT already exists', async () => {
    const existingEvent = createEvent({ track_id: 'track-existing-snap' });
    eventsRepository.findCameraBySlug.mockResolvedValueOnce({
      id: 'cam-uuid-1',
      name: 'Phong khach',
      slug: 'cam_living_room',
    });
    eventsRepository.findEventByDedupKey.mockResolvedValueOnce(existingEvent);
    eventsRepository.updateEvent.mockResolvedValueOnce(existingEvent);
    eventMediaRepository.findMediaByEventIdAndType.mockResolvedValueOnce(createSnapshotMedia());

    await service.handleMessage(
      'frigate/events',
      Buffer.from(
        JSON.stringify({
          type: 'update',
          after: {
            id: 'track-existing-snap',
            camera: 'cam_living_room',
            frame_time: 1_726_387_205,
            label: 'person',
            score: 0.9,
            current_zones: [],
            has_snapshot: false,
          },
        }),
      ),
    );

    expect(frigateMedia.getTimestampedFullFrame).not.toHaveBeenCalled();
    expect(mediaService.storeCameraSnapshot).not.toHaveBeenCalled();
    expect(eventsService.emitEvent).not.toHaveBeenCalled();
  });

  it('keeps using downloadAndStoreSnapshot when has_snapshot is true', async () => {
    const existingEvent = createEvent({ track_id: 'track-frigate-snap' });
    eventsRepository.findCameraBySlug.mockResolvedValueOnce({
      id: 'cam-uuid-1',
      name: 'Phong khach',
      slug: 'cam_living_room',
    });
    eventsRepository.findEventByDedupKey.mockResolvedValueOnce(existingEvent);
    eventsRepository.updateEvent.mockResolvedValueOnce(existingEvent);
    eventMediaRepository.findMediaByEventIdAndType.mockResolvedValueOnce(null);
    mediaService.downloadAndStoreSnapshot.mockResolvedValueOnce(createSnapshotMedia());

    await service.handleMessage('frigate/events', buildSnapshotUpdateMessage('track-frigate-snap'));

    expect(mediaService.downloadAndStoreSnapshot).toHaveBeenCalledWith(
      existingEvent.id,
      'track-frigate-snap',
      existingEvent.detected_at,
    );
    expect(frigateMedia.getTimestampedFullFrame).not.toHaveBeenCalled();
    expect(mediaService.storeCameraSnapshot).not.toHaveBeenCalled();
  });

  it('does not store fallback snapshot on new message when has_snapshot is false', async () => {
    const createdEvent = createEvent({ track_id: 'track-new-no-snap' });
    eventsRepository.findCameraBySlug.mockResolvedValueOnce({
      id: 'cam-uuid-1',
      name: 'Phong khach',
      slug: 'cam_living_room',
    });
    eventsRepository.createEvent.mockResolvedValueOnce(createdEvent);
    frigateMedia.getTimestampedFullFrame.mockReturnValue({
      imageBytes: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
      frameWidth: 1280,
      frameHeight: 720,
      capturedAt: 1_726_387_200_000,
    });

    await service.handleMessage(
      'frigate/events',
      Buffer.from(
        JSON.stringify({
          type: 'new',
          after: {
            id: 'track-new-no-snap',
            camera: 'cam_living_room',
            frame_time: 1_726_387_200,
            label: 'person',
            score: 0.9,
            current_zones: [],
            has_snapshot: false,
          },
        }),
      ),
    );

    expect(frigateMedia.getTimestampedFullFrame).not.toHaveBeenCalled();
    expect(mediaService.storeCameraSnapshot).not.toHaveBeenCalled();
  });

  it('negative-caches continuation misses on new so update and end do not re-call resolveContinuationDedupKey', async () => {
    const camera = {
      id: 'cam-uuid-1',
      name: 'Room',
      slug: 'cam_living_room',
      owner_user_id: 'owner-uuid-1',
    };
    const event = createEvent({
      track_id: 'track-miss-1',
      dedup_key: 'frigate:cam_living_room:track-miss-1',
    });
    eventsRepository.findCameraBySlug.mockResolvedValue(camera);
    eventsRepository.createEvent.mockResolvedValueOnce(event);
    eventsRepository.findEventByDedupKey.mockResolvedValue(event);
    eventsRepository.updateEvent.mockResolvedValue(event);

    const resolveContinuationDedupKey = jest.fn().mockResolvedValue(null);
    Object.assign(service, {
      faceCoordinator: { resolveContinuationDedupKey, handleTrackEvent: jest.fn() },
    });

    const baseAfter = {
      id: 'track-miss-1',
      camera: 'cam_living_room',
      frame_time: 1_726_387_205,
      label: 'person',
      score: 0.9,
      current_zones: [],
      has_snapshot: false,
    };

    await service.handleMessage(
      'frigate/events',
      Buffer.from(JSON.stringify({ type: 'new', after: baseAfter })),
    );
    await service.handleMessage(
      'frigate/events',
      Buffer.from(JSON.stringify({ type: 'update', after: baseAfter })),
    );
    await service.handleMessage(
      'frigate/events',
      Buffer.from(JSON.stringify({ type: 'end', after: baseAfter })),
    );

    expect(resolveContinuationDedupKey).toHaveBeenCalledTimes(1);
    expect(resolveContinuationDedupKey).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'track-miss-1' }),
      camera,
      1000,
    );
    expect(eventsRepository.createEvent).toHaveBeenCalledWith(
      expect.objectContaining({ dedupKey: 'frigate:cam_living_room:track-miss-1' }),
    );
    expect(eventsRepository.findEventByDedupKey).toHaveBeenCalledTimes(2);
    expect(eventsRepository.findEventByDedupKey).toHaveBeenCalledWith(
      'frigate:cam_living_room:track-miss-1',
    );
  });

  it('does not call resolveContinuationDedupKey when end is the first-seen message for a track', async () => {
    const camera = {
      id: 'cam-uuid-1',
      name: 'Room',
      slug: 'cam_living_room',
      owner_user_id: 'owner-uuid-1',
    };
    const event = createEvent({
      track_id: 'track-end-first',
      dedup_key: 'frigate:cam_living_room:track-end-first',
    });
    eventsRepository.findCameraBySlug.mockResolvedValue(camera);
    eventsRepository.findEventByDedupKey.mockResolvedValueOnce(event);
    eventsRepository.updateEvent.mockResolvedValueOnce(event);

    const resolveContinuationDedupKey = jest
      .fn()
      .mockResolvedValue('frigate:cam_living_room:track-old');
    Object.assign(service, {
      faceCoordinator: { resolveContinuationDedupKey, handleTrackEvent: jest.fn() },
    });

    await service.handleMessage(
      'frigate/events',
      Buffer.from(
        JSON.stringify({
          type: 'end',
          after: {
            id: 'track-end-first',
            camera: 'cam_living_room',
            frame_time: 1_726_387_210,
            label: 'person',
            score: 0.9,
            current_zones: [],
            has_snapshot: false,
          },
        }),
      ),
    );

    expect(resolveContinuationDedupKey).not.toHaveBeenCalled();
    expect(eventsRepository.findEventByDedupKey).toHaveBeenCalledWith(
      'frigate:cam_living_room:track-end-first',
    );
  });

  it('passes waitForFrameMs = 0 to resolveContinuationDedupKey for RESTRICTED_ZONE (P1) events', async () => {
    const camera = {
      id: 'cam-uuid-kitchen',
      name: 'Phong bep',
      slug: 'cam_kitchen',
      timezone: 'Asia/Bangkok',
      zone_config_applied: true,
      zone_config_version: 7,
      owner_user_id: 'owner-uuid-1',
    };
    eventsRepository.findCameraBySlug.mockResolvedValueOnce(camera);
    eventsRepository.findEligibleZones.mockResolvedValueOnce([
      {
        id: 'zone-uuid-stove',
        camera_id: 'cam-uuid-kitchen',
        name: 'Khu vuc bep',
        slug: 'restricted_stove',
        zone_type: 'RESTRICTED',
        min_dwell_seconds: 2,
        active_from: null,
        active_to: null,
      },
    ]);
    eventsRepository.createEvent.mockResolvedValueOnce(
      createEvent({
        camera_id: 'cam-uuid-kitchen',
        zone_id: 'zone-uuid-stove',
        event_type: 'RESTRICTED_ZONE',
        priority: 'P1',
        track_id: 'track-p1',
        dedup_key: 'frigate:cam_kitchen:track-p1',
        detected_at: new Date(1_726_387_200_000),
      }),
    );

    const resolveContinuationDedupKey = jest.fn().mockResolvedValue(null);
    Object.assign(service, {
      faceCoordinator: { resolveContinuationDedupKey, handleTrackEvent: jest.fn() },
    });

    await service.handleMessage(
      'frigate/events',
      Buffer.from(
        JSON.stringify({
          type: 'new',
          after: {
            id: 'track-p1',
            camera: 'cam_kitchen',
            frame_time: 1_726_387_200.123,
            label: 'person',
            score: 0.9,
            current_zones: ['restricted_stove'],
          },
        }),
      ),
    );

    expect(resolveContinuationDedupKey).toHaveBeenCalledTimes(1);
    expect(resolveContinuationDedupKey).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'track-p1' }),
      camera,
      0,
    );
  });

  it('bỏ qua nhận diện khuôn mặt (M1) khi household tắt m1Face', async () => {
    const camera = {
      id: 'cam-uuid-1',
      name: 'Phong khach',
      slug: 'cam_living_room',
      owner_user_id: 'owner-uuid-1',
      ai_m1_face_enabled: false,
      ai_m4_zone_enabled: true,
    };
    eventsRepository.findCameraBySlug.mockResolvedValueOnce(camera);
    eventsRepository.createEvent.mockResolvedValueOnce(createEvent());

    const resolveContinuationDedupKey = jest.fn().mockResolvedValue('frigate:cam_living_room:old');
    const handleTrackEvent = jest.fn().mockResolvedValue(undefined);
    const faceQueueAdd = jest.fn().mockResolvedValue(undefined);
    Object.assign(service, {
      faceCoordinator: { resolveContinuationDedupKey, handleTrackEvent },
      faceQueue: { add: faceQueueAdd },
    });

    await service.handleMessage('frigate/events', buildSnapshotUpdateMessage('track-m1-off'));

    expect(eventsRepository.createEvent).toHaveBeenCalledTimes(1);
    expect(resolveContinuationDedupKey).not.toHaveBeenCalled();
    expect(handleTrackEvent).not.toHaveBeenCalled();
    expect(faceQueueAdd).not.toHaveBeenCalled();
  });

  it('không truy vấn vùng cấm và giữ PERSON_DETECTED P3 khi household tắt m4Zone', async () => {
    const camera = {
      id: 'cam-uuid-kitchen',
      name: 'Phong bep',
      slug: 'cam_kitchen',
      timezone: 'Asia/Bangkok',
      zone_config_applied: true,
      zone_config_version: 7,
      owner_user_id: 'owner-uuid-1',
      ai_m1_face_enabled: false,
      ai_m4_zone_enabled: false,
    };
    eventsRepository.findCameraBySlug.mockResolvedValueOnce(camera);
    eventsRepository.createEvent.mockResolvedValueOnce(
      createEvent({
        camera_id: 'cam-uuid-kitchen',
        zone_id: null,
        event_type: 'PERSON_DETECTED',
        priority: 'P3',
        track_id: 'track-m4-off',
        dedup_key: 'frigate:cam_kitchen:track-m4-off',
      }),
    );

    await service.handleMessage(
      'frigate/events',
      Buffer.from(
        JSON.stringify({
          type: 'new',
          after: {
            id: 'track-m4-off',
            camera: 'cam_kitchen',
            frame_time: 1_726_387_200.123,
            label: 'person',
            score: 0.9,
            current_zones: ['restricted_stove'],
            has_snapshot: false,
          },
        }),
      ),
    );

    expect(eventsRepository.findEligibleZones).not.toHaveBeenCalled();
    expect(eventsRepository.createEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        zoneId: null,
        eventType: 'PERSON_DETECTED',
        priority: 'P3',
      }),
    );
  });
});
