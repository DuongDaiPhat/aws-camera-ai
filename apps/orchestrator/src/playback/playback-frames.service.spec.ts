import { ConfigService } from '@nestjs/config';
import { PlaybackFramesService } from './playback-frames.service';
import { PlaybackFramesRepository } from './playback-frames.repository';
describe('Background historical geometry writer', () => {
  const now = 1794900000000;
  const repository = { cameras: jest.fn(), insert: jest.fn(), prune: jest.fn() };
  let service: PlaybackFramesService;
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(now);
    jest.clearAllMocks();
    repository.cameras.mockResolvedValue([
      { id: 'camera', slug: 'cam_test', width: 1280, height: 720 },
    ]);
    repository.insert.mockResolvedValue(undefined);
    repository.prune.mockResolvedValue(undefined);
    service = new PlaybackFramesService(
      repository as unknown as PlaybackFramesRepository,
      new ConfigService(),
    );
    service.onModuleInit();
  });
  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
  });
  const payload = (objects: unknown[]) => ({
    camera: 'cam_test',
    frameTime: Date.now() / 1000,
    objects,
  });
  it('archives a normalized person sample without doing DB work in the MQTT callback', async () => {
    service.enqueue(
      payload([{ label: 'person', score: 0.9, box: [128, 72, 640, 432], observedAt: now / 1000 }]),
    );
    expect(repository.insert).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(500);
    expect(repository.insert).toHaveBeenCalledWith('camera', now, [
      { label: 'person', x: 0.1, y: 0.1, width: 0.4, height: 0.5, confidence: 0.9 },
    ]);
  });
  it('keeps an analyzed empty frame distinguishable from missing metadata', async () => {
    service.enqueue(payload([]));
    await jest.advanceTimersByTimeAsync(500);
    expect(repository.insert).toHaveBeenCalledWith('camera', now, []);
  });
  it('does not record corrupt geometry as a negative person detection', async () => {
    service.enqueue(
      payload([{ label: 'person', score: 0.9, box: [0, 0, 5000, 5000], observedAt: now / 1000 }]),
    );
    await jest.advanceTimersByTimeAsync(500);
    expect(repository.insert).not.toHaveBeenCalled();
  });
});
