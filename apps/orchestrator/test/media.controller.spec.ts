import { Test, TestingModule } from '@nestjs/testing';
import { MediaController } from '../src/media/media.controller';
import { MediaService } from '../src/media/media.service';
import { EventMediaResponseDto } from '../src/media/dto/event-media-response.dto';

describe('MediaController (US-04)', () => {
  let controller: MediaController;
  let mediaService: jest.Mocked<MediaService>;

  beforeEach(async () => {
    const mockMediaService = {
      listEventMediaWithUrls: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MediaController],
      providers: [{ provide: MediaService, useValue: mockMediaService }],
    }).compile();

    controller = module.get<MediaController>(MediaController);
    mediaService = module.get(MediaService);
  });

  it('tra ve danh sach media kem presigned URL dung dinh dang OpenAPI { data: [...] }', async () => {
    const mockMediaDto: EventMediaResponseDto = {
      id: 'media-1',
      mediaType: 'SNAPSHOT',
      url: 'http://localhost:9000/presigned-url',
      expiresAt: '2026-09-18T10:15:00.000Z',
      contentType: 'image/jpeg',
      sizeBytes: 2048,
      width: 1280,
      height: 720,
      durationMs: null,
      createdAt: '2026-09-18T10:00:00.000Z',
    };

    mediaService.listEventMediaWithUrls.mockResolvedValueOnce([mockMediaDto]);

    const result = await controller.listEventMedia('0192f8a1-0000-0000-0000-000000000001');

    expect(mediaService.listEventMediaWithUrls).toHaveBeenCalledWith(
      '0192f8a1-0000-0000-0000-000000000001',
    );
    expect(result).toEqual({ data: [mockMediaDto] });
  });
});
