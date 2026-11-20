import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  IStorageService,
  PresignedUrlResult,
  UploadOptions,
  UploadResult,
} from './storage.interface';

export function buildS3Tagging(options?: UploadOptions): string | undefined {
  if (!options) return undefined;
  const tags: Record<string, string> = { ...(options.tags ?? {}) };
  if (options.retain === true || tags.retain === 'true') {
    if (tags.retention === 'expire-7d') {
      delete tags.retention;
    }
    tags.retain = 'true';
  } else if (options.retain === false && Object.keys(tags).length === 0) {
    tags.retention = 'expire-7d';
  }
  const entries = Object.entries(tags).filter(
    ([key, value]) => key.trim().length > 0 && value.trim().length > 0,
  );
  if (entries.length === 0) return undefined;
  const params = new URLSearchParams();
  for (const [key, value] of entries) {
    params.set(key, value);
  }
  return params.toString();
}

@Injectable()
export class S3StorageService implements IStorageService {
  private readonly logger = new Logger(S3StorageService.name);
  private readonly s3Client: S3Client;
  private readonly bucket: string;

  constructor(private readonly configService: ConfigService) {
    this.bucket = this.configService.get<string>('S3_BUCKET', 'camerai-media-prod');
    const region = this.configService.get<string>('AWS_REGION', 'ap-southeast-1');
    // Default AWS credential chain supports instance roles and temporary session tokens.
    this.s3Client = new S3Client({ region });

    this.logger.log(`Khoi tao AWS S3 Storage Adapter (region: ${region}, bucket: ${this.bucket})`);
  }

  async upload(
    key: string,
    body: Buffer,
    contentType: string,
    options?: UploadOptions,
  ): Promise<UploadResult> {
    const tagging = buildS3Tagging(options);
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      ...(tagging ? { Tagging: tagging } : {}),
    });

    await this.s3Client.send(command);

    return {
      bucket: this.bucket,
      key,
      sizeBytes: body.length,
      contentType,
    };
  }

  async download(key: string): Promise<Buffer> {
    const response = await this.s3Client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    if (!response.Body) throw new Error('Snapshot không có dữ liệu.');
    return Buffer.from(await response.Body.transformToByteArray());
  }

  async getPresignedUrl(key: string, expiresInSeconds = 900): Promise<PresignedUrlResult> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    const url = await getSignedUrl(this.s3Client, command, { expiresIn: expiresInSeconds });
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);

    return {
      url,
      expiresAt,
    };
  }

  async delete(key: string): Promise<void> {
    await this.s3Client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
