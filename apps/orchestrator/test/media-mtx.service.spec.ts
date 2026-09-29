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
      providers: [MediaMtxService, { provide: ConfigService, useValue: mockConfigService }],
    }).compile();

    service = module.get<MediaMtxService>(MediaMtxService);
  });

  describe('createBrowserSession', () => {
    it('tra ve publishUrl WHIP va streamKey voi slug hop le', () => {
      const session = service.createBrowserSession('cam_living_room');

      expect(session.publishUrl).toBe('http://localhost:8889/cam_living_room/whip');
      expect(session.streamKey).toBe('cam_living_room');
      expect(session.token).toBeDefined();
      expect(session.token.length).toBeGreaterThan(10);
      expect(new Date(session.expiresAt).getTime()).toBeGreaterThan(Date.now());
    });

    it('nem BadRequestException khi slug chua ky tu khong hop le', () => {
      expect(() => service.createBrowserSession('Cam Living Room')).toThrow(BadRequestException);
      expect(() => service.createBrowserSession('123_invalid')).toThrow(BadRequestException);
      expect(() => service.createBrowserSession('a')).toThrow(BadRequestException);
    });
  });

  describe('createBrowserReadSession', () => {
    it('tao URL xem WebRTC kem token ngan han va gioi han dung camera', () => {
      const session = service.createBrowserReadSession('cam_living_room');

      expect(session.streamUrl).toContain('http://localhost:8889/cam_living_room');
      expect(session.streamUrl).toContain(`token=${session.token}`);
      expect(service.verifyBrowserReadSession('cam_living_room', session.token)).toBe(true);
      expect(service.verifyBrowserReadSession('cam_other', session.token)).toBe(false);
    });

    it('tai su dung phien doc con han de player khong ket noi lai moi lan poll', () => {
      const first = service.createBrowserReadSession('cam_living_room', 'camera-id-1');
      const second = service.createBrowserReadSession('cam_living_room', 'camera-id-1');

      expect(second.token).toBe(first.token);
      expect(second.streamUrl).toBe(first.streamUrl);
    });
  });

  describe('Session Token Security & Revocation', () => {
    it('verifyBrowserSession tra ve true voi token hop le', () => {
      const session = service.createBrowserSession('cam_test', 'camera-id-1');
      expect(service.verifyBrowserSession('cam_test', session.token)).toBe(true);
    });

    it('verifyBrowserSession tra ve false voi token sai hoac slug khac', () => {
      const session = service.createBrowserSession('cam_test', 'camera-id-1');
      expect(service.verifyBrowserSession('cam_other', session.token)).toBe(false);
      expect(service.verifyBrowserSession('cam_test', 'invalid-token')).toBe(false);
    });

    it('revokeBrowserSession thu hoi session thanh cong', () => {
      const session = service.createBrowserSession('cam_test', 'camera-id-1');
      expect(service.revokeBrowserSession('camera-id-1')).toBe(true);
      expect(service.verifyBrowserSession('cam_test', session.token)).toBe(false);
    });
  });

  describe('getPublishRtspUrl', () => {
    it('tra ve URL RTSP publish len MediaMTX', () => {
      const url = service.getPublishRtspUrl('cam_test');
      expect(url).toBe('rtsp://cam-internal:local-dev-password@localhost:8554/cam_test');
    });
  });
});
