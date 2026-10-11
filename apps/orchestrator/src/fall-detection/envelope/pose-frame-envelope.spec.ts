import { unpackPoseFrameEnvelope } from './pose-frame-envelope';
import type { PoseFrameHeaderDto } from '../dto/pose-frame.dto';

describe('unpackPoseFrameEnvelope', () => {
  const createValidHeader = (): PoseFrameHeaderDto => ({
    schemaVersion: 1,
    sourceSessionId: 'sess-123',
    frameId: 'frame-456',
    cameraSlug: 'cam-livingroom',
    frameTimestamp: Date.now() / 1000,
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

  const packEnvelope = (header: unknown, imageBytes: Buffer): Buffer => {
    const headerStr = JSON.stringify(header);
    const headerBuf = Buffer.from(headerStr, 'utf8');
    const envelope = Buffer.alloc(4 + headerBuf.length + imageBytes.length);
    envelope.writeUInt32BE(headerBuf.length, 0);
    headerBuf.copy(envelope, 4);
    imageBytes.copy(envelope, 4 + headerBuf.length);
    return envelope;
  };

  it('unpacks a valid envelope with header and image buffer', () => {
    // Arrange
    const header = createValidHeader();
    const fakeImage = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const envelope = packEnvelope(header, fakeImage);

    // Act
    const result = unpackPoseFrameEnvelope(envelope);

    // Assert
    expect(result).not.toBeNull();
    expect(result?.header.cameraSlug).toBe('cam-livingroom');
    expect(result?.header.persons).toHaveLength(1);
    expect(result?.header.persons[0].trackId).toBe('track-1');
    expect(result?.imageBytes).toEqual(fakeImage);
  });

  it('returns null when buffer length is less than 4 bytes', () => {
    // Arrange
    const shortBuffer = Buffer.from([0x00, 0x01]);

    // Act
    const result = unpackPoseFrameEnvelope(shortBuffer);

    // Assert
    expect(result).toBeNull();
  });

  it('returns null when buffer exceeds MAX_ENVELOPE_BYTES (1 MiB)', () => {
    // Arrange
    const oversizedBuffer = Buffer.alloc(1024 * 1024 + 10);
    oversizedBuffer.writeUInt32BE(10, 0);

    // Act
    const result = unpackPoseFrameEnvelope(oversizedBuffer);

    // Assert
    expect(result).toBeNull();
  });

  it('returns null when header length exceeds MAX_HEADER_BYTES (32 KiB)', () => {
    // Arrange
    const buffer = Buffer.alloc(40);
    buffer.writeUInt32BE(33 * 1024, 0);

    // Act
    const result = unpackPoseFrameEnvelope(buffer);

    // Assert
    expect(result).toBeNull();
  });

  it('returns null when header is truncated in buffer', () => {
    // Arrange
    const buffer = Buffer.alloc(20);
    buffer.writeUInt32BE(50, 0); // claims 50 bytes header, but buffer only has 20

    // Act
    const result = unpackPoseFrameEnvelope(buffer);

    // Assert
    expect(result).toBeNull();
  });

  it('returns null when header is not valid JSON', () => {
    // Arrange
    const corruptHeader = Buffer.from('not-json{');
    const buffer = Buffer.alloc(4 + corruptHeader.length);
    buffer.writeUInt32BE(corruptHeader.length, 0);
    corruptHeader.copy(buffer, 4);

    // Act
    const result = unpackPoseFrameEnvelope(buffer);

    // Assert
    expect(result).toBeNull();
  });

  it('returns null when header fails schema validation', () => {
    // Arrange
    const invalidHeader = {
      schemaVersion: 'not-a-number', // invalid type
      cameraSlug: 'cam-1',
    };
    const envelope = packEnvelope(invalidHeader, Buffer.from([]));

    // Act
    const result = unpackPoseFrameEnvelope(envelope);

    // Assert
    expect(result).toBeNull();
  });

  it('returns null when person list exceeds MAX_PERSONS_PER_FRAME (8)', () => {
    // Arrange
    const header = createValidHeader();
    header.persons = Array.from({ length: 9 }, (_, i) => ({
      trackId: `track-${i}`,
      boundingBox: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
      observedAt: 12345,
    }));
    const envelope = packEnvelope(header, Buffer.from([]));

    // Act
    const result = unpackPoseFrameEnvelope(envelope);

    // Assert
    expect(result).toBeNull();
  });
});
