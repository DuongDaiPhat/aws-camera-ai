import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { MediaService } from '../src/media/media.service';
import { EventMediaRepository } from '../src/media/event-media.repository';
import { STORAGE_SERVICE, IStorageService } from '../src/storage/storage.interface';

describe('MediaService (US-04)', () => {
  let service: MediaService;
  let eventMediaRepository: jest.Mocked<EventMediaRepository>;
  let storageService: jest.Mocked<IStorageService>;

  beforeEach(async () => {
    const mockEventMediaRepository = {
      createEventMedia: jest.fn(),
      findMediaByEventId: jest.fn(),
      findEventById: jest.fn(),
      findEventByTrackId: jest.fn(),
    };

    const mockStorageService = {
      upload: jest.fn(),
      getPresignedUrl: jest.fn(),
    };

    const mockConfigService = {
      get: jest.fn((key: string, defaultValue?: unknown) => {
        if (key === 'FRIGATE_URL') return 'http://localhost:5000';
        if (key === 'STORAGE_PROVIDER') return 'minio';
        if (key === 'STORAGE_BUCKET') return 'camerai-media';
        return defaultValue;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MediaService,
        { provide: EventMediaRepository, useValue: mockEventMediaRepository },
        { provide: STORAGE_SERVICE, useValue: mockStorageService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<MediaService>(MediaService);
    eventMediaRepository = module.get(EventMediaRepository);
    storageService = module.get(STORAGE_SERVICE);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('downloadAndStoreSnapshot', () => {
    it('tai snapshot tu Frigate va upload len storage thanh cong', async () => {
      const fakeImageBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
      jest.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => fakeImageBytes.buffer,
      } as Response);

      storageService.upload.mockResolvedValueOnce({
        bucket: 'camerai-media',
        key: 'events/2026/09/18/evt-1/snapshot.jpg',
        sizeBytes: 4,
        contentType: 'image/jpeg',
      });

      eventMediaRepository.createEventMedia.mockResolvedValueOnce({
        id: 'media-1',
        event_id: 'evt-1',
        media_type: 'SNAPSHOT',
        storage_provider: 'MINIO',
        bucket: 'camerai-media',
        object_key: 'events/2026/09/18/evt-1/snapshot.jpg',
        content_type: 'image/jpeg',
        size_bytes: 4,
        width: null,
        height: null,
        duration_ms: null,
        checksum_sha256: null,
        expires_at: null,
        created_at: new Date(),
      });

      const result = await service.downloadAndStoreSnapshot(
        'evt-1',
        'track-1',
        new Date('2026-09-18T10:00:00Z'),
      );

      expect(global.fetch).toHaveBeenCalledWith('http://localhost:5000/api/events/track-1/snapshot.jpg');
      expect(storageService.upload).toHaveBeenCalledWith(
        'events/2026/09/18/evt-1/snapshot.jpg',
        expect.any(Buffer),
        'image/jpeg',
      );
      expect(eventMediaRepository.createEventMedia).toHaveBeenCalledWith(
        expect.objectContaining({
          eventId: 'evt-1',
          mediaType: 'SNAPSHOT',
          bucket: 'camerai-media',
          objectKey: 'events/2026/09/18/evt-1/snapshot.jpg',
        }),
      );
      expect(result).toBeDefined();
    });

    it('khong bi crash va tra ve null khi Frigate tra ve 404', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 404,
      } as Response);

      const result = await service.downloadAndStoreSnapshot(
        'evt-1',
        'track-1',
        new Date('2026-09-18T10:00:00Z'),
      );

      expect(result).toBeNull();
      expect(storageService.upload).not.toHaveBeenCalled();
    });
  });

  describe('downloadAndStoreClip', () => {
    it('tai clip tu Frigate va upload len storage thanh cong', async () => {
      const fakeVideoBytes = new Uint8Array([0x00, 0x00, 0x00, 0x18]);
      jest.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => fakeVideoBytes.buffer,
      } as Response);

      storageService.upload.mockResolvedValueOnce({
        bucket: 'camerai-media',
        key: 'events/2026/09/18/evt-2/clip.mp4',
        sizeBytes: 4,
        contentType: 'video/mp4',
      });

      eventMediaRepository.createEventMedia.mockResolvedValueOnce({
        id: 'media-clip-1',
        event_id: 'evt-2',
        media_type: 'CLIP',
        storage_provider: 'MINIO',
        bucket: 'camerai-media',
        object_key: 'events/2026/09/18/evt-2/clip.mp4',
        content_type: 'video/mp4',
        size_bytes: 4,
        width: null,
        height: null,
        duration_ms: 12000,
        checksum_sha256: null,
        expires_at: null,
        created_at: new Date(),
      });

      const result = await service.downloadAndStoreClip(
        'evt-2',
        'track-2',
        new Date('2026-09-18T10:00:00Z'),
        12000,
      );

      expect(global.fetch).toHaveBeenCalledWith('http://localhost:5000/api/events/track-2/clip.mp4');
      expect(storageService.upload).toHaveBeenCalledWith(
        'events/2026/09/18/evt-2/clip.mp4',
        expect.any(Buffer),
        'video/mp4',
      );
      expect(eventMediaRepository.createEventMedia).toHaveBeenCalledWith(
        expect.objectContaining({
          eventId: 'evt-2',
          mediaType: 'CLIP',
          durationMs: 12000,
        }),
      );
      expect(result).toBeDefined();
    });
  });

  describe('listEventMediaWithUrls (FR-EVT-07)', () => {
    it('sinh presigned URL 15 phut cho cac media cua su kien', async () => {
      eventMediaRepository.findEventById.mockResolvedValueOnce({
        id: 'evt-100',
        camera_id: null,
        zone_id: null,
        event_type: 'PERSON_DETECTED',
        status: 'DETECTED',
        priority: 'P3',
        source: 'FRIGATE',
        track_id: 't-1',
        dedup_key: 'd-1',
        confidence: 0.85,
        ai_results: [],
        correlation_id: 'corr-1',
        detected_at: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      });

      eventMediaRepository.findMediaByEventId.mockResolvedValueOnce([
        {
          id: 'media-1',
          event_id: 'evt-100',
          media_type: 'SNAPSHOT',
          storage_provider: 'MINIO',
          bucket: 'camerai-media',
          object_key: 'events/2026/09/18/evt-100/snapshot.jpg',
          content_type: 'image/jpeg',
          size_bytes: 1024,
          width: 1280,
          height: 720,
          duration_ms: null,
          checksum_sha256: null,
          expires_at: null,
          created_at: new Date('2026-09-18T10:00:00Z'),
        },
      ]);

      const expireDate = new Date('2026-09-18T10:15:00Z');
      storageService.getPresignedUrl.mockResolvedValueOnce({
        url: 'http://localhost:9000/camerai-media/events/...snapshot.jpg?sig=abc',
        expiresAt: expireDate,
      });

      const mediaList = await service.listEventMediaWithUrls('evt-100');

      expect(mediaList).toHaveLength(1);
      expect(mediaList[0]).toEqual({
        id: 'media-1',
        mediaType: 'SNAPSHOT',
        url: 'http://localhost:9000/camerai-media/events/...snapshot.jpg?sig=abc',
        expiresAt: expireDate.toISOString(),
        contentType: 'image/jpeg',
        sizeBytes: 1024,
        width: 1280,
        height: 720,
        durationMs: null,
        createdAt: '2026-09-18T10:00:00.000Z',
      });
      expect(storageService.getPresignedUrl).toHaveBeenCalledWith(
        'events/2026/09/18/evt-100/snapshot.jpg',
        900,
      );
    });

    it('nem NotFoundException neu event khong ton tai', async () => {
      eventMediaRepository.findEventById.mockResolvedValueOnce(null);

      await expect(service.listEventMediaWithUrls('non-existent-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
