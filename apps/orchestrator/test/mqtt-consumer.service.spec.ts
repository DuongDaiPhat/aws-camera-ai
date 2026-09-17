import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { MqttConsumerService } from '../src/ingestion/mqtt-consumer.service';
import { EventsRepository } from '../src/events/events.repository';
import { MediaService } from '../src/media/media.service';
import { EventMediaRepository } from '../src/media/event-media.repository';

describe('MqttConsumerService (US-03, US-04)', () => {
  let service: MqttConsumerService;
  let eventsRepository: jest.Mocked<EventsRepository>;
  let mediaService: jest.Mocked<MediaService>;
  let eventMediaRepository: jest.Mocked<EventMediaRepository>;

  beforeEach(async () => {
    const mockEventsRepository = {
      findCameraBySlug: jest.fn(),
      findZoneByCameraAndSlug: jest.fn(),
      createEvent: jest.fn(),
    };

    const mockMediaService = {
      downloadAndStoreSnapshot: jest.fn(),
      downloadAndStoreClip: jest.fn(),
    };

    const mockEventMediaRepository = {
      findEventByTrackId: jest.fn(),
      createEventMedia: jest.fn(),
      findMediaByEventId: jest.fn(),
    };

    const mockConfigService = {
      get: jest.fn((key: string, defaultValue?: unknown) => {
        if (key === 'MQTT_URL') return 'mqtt://localhost:1883';
        if (key === 'MQTT_TOPIC_FRIGATE') return 'frigate/events';
        return defaultValue;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MqttConsumerService,
        { provide: EventsRepository, useValue: mockEventsRepository },
        { provide: MediaService, useValue: mockMediaService },
        { provide: EventMediaRepository, useValue: mockEventMediaRepository },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<MqttConsumerService>(MqttConsumerService);
    eventsRepository = module.get(EventsRepository);
    mediaService = module.get(MediaService);
    eventMediaRepository = module.get(EventMediaRepository);
  });

  it('khoi tao thanh cong', () => {
    expect(service).toBeDefined();
  });

  describe('handleMessage - AC1: Nhan message hop le va ghi vao events', () => {
    it('xu ly thanh cong su kien person khong co zone (PERSON_DETECTED, P3)', async () => {
      const payload = {
        type: 'new',
        after: {
          id: 'track-101',
          camera: 'cam_living_room',
          frame_time: 1726387200.456,
          label: 'person',
          score: 0.84,
          current_zones: [],
          has_snapshot: true,
          has_clip: false,
        },
      };

      eventsRepository.findCameraBySlug.mockResolvedValueOnce({
        id: 'cam-uuid-1',
        name: 'Phong khach',
        slug: 'cam_living_room',
      });

      eventsRepository.createEvent.mockResolvedValueOnce({
        id: 'event-uuid-1',
        camera_id: 'cam-uuid-1',
        zone_id: null,
        event_type: 'PERSON_DETECTED',
        status: 'DETECTED',
        priority: 'P3',
        source: 'FRIGATE',
        track_id: 'track-101',
        dedup_key: 'cam_living_room:track-101:PERSON_DETECTED:172638720',
        confidence: 0.84,
        ai_results: [],
        correlation_id: 'corr-uuid-1',
        detected_at: new Date(1726387200456),
        created_at: new Date(),
        updated_at: new Date(),
      });

      const buffer = Buffer.from(JSON.stringify(payload));
      await service.handleMessage('frigate/events', buffer);

      expect(eventsRepository.findCameraBySlug).toHaveBeenCalledWith('cam_living_room');
      expect(eventsRepository.createEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          cameraId: 'cam-uuid-1',
          zoneId: null,
          eventType: 'PERSON_DETECTED',
          priority: 'P3',
          trackId: 'track-101',
          confidence: 0.84,
          dedupKey: 'cam_living_room:track-101:PERSON_DETECTED:172638720',
        }),
      );
    });

    it('xu ly thanh cong su kien person trong vung cam (RESTRICTED_ZONE, P1)', async () => {
      const payload = {
        type: 'new',
        after: {
          id: 'track-102',
          camera: 'cam_kitchen',
          frame_time: 1726387200.123,
          label: 'person',
          score: 0.9,
          current_zones: ['restricted_stove'],
          has_snapshot: true,
          has_clip: false,
        },
      };

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

      eventsRepository.createEvent.mockResolvedValueOnce({
        id: 'event-uuid-2',
        camera_id: 'cam-uuid-kitchen',
        zone_id: 'zone-uuid-stove',
        event_type: 'RESTRICTED_ZONE',
        status: 'DETECTED',
        priority: 'P1',
        source: 'FRIGATE',
        track_id: 'track-102',
        dedup_key: 'cam_kitchen:track-102:RESTRICTED_ZONE:172638720',
        confidence: 0.9,
        ai_results: [],
        correlation_id: 'corr-uuid-2',
        detected_at: new Date(1726387200123),
        created_at: new Date(),
        updated_at: new Date(),
      });

      const buffer = Buffer.from(JSON.stringify(payload));
      await service.handleMessage('frigate/events', buffer);

      expect(eventsRepository.findCameraBySlug).toHaveBeenCalledWith('cam_kitchen');
      expect(eventsRepository.findZoneByCameraAndSlug).toHaveBeenCalledWith(
        'cam-uuid-kitchen',
        'restricted_stove',
      );
      expect(eventsRepository.createEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          cameraId: 'cam-uuid-kitchen',
          zoneId: 'zone-uuid-stove',
          eventType: 'RESTRICTED_ZONE',
          priority: 'P1',
          trackId: 'track-102',
          dedupKey: 'cam_kitchen:track-102:RESTRICTED_ZONE:172638720',
        }),
      );
    });
  });

  describe('handleMessage - AC2: Dead-letter log, khong lam crash consumer', () => {
    it('khong bi crash khi payload khong phai la JSON hop le', async () => {
      const invalidBuffer = Buffer.from('day-la-chuoi-rac-khong-phai-json{[{');

      await expect(service.handleMessage('frigate/events', invalidBuffer)).resolves.not.toThrow();
      expect(eventsRepository.createEvent).not.toHaveBeenCalled();
    });

    it('khong bi crash khi thieu cac truong bat buoc (thieu after)', async () => {
      const buffer = Buffer.from(JSON.stringify({ type: 'new' }));

      await expect(service.handleMessage('frigate/events', buffer)).resolves.not.toThrow();
      expect(eventsRepository.createEvent).not.toHaveBeenCalled();
    });

    it('bo qua khi label khong phai la person (vi du xe co hoac dong vat)', async () => {
      const payload = {
        type: 'new',
        after: {
          id: 'track-999',
          camera: 'cam_yard',
          frame_time: 1726387200.0,
          label: 'car',
          score: 0.92,
        },
      };

      const buffer = Buffer.from(JSON.stringify(payload));
      await service.handleMessage('frigate/events', buffer);

      expect(eventsRepository.createEvent).not.toHaveBeenCalled();
    });
  });

  describe('handleMessage - AC3: Khu trung lap (FR-ING-07)', () => {
    it('cung track_id trong cua so 10 giay thi sinh dedup_key giong nhau va bo qua khi DB tra ve null', async () => {
      const payload1 = {
        type: 'new',
        after: {
          id: 'track-dup-1',
          camera: 'cam_living_room',
          frame_time: 1726387201.0, // bucket 172638720
          label: 'person',
          score: 0.8,
          current_zones: [],
        },
      };

      const payload2 = {
        type: 'update',
        after: {
          id: 'track-dup-1',
          camera: 'cam_living_room',
          frame_time: 1726387206.5, // bucket 172638720 (cung 10 giay)
          label: 'person',
          score: 0.85,
          current_zones: [],
        },
      };

      eventsRepository.findCameraBySlug.mockResolvedValue({
        id: 'cam-uuid-1',
        name: 'Phong khach',
        slug: 'cam_living_room',
      });

      // Lần đầu insert thành công
      eventsRepository.createEvent.mockResolvedValueOnce({
        id: 'event-uuid-1',
        camera_id: 'cam-uuid-1',
        zone_id: null,
        event_type: 'PERSON_DETECTED',
        status: 'DETECTED',
        priority: 'P3',
        source: 'FRIGATE',
        track_id: 'track-dup-1',
        dedup_key: 'cam_living_room:track-dup-1:PERSON_DETECTED:172638720',
        confidence: 0.8,
        ai_results: [],
        correlation_id: 'corr-1',
        detected_at: new Date(1726387201000),
        created_at: new Date(),
        updated_at: new Date(),
      });

      // Lần thứ hai bị trùng (DB trả về null do UNIQUE dedup_key)
      eventsRepository.createEvent.mockResolvedValueOnce(null);

      await service.handleMessage('frigate/events', Buffer.from(JSON.stringify(payload1)));
      await service.handleMessage('frigate/events', Buffer.from(JSON.stringify(payload2)));

      expect(eventsRepository.createEvent).toHaveBeenCalledTimes(2);
      expect(eventsRepository.createEvent).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          dedupKey: 'cam_living_room:track-dup-1:PERSON_DETECTED:172638720',
        }),
      );
      expect(eventsRepository.createEvent).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          dedupKey: 'cam_living_room:track-dup-1:PERSON_DETECTED:172638720',
        }),
      );
    });
  });

  describe('US-04: Luu media su kien (Snapshot & Clip)', () => {
    it('tu dong goi downloadAndStoreSnapshot khi su kien moi co has_snapshot=true', async () => {
      const payload = {
        type: 'new',
        after: {
          id: 'track-snap-1',
          camera: 'cam_living_room',
          frame_time: 1726387200.0,
          label: 'person',
          score: 0.88,
          current_zones: [],
          has_snapshot: true,
        },
      };

      eventsRepository.findCameraBySlug.mockResolvedValueOnce({
        id: 'cam-uuid-1',
        name: 'Phong khach',
        slug: 'cam_living_room',
      });

      eventsRepository.createEvent.mockResolvedValueOnce({
        id: 'event-uuid-snap',
        camera_id: 'cam-uuid-1',
        zone_id: null,
        event_type: 'PERSON_DETECTED',
        status: 'DETECTED',
        priority: 'P3',
        source: 'FRIGATE',
        track_id: 'track-snap-1',
        dedup_key: 'dedup-snap',
        confidence: 0.88,
        ai_results: [],
        correlation_id: 'corr-snap',
        detected_at: new Date(1726387200000),
        created_at: new Date(),
        updated_at: new Date(),
      });

      await service.handleMessage('frigate/events', Buffer.from(JSON.stringify(payload)));

      expect(mediaService.downloadAndStoreSnapshot).toHaveBeenCalledWith(
        'event-uuid-snap',
        'track-snap-1',
        expect.any(Date),
      );
    });

    it('tu dong goi downloadAndStoreClip khi track end co has_clip=true cho su kien P1', async () => {
      const payload = {
        type: 'end',
        after: {
          id: 'track-clip-1',
          camera: 'cam_kitchen',
          frame_time: 1726387215.0,
          start_time: 1726387200.0,
          end_time: 1726387215.0,
          label: 'person',
          score: 0.9,
          current_zones: [],
          has_clip: true,
        },
      };

      eventMediaRepository.findEventByTrackId.mockResolvedValueOnce({
        id: 'event-uuid-clip',
        camera_id: 'cam-uuid-kitchen',
        zone_id: 'zone-stove',
        event_type: 'RESTRICTED_ZONE',
        status: 'DETECTED',
        priority: 'P1',
        source: 'FRIGATE',
        track_id: 'track-clip-1',
        dedup_key: 'dedup-clip',
        confidence: 0.9,
        ai_results: [],
        correlation_id: 'corr-clip',
        detected_at: new Date(1726387200000),
        created_at: new Date(),
        updated_at: new Date(),
      });

      await service.handleMessage('frigate/events', Buffer.from(JSON.stringify(payload)));

      expect(eventMediaRepository.findEventByTrackId).toHaveBeenCalledWith('track-clip-1');
      expect(mediaService.downloadAndStoreClip).toHaveBeenCalledWith(
        'event-uuid-clip',
        'track-clip-1',
        expect.any(Date),
        15000,
      );
    });
  });
});
