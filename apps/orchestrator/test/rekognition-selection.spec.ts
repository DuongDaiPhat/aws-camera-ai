import { ConfigService } from '@nestjs/config';
import { DetectFacesCommand, type RekognitionClient } from '@aws-sdk/client-rekognition';
import sharp from 'sharp';
import { RekognitionFaceEnrollmentService } from '../src/known-faces/rekognition-face-enrollment.service';

const config = new ConfigService({
  FACE_PROVIDER: 'rekognition',
  AWS_REGION: 'ap-southeast-1',
  REKOGNITION_COLLECTION_PREFIX: 'camerai-s4-dev-owner-',
});

async function image(format: 'jpeg' | 'webp' = 'jpeg') {
  const buffer = await sharp({
    create: { width: 400, height: 300, channels: 3, background: 'white' },
  })
    .toFormat(format)
    .toBuffer();
  return { buffer, size: buffer.length };
}

describe('Rekognition face selection regression', () => {
  it('crops the selected face, validates the crop, and clears the original image buffer', async () => {
    const send = jest
      .fn()
      .mockResolvedValueOnce({
        FaceDetails: [
          { BoundingBox: { Left: 0.1, Top: 0.2, Width: 0.3, Height: 0.4 } },
          { BoundingBox: { Left: 0.7, Top: 0, Width: 0.1, Height: 0.1 } },
        ],
      })
      .mockResolvedValueOnce({ FaceDetails: [{}] });
    const service = new RekognitionFaceEnrollmentService(config, {
      send,
    } as unknown as RekognitionClient);
    const file = await image();
    const original = file.buffer;
    await service.validateSingleFaces([file], [0]);
    const metadata = await sharp(file.buffer).metadata();
    expect(metadata.width).toBe(180);
    expect(metadata.height).toBe(180);
    expect(original.every((byte) => byte === 0)).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0]).toBeInstanceOf(DetectFacesCommand);
    expect(send.mock.calls[1][0].input.Image.Bytes).toBe(file.buffer);
  });

  it('rejects an out-of-range selection instead of indexing another person', async () => {
    const send = jest.fn().mockResolvedValue({ FaceDetails: [{}] });
    const service = new RekognitionFaceEnrollmentService(config, {
      send,
    } as unknown as RekognitionClient);
    await expect(service.validateSingleFaces([await image()], [5])).rejects.toMatchObject({
      response: { error: { code: 'FACE_SELECTION_INVALID' } },
    });
  });

  it('rejects a crop that still contains two faces without returning coordinates for the wrong image', async () => {
    const send = jest
      .fn()
      .mockResolvedValueOnce({
        FaceDetails: [{ BoundingBox: { Left: 0.1, Top: 0.2, Width: 0.3, Height: 0.4 } }],
      })
      .mockResolvedValueOnce({ FaceDetails: [{}, {}] });
    const service = new RekognitionFaceEnrollmentService(config, {
      send,
    } as unknown as RekognitionClient);
    await expect(service.validateSingleFaces([await image()], [0])).rejects.toMatchObject({
      response: { error: { code: 'FACE_SELECTION_INVALID' } },
    });
  });

  it('converts WebP to JPEG before calling Rekognition', async () => {
    const send = jest.fn().mockResolvedValue({ FaceDetails: [{}] });
    const service = new RekognitionFaceEnrollmentService(config, {
      send,
    } as unknown as RekognitionClient);
    const file = await image('webp');
    await service.validateSingleFaces([file]);
    expect((await sharp(file.buffer).metadata()).format).toBe('jpeg');
  });

  it('rejects oversized decoded images before contacting AWS', async () => {
    const send = jest.fn();
    const limited = new ConfigService({
      FACE_PROVIDER: 'rekognition',
      AWS_REGION: 'ap-southeast-1',
      REKOGNITION_COLLECTION_PREFIX: 'camerai-s4-dev-owner-',
      FACE_MAX_PIXELS: '100',
    });
    const service = new RekognitionFaceEnrollmentService(limited, {
      send,
    } as unknown as RekognitionClient);
    await expect(service.validateSingleFaces([await image('webp')])).rejects.toMatchObject({
      response: { error: { code: 'INVALID_IMAGE' } },
    });
    expect(send).not.toHaveBeenCalled();
  });
});
