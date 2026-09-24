import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { MediaMtxService } from '../src/camera-sources/media-mtx.service';

describe('MediaMtxService (Slice CAM)', () => {
  let service: MediaMtxService;

  beforeEach(async () => {
    const mockConfigService = {
      get: jest.fn((key: string, defaultVal: string) => {
        if (key === 'MEDIAMTX_WEBRTC_URL') return 'http://localhost:8889';
        if (key === 'MEDIAMTX_RTSP_URL') return 'rtsp://localhost:8554';
        return defaultVal;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MediaMtxService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<MediaMtxService>(MediaMtxService);
  });

  describe('createBrowserSession', () => {
    it('tra ve publishUrl WHIP va streamKey voi slug hop le', () => {
      const session = service.createBrowserSession('cam_living_room');

      expect(session.publishUrl).toBe('http://localhost:8889/cam_living_room/whip');
      expect(session.streamKey).toBe('cam_living_room');
      expect(new Date(session.expiresAt).getTime()).toBeGreaterThan(Date.now());
    });

    it('nem BadRequestException khi slug chua ky tu khong hop le', () => {
      expect(() => service.createBrowserSession('Cam Living Room')).toThrow(
        BadRequestException,
      );
      expect(() => service.createBrowserSession('123_invalid')).toThrow(
        BadRequestException,
      );
      expect(() => service.createBrowserSession('a')).toThrow(BadRequestException);
    });
  });

  describe('getPublishRtspUrl', () => {
    it('tra ve URL RTSP publish len MediaMTX', () => {
      const url = service.getPublishRtspUrl('cam_test');
      expect(url).toBe('rtsp://localhost:8554/cam_test');
    });
  });
});
