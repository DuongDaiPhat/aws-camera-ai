import { ConfigService } from '@nestjs/config';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { MinioStorageService } from '../src/storage/minio-storage.service';
import { S3StorageService, buildS3Tagging } from '../src/storage/s3-storage.service';
import { S3_EXPIRE_7D_TAG } from '../src/storage/storage.interface';

describe('S3StorageService tagging (US-23)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('builds retention=expire-7d tagging for eligible uploads and excludes it when retain=true', () => {
    expect(buildS3Tagging()).toBeUndefined();
    expect(buildS3Tagging({ tags: S3_EXPIRE_7D_TAG })).toBe('retention=expire-7d');
    expect(buildS3Tagging({ retain: false })).toBe('retention=expire-7d');
    expect(buildS3Tagging({ retain: true })).toBe('retain=true');
    expect(buildS3Tagging({ retain: true, tags: { retention: 'expire-7d', source: 'fire' } })).toBe(
      'source=fire&retain=true',
    );
    expect(buildS3Tagging({ tags: { retain: 'true', retention: 'expire-7d' } })).toBe(
      'retain=true',
    );
  });

  it('passes Tagging=retention=expire-7d on PutObjectCommand for eligible S3 uploads', async () => {
    const sendSpy = jest.spyOn(S3Client.prototype, 'send').mockResolvedValue({} as never);
    const service = new S3StorageService(
      new ConfigService({ AWS_REGION: 'ap-southeast-1', S3_BUCKET: 'argusai-staging-media' }),
    );

    const result = await service.upload(
      'events/2026/11/20/evt-1/snapshot.jpg',
      Buffer.from('jpeg-data'),
      'image/jpeg',
      { tags: S3_EXPIRE_7D_TAG },
    );

    expect(result).toEqual({
      bucket: 'argusai-staging-media',
      key: 'events/2026/11/20/evt-1/snapshot.jpg',
      sizeBytes: 9,
      contentType: 'image/jpeg',
    });
    expect(sendSpy).toHaveBeenCalledTimes(1);
    const command = sendSpy.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect((command as PutObjectCommand).input).toMatchObject({
      Bucket: 'argusai-staging-media',
      Key: 'events/2026/11/20/evt-1/snapshot.jpg',
      ContentType: 'image/jpeg',
      Tagging: 'retention=expire-7d',
    });
  });

  it('passes Tagging=retain=true and omits retention=expire-7d when retain is true', async () => {
    const sendSpy = jest.spyOn(S3Client.prototype, 'send').mockResolvedValue({} as never);
    const service = new S3StorageService(
      new ConfigService({ AWS_REGION: 'ap-southeast-1', S3_BUCKET: 'argusai-staging-media' }),
    );

    await service.upload('events/2026/11/20/evt-2/clip.mp4', Buffer.from('mp4'), 'video/mp4', {
      retain: true,
    });

    const command = sendSpy.mock.calls[0]?.[0] as PutObjectCommand;
    expect(command.input.Tagging).toBe('retain=true');
    expect(command.input.Tagging).not.toContain('expire-7d');
  });

  it('omits Tagging on PutObjectCommand when no options are provided', async () => {
    const sendSpy = jest.spyOn(S3Client.prototype, 'send').mockResolvedValue({} as never);
    const service = new S3StorageService(
      new ConfigService({ AWS_REGION: 'ap-southeast-1', S3_BUCKET: 'argusai-staging-media' }),
    );

    await service.upload('plain/key.bin', Buffer.from('bin'), 'application/octet-stream');

    const command = sendSpy.mock.calls[0]?.[0] as PutObjectCommand;
    expect(command.input.Tagging).toBeUndefined();
  });

  it('keeps MinioStorageService compatible when upload options are passed', async () => {
    const sendSpy = jest.spyOn(S3Client.prototype, 'send').mockResolvedValue({} as never);
    const service = new MinioStorageService(
      new ConfigService({
        STORAGE_BUCKET: 'camerai-media',
        MINIO_ENDPOINT: 'http://localhost:9000',
      }),
    );

    const result = await service.upload(
      'events/2026/11/20/evt-3/snapshot.jpg',
      Buffer.from('img'),
      'image/jpeg',
      { tags: S3_EXPIRE_7D_TAG },
    );

    expect(result.bucket).toBe('camerai-media');
    const command = sendSpy.mock.calls[0]?.[0] as PutObjectCommand;
    expect(command.input.Tagging).toBeUndefined();
  });
});
