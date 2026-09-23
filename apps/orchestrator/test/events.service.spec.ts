import { Test, TestingModule } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { EventsService } from '../src/events/events.service';
import {
  EventsRepository,
  EventDetailRecord,
  EventListItemRecord,
} from '../src/events/events.repository';
import { ListEventsQueryDto } from '../src/events/dto/list-events-query.dto';
import { MediaService } from '../src/media/media.service';
import { STORAGE_SERVICE, IStorageService } from '../src/storage/storage.interface';
import { TOKEN_SERVICE, TokenService } from '../src/auth/auth.types';

describe('EventsService (US-06)', () => {
  let service: EventsService;
  let eventsRepository: jest.Mocked<EventsRepository>;
  let storageService: jest.Mocked<IStorageService>;
  let tokenService: jest.Mocked<TokenService>;
  let mediaService: jest.Mocked<MediaService>;

  const mockRecord: EventListItemRecord = {
    id: '11111111-1111-1111-1111-111111111111',
    event_type: 'FALL_DETECTED',
    status: 'NOTIFIED',
    priority: 'P1',
    confidence: 0.95,
    person_status: 'KNOWN',
    is_false_alarm: false,
    detected_at: new Date('2026-09-19T10:00:00Z'),
    camera_id: 'cam-01',
    camera_name: 'Camera phòng khách',
    zone_id: 'zone-01',
    zone_name: 'Khu vực sofa',
    matched_person_name: 'Bà Lan',
    thumbnail_object_key: 'events/2026/09/19/evt-1/thumbnail.jpg',
  };

  beforeEach(async () => {
    const mockEventsRepository = {
      listEvents: jest.fn(),
      findEventSummaryById: jest.fn(),
      findEventDetailById: jest.fn(),
      listStatusHistoryByEventId: jest.fn(),
      getEventStats: jest.fn(),
    };

    const mockMediaService = {
      listEventMediaWithUrls: jest.fn().mockResolvedValue([]),
    };

    const mockStorageService = {
      upload: jest.fn(),
      getPresignedUrl: jest.fn(),
    };

    const mockTokenService = {
      issueTokenPair: jest.fn(),
      verifyAccessToken: jest.fn(),
      verifyRefreshToken: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventsService,
        { provide: EventsRepository, useValue: mockEventsRepository },
        { provide: MediaService, useValue: mockMediaService },
        { provide: STORAGE_SERVICE, useValue: mockStorageService },
        { provide: TOKEN_SERVICE, useValue: mockTokenService },
      ],
    }).compile();

    service = module.get<EventsService>(EventsService);
    eventsRepository = module.get(EventsRepository);
    storageService = module.get(STORAGE_SERVICE);
    tokenService = module.get(TOKEN_SERVICE);
    mediaService = module.get(MediaService);
  });

  describe('listEvents', () => {
    it('tra ve danh sach su kien kem phan trang va presigned URL thumbnail', async () => {
      eventsRepository.listEvents.mockResolvedValueOnce({
        events: [mockRecord],
        total: 1,
      });

      storageService.getPresignedUrl.mockResolvedValueOnce({
        url: 'https://minio.local/presigned-thumb.jpg',
        expiresAt: new Date(Date.now() + 900 * 1000),
      });

      const result = await service.listEvents({ page: 1, pageSize: 20 });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe(mockRecord.id);
      expect(result.data[0].thumbnailUrl).toBe('https://minio.local/presigned-thumb.jpg');
      expect(result.data[0].camera?.name).toBe('Camera phòng khách');
      expect(result.meta).toEqual({
        page: 1,
        pageSize: 20,
        total: 1,
        totalPages: 1,
      });
    });

    it('xu ly an toan khi khong co thumbnail hoac gap loi storage', async () => {
      const recordWithoutThumb: EventListItemRecord = {
        ...mockRecord,
        camera_id: null,
        zone_id: null,
        confidence: null,
        person_status: null,
        matched_person_name: null,
        thumbnail_object_key: null,
      };

      eventsRepository.listEvents.mockResolvedValueOnce({
        events: [recordWithoutThumb],
        total: 1,
      });

      const result = await service.listEvents({ page: 1, pageSize: 10 });
      expect(result.data[0].thumbnailUrl).toBeNull();
      expect(result.data[0].camera).toBeNull();
      expect(result.data[0].zone).toBeNull();
      expect(result.data[0].confidence).toBeNull();
      expect(storageService.getPresignedUrl).not.toHaveBeenCalled();
    });

    it('bat loi ngoai le khi storage.getPresignedUrl nem loi', async () => {
      eventsRepository.listEvents.mockResolvedValueOnce({
        events: [mockRecord],
        total: 1,
      });

      storageService.getPresignedUrl.mockRejectedValueOnce(new Error('S3 unavailable'));

      const result = await service.listEvents({ page: 1, pageSize: 10 });
      expect(result.data[0].thumbnailUrl).toBeNull();
    });
  });

  describe('streamEvents & emitEvent', () => {
    it('nem UnauthorizedException khi khong truyen token', () => {
      expect(() => service.streamEvents(undefined)).toThrow(UnauthorizedException);
    });

    it('nem UnauthorizedException khi token khong hop le', () => {
      tokenService.verifyAccessToken.mockImplementationOnce(() => {
        throw new Error('Invalid token');
      });
      expect(() => service.streamEvents('invalid-token')).toThrow(UnauthorizedException);
    });

    it('tra ve Observable va nhan duoc su kien khi emitEvent', (done) => {
      tokenService.verifyAccessToken.mockReturnValueOnce({
        sub: 'u-1',
        email: 'admin@test.vn',
        role: 'ADMIN',
        tokenType: 'access',
        jti: 'token-jti-1',
      });

      const stream$ = service.streamEvents('valid-token');
      const subscription = stream$.subscribe((event) => {
        expect(event.type).toBe('event.created');
        expect(JSON.parse(String(event.data))).toMatchObject({ id: mockRecord.id });
        subscription.unsubscribe();
        done();
      });

      void service.toEventSummary(mockRecord).then((dto) => {
        service.emitEvent(dto);
      });
    });
  });

  describe('getEvent', () => {
    const mockDetailRecord: EventDetailRecord = {
      ...mockRecord,
      source: 'FRIGATE',
      track_id: 'track-101',
      ai_label: 'person',
      ai_model_version: 'yolo-v8s',
      ai_results: [
        { module: 'M1_FACE', label: 'UNKNOWN', confidence: 0.82 },
        'khong phai object',
        { label: 'thieu confidence' },
      ],
      retain: false,
      correlation_id: 'corr-1',
      escalation_deadline_at: null,
      notified_at: new Date('2026-09-19T10:00:05Z'),
      escalated_at: null,
      resolved_at: null,
      closed_at: null,
    };

    it('tra ve chi tiet su kien kem media, ket qua AI va lich su trang thai', async () => {
      eventsRepository.findEventDetailById.mockResolvedValueOnce(mockDetailRecord);
      eventsRepository.listStatusHistoryByEventId.mockResolvedValueOnce([
        {
          from_status: null,
          to_status: 'DETECTED',
          reason: 'Frigate phat hien nguoi',
          actor_type: 'SYSTEM',
          actor_name: null,
          channel: null,
          created_at: new Date('2026-09-19T10:00:00Z'),
        },
      ]);
      mediaService.listEventMediaWithUrls.mockResolvedValueOnce([
        {
          id: 'media-1',
          mediaType: 'SNAPSHOT',
          url: 'https://minio.local/presigned-snapshot.jpg',
          expiresAt: new Date().toISOString(),
          contentType: 'image/jpeg',
          sizeBytes: 1024,
          width: null,
          height: null,
          durationMs: null,
          createdAt: new Date().toISOString(),
        },
      ]);
      storageService.getPresignedUrl.mockResolvedValueOnce({
        url: 'https://minio.local/presigned-thumb.jpg',
        expiresAt: new Date(Date.now() + 900 * 1000),
      });

      const detail = await service.getEvent(mockDetailRecord.id);

      expect(detail.id).toBe(mockDetailRecord.id);
      expect(detail.thumbnailUrl).toBe('https://minio.local/presigned-thumb.jpg');
      expect(detail.media).toHaveLength(1);
      expect(detail.media[0].url).toBe('https://minio.local/presigned-snapshot.jpg');
      expect(detail.statusHistory[0].toStatus).toBe('DETECTED');
      expect(detail.notifiedAt).toBe('2026-09-19T10:00:05.000Z');
    });

    it('bo qua phan tu ai_results sai hinh dang trong cot JSONB', async () => {
      eventsRepository.findEventDetailById.mockResolvedValueOnce(mockDetailRecord);
      eventsRepository.listStatusHistoryByEventId.mockResolvedValueOnce([]);
      storageService.getPresignedUrl.mockResolvedValueOnce({
        url: 'https://minio.local/presigned-thumb.jpg',
        expiresAt: new Date(Date.now() + 900 * 1000),
      });

      const detail = await service.getEvent(mockDetailRecord.id);

      expect(detail.aiResults).toHaveLength(1);
      expect(detail.aiResults[0].label).toBe('UNKNOWN');
    });

    it('giu UNDETERMINED null score va bo diem khong hop le', async () => {
      eventsRepository.findEventDetailById.mockResolvedValueOnce({
        ...mockDetailRecord,
        ai_results: [
          { module: 'M1_FACE', label: 'UNDETERMINED', confidence: null },
          { module: 'M1_FACE', label: 'UNKNOWN', confidence: Number.NaN },
          { module: 'M1_FACE', label: 'UNKNOWN', confidence: 1.1 },
        ],
      });
      eventsRepository.listStatusHistoryByEventId.mockResolvedValueOnce([]);
      storageService.getPresignedUrl.mockResolvedValueOnce({
        url: 'https://minio.local/snapshot.jpg',
        expiresAt: new Date(),
      });
      const detail = await service.getEvent(mockDetailRecord.id);
      expect(detail.aiResults).toEqual([
        { module: 'M1_FACE', label: 'UNDETERMINED', confidence: null },
      ]);
    });

    it('nem NotFoundException khi khong tim thay su kien', async () => {
      eventsRepository.findEventDetailById.mockResolvedValueOnce(null);
      await expect(service.getEvent('khong-ton-tai')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getStats', () => {
    it('quy doi ban ghi thong ke sang DTO cho dashboard', async () => {
      eventsRepository.getEventStats.mockResolvedValueOnce({
        aggregate: {
          total_events: 12,
          person_detected_count: 9,
          pending_count: 3,
          resolved_count: 8,
          false_alarm_count: 1,
          latest_event_at: new Date('2026-09-19T10:00:00Z'),
        },
        byType: [{ event_type: 'PERSON_DETECTED', count: 9 }],
        byPriority: [{ priority: 'P3', count: 9 }],
        cameras: { online_count: 3, total_count: 4 },
        latestPendingEvent: {
          id: 'evt-pending',
          event_type: 'PERSON_DETECTED',
          priority: 'P3',
          camera_name: 'Camera bếp',
          zone_name: 'Khu vực bếp nấu',
          detected_at: new Date('2026-09-19T09:59:00Z'),
        },
      });

      const stats = await service.getStats(24);

      expect(stats.windowHours).toBe(24);
      expect(stats.totalEvents).toBe(12);
      expect(stats.personDetectedCount).toBe(9);
      expect(stats.cameraOnlineCount).toBe(3);
      expect(stats.cameraTotalCount).toBe(4);
      expect(stats.latestEventAt).toBe('2026-09-19T10:00:00.000Z');
      expect(stats.latestPendingEvent?.cameraName).toBe('Camera bếp');
      expect(stats.byType).toEqual([{ eventType: 'PERSON_DETECTED', count: 9 }]);
    });

    it('tinh cua so thong ke nguoc tu hien tai theo windowHours', async () => {
      eventsRepository.getEventStats.mockResolvedValueOnce({
        aggregate: {
          total_events: 0,
          person_detected_count: 0,
          pending_count: 0,
          resolved_count: 0,
          false_alarm_count: 0,
          latest_event_at: null,
        },
        byType: [],
        byPriority: [],
        cameras: { online_count: 0, total_count: 0 },
        latestPendingEvent: null,
      });

      const beforeCall = Date.now();
      const stats = await service.getStats(1);
      const since = eventsRepository.getEventStats.mock.calls[0][0];

      expect(stats.latestPendingEvent).toBeNull();
      expect(beforeCall - since.getTime()).toBeGreaterThanOrEqual(60 * 60 * 1000);
      expect(beforeCall - since.getTime()).toBeLessThan(61 * 60 * 1000);
    });
  });

  describe('ListEventsQueryDto transforms', () => {
    it('chuyen doi cac truong query thanh mang va boolean', () => {
      const dto1 = plainToInstance(ListEventsQueryDto, {
        eventType: 'FALL_DETECTED',
        isFalseAlarm: 'true',
      });
      expect(dto1.eventType).toEqual(['FALL_DETECTED']);
      expect(dto1.isFalseAlarm).toBe(true);

      const dto2 = plainToInstance(ListEventsQueryDto, {
        isFalseAlarm: 'false',
      });
      expect(dto2.isFalseAlarm).toBe(false);

      const dto3 = plainToInstance(ListEventsQueryDto, {
        eventType: ['FIRE_SMOKE_DETECTED'],
        isFalseAlarm: 'invalid',
      });
      expect(dto3.eventType).toEqual(['FIRE_SMOKE_DETECTED']);
      expect(dto3.isFalseAlarm).toBe('invalid');
    });
  });
});
