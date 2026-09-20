import { Test, TestingModule } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { UnauthorizedException } from '@nestjs/common';
import { EventsService } from '../src/events/events.service';
import { EventsRepository, EventListItemRecord } from '../src/events/events.repository';
import { ListEventsQueryDto } from '../src/events/dto/list-events-query.dto';
import { STORAGE_SERVICE, IStorageService } from '../src/storage/storage.interface';
import { TOKEN_SERVICE, TokenService } from '../src/auth/auth.types';

describe('EventsService (US-06)', () => {
  let service: EventsService;
  let eventsRepository: jest.Mocked<EventsRepository>;
  let storageService: jest.Mocked<IStorageService>;
  let tokenService: jest.Mocked<TokenService>;

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
        { provide: STORAGE_SERVICE, useValue: mockStorageService },
        { provide: TOKEN_SERVICE, useValue: mockTokenService },
      ],
    }).compile();

    service = module.get<EventsService>(EventsService);
    eventsRepository = module.get(EventsRepository);
    storageService = module.get(STORAGE_SERVICE);
    tokenService = module.get(TOKEN_SERVICE);
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
