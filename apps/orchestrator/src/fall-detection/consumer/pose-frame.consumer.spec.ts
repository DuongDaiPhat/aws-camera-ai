import { ConfigService } from '@nestjs/config';
import type { CamerasRepository } from '../../cameras/cameras.repository';
import type { FallIncidentCoordinator } from '../coordinator/fall-incident.coordinator';
import { PoseFrameConsumer } from './pose-frame.consumer';
import type { PoseFrameHeaderDto } from '../dto/pose-frame.dto';

describe('PoseFrameConsumer', () => {
  let consumer: PoseFrameConsumer;
  let mockConfigService: jest.Mocked<ConfigService>;
  let mockCamerasRepository: jest.Mocked<CamerasRepository>;
  let mockCoordinator: jest.Mocked<FallIncidentCoordinator>;

  beforeEach(() => {
    mockConfigService = {
      get: jest.fn().mockImplementation((key: string, defaultVal: unknown) => {
        if (key === 'M2A_ENABLED') return 'true';
        if (key === 'POSE_MAX_STALE_FRAME_SECONDS') return 1.0;
        return defaultVal;
      }),
    } as unknown as jest.Mocked<ConfigService>;

    mockCamerasRepository = {
      findBySlug: jest.fn(),
    } as unknown as jest.Mocked<CamerasRepository>;

    mockCoordinator = {
      processFrame: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<FallIncidentCoordinator>;

    consumer = new PoseFrameConsumer(mockConfigService, mockCamerasRepository, mockCoordinator);
  });

  const packEnvelope = (header: PoseFrameHeaderDto, imageBytes: Buffer): Buffer => {
    const headerStr = JSON.stringify(header);
    const headerBuf = Buffer.from(headerStr, 'utf8');
    const envelope = Buffer.alloc(4 + headerBuf.length + imageBytes.length);
    envelope.writeUInt32BE(headerBuf.length, 0);
    headerBuf.copy(envelope, 4);
    imageBytes.copy(envelope, 4 + headerBuf.length);
    return envelope;
  };

  const createValidHeader = (timestampOffset = 0): PoseFrameHeaderDto => ({
    schemaVersion: 1,
    sourceSessionId: 'sess-1',
    frameId: 'frame-1',
    cameraSlug: 'cam-livingroom',
    frameTimestamp: Date.now() / 1000 + timestampOffset,
    frameWidth: 1280,
    frameHeight: 720,
    persons: [
      {
        trackId: 'track-1',
        boundingBox: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
        observedAt: Date.now() / 1000,
      },
    ],
  });

  it('routes fresh valid frame to coordinator when camera is enabled', async () => {
    // Arrange
    const header = createValidHeader(0);
    const fakeImage = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    const envelope = packEnvelope(header, fakeImage);

    mockCamerasRepository.findBySlug.mockResolvedValue({
      id: 'cam-uuid-1',
      is_enabled: true,
    } as never);

    // Act
    await consumer.handlePoseFrame(envelope);

    // Assert
    expect(mockCamerasRepository.findBySlug).toHaveBeenCalledWith('cam-livingroom');
    expect(mockCoordinator.processFrame).toHaveBeenCalledWith(
      expect.objectContaining({
        cameraId: 'cam-uuid-1',
        cameraSlug: 'cam-livingroom',
        sourceSessionId: 'sess-1',
        frameId: 'frame-1',
      }),
    );
  });

  it('discards stale frames where age exceeds maxStaleFrameSeconds', async () => {
    // Arrange: frame timestamp from 5 seconds ago
    const header = createValidHeader(-5.0);
    const fakeImage = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    const envelope = packEnvelope(header, fakeImage);

    // Act
    await consumer.handlePoseFrame(envelope);

    // Assert
    expect(mockCamerasRepository.findBySlug).not.toHaveBeenCalled();
    expect(mockCoordinator.processFrame).not.toHaveBeenCalled();
  });

  it('does nothing when M2A_ENABLED is false', async () => {
    // Arrange
    mockConfigService.get.mockImplementation((key: string, defaultVal: unknown) => {
      if (key === 'M2A_ENABLED') return 'false';
      return defaultVal;
    });
    const disabledConsumer = new PoseFrameConsumer(
      mockConfigService,
      mockCamerasRepository,
      mockCoordinator,
    );
    const envelope = packEnvelope(createValidHeader(), Buffer.from([]));

    // Act
    await disabledConsumer.handlePoseFrame(envelope);

    // Assert
    expect(mockCamerasRepository.findBySlug).not.toHaveBeenCalled();
  });

  it('does nothing when camera is disabled or not found', async () => {
    // Arrange
    const envelope = packEnvelope(createValidHeader(), Buffer.from([]));
    mockCamerasRepository.findBySlug.mockResolvedValue({
      id: 'cam-uuid-1',
      is_enabled: false,
    } as never);

    // Act
    await consumer.handlePoseFrame(envelope);

    // Assert
    expect(mockCoordinator.processFrame).not.toHaveBeenCalled();
  });
});
