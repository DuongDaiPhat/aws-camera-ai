import { UnauthorizedException } from '@nestjs/common';
import { MediaMtxAuthController } from '../src/camera-sources/media-mtx-auth.controller';
import { MediaMtxService } from '../src/camera-sources/media-mtx.service';
import { CameraSourcesRepository } from '../src/camera-sources/camera-sources.repository';

describe('MediaMtxAuthController', () => {
  let controller: MediaMtxAuthController;
  const mediaMtxService = {
    verifyBrowserSession: jest.fn(),
    verifyInternalStreamCredentials: jest.fn(),
  } as unknown as MediaMtxService;
  const cameraSourcesRepository = {
    isEnabledMediaPath: jest.fn(),
  } as unknown as CameraSourcesRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(mediaMtxService.verifyInternalStreamCredentials).mockReturnValue(false);
    controller = new MediaMtxAuthController(mediaMtxService, cameraSourcesRepository);
  });

  it('allows only a valid WebRTC publish token for its bound camera path', async () => {
    jest.mocked(mediaMtxService.verifyBrowserSession).mockReturnValue(true);
    jest.mocked(cameraSourcesRepository.isEnabledMediaPath).mockResolvedValue(true);

    await expect(
      controller.authorize({
        action: 'publish',
        protocol: 'webrtc',
        path: 'cam_front',
        token: 'short-lived-token',
      }),
    ).resolves.toBeUndefined();
    expect(mediaMtxService.verifyBrowserSession).toHaveBeenCalledWith(
      'cam_front',
      'short-lived-token',
    );
    expect(cameraSourcesRepository.isEnabledMediaPath).toHaveBeenCalledWith(
      'cam_front',
      'publish_browser',
    );
  });

  it('rejects a valid browser token after the camera source is disabled or changed', async () => {
    jest.mocked(mediaMtxService.verifyBrowserSession).mockReturnValue(true);
    jest.mocked(cameraSourcesRepository.isEnabledMediaPath).mockResolvedValue(false);

    await expect(controller.authorize({
      action: 'publish',
      protocol: 'webrtc',
      path: 'cam_front',
      token: 'short-lived-token',
    })).rejects.toThrow(UnauthorizedException);
  });

  it('allows Frigate and FFmpeg RTSP access only with internal credentials on enabled paths', async () => {
    jest.mocked(mediaMtxService.verifyInternalStreamCredentials).mockReturnValue(true);
    jest.mocked(cameraSourcesRepository.isEnabledMediaPath).mockResolvedValue(true);

    await expect(
      controller.authorize({
        action: 'read',
        protocol: 'rtsp',
        path: 'cam_front',
        user: 'cam-internal',
        password: 'secret',
      }),
    ).resolves.toBeUndefined();
    expect(cameraSourcesRepository.isEnabledMediaPath).toHaveBeenCalledWith('cam_front', 'read');
  });

  it.each([
    { action: 'publish', protocol: 'webrtc', path: 'cam_other', token: 'invalid' },
    { action: 'read', protocol: 'webrtc', path: 'cam_front', token: 'short-lived-token' },
    { action: 'publish', protocol: 'rtsp', path: 'cam_front', token: 'short-lived-token' },
  ])('rejects unauthorized media actions: %o', async (body) => {
    jest.mocked(mediaMtxService.verifyBrowserSession).mockReturnValue(false);
    await expect(controller.authorize(body)).rejects.toThrow(UnauthorizedException);
  });
});
