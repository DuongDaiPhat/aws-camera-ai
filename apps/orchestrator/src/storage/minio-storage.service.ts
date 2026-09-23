import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { IStorageService, PresignedUrlResult, UploadResult } from './storage.interface';

const DEFAULT_PRESIGNED_URL_TTL_SECONDS = 900;

@Injectable()
export class MinioStorageService implements IStorageService {
  private readonly logger = new Logger(MinioStorageService.name);
  private readonly s3Client: S3Client;
  private readonly presignClient: S3Client;
  private readonly bucket: string;

  constructor(private readonly configService: ConfigService) {
    this.bucket = this.configService.get<string>('STORAGE_BUCKET', 'camerai-media');
    const endpoint = this.configService.get<string>('MINIO_ENDPOINT', 'http://localhost:9000');
    // Trong Docker, orchestrator goi MinIO qua ten service `minio`, nhung trinh duyet cua
    // nguoi dung khong phan giai duoc ten do. Chu ky presigned URL gan chat voi host nen
    // phai ky bang dung endpoint ma trinh duyet se goi (FR-EVT-07, US-06).
    const publicEndpoint = this.configService.get<string>('MINIO_PUBLIC_ENDPOINT') || endpoint;
    const accessKeyId = this.configService.get<string>('MINIO_ROOT_USER', 'minioadmin');
    const secretAccessKey = this.configService.get<string>('MINIO_ROOT_PASSWORD', 'minioadmin123');

    const clientOptions = {
      region: 'us-east-1',
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
      forcePathStyle: true, // Bắt buộc đối với MinIO
    };

    this.s3Client = new S3Client({ ...clientOptions, endpoint });
    this.presignClient =
      publicEndpoint === endpoint
        ? this.s3Client
        : new S3Client({ ...clientOptions, endpoint: publicEndpoint });

    this.logger.log(
      `Khoi tao MinIO Storage Adapter (endpoint: ${endpoint}, presign: ${publicEndpoint}, bucket: ${this.bucket})`,
    );
  }

  async upload(key: string, body: Buffer, contentType: string): Promise<UploadResult> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    });

    await this.s3Client.send(command);

    return {
      bucket: this.bucket,
      key,
      sizeBytes: body.length,
      contentType,
    };
  }

  async getPresignedUrl(
    key: string,
    expiresInSeconds = DEFAULT_PRESIGNED_URL_TTL_SECONDS,
  ): Promise<PresignedUrlResult> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    const url = await getSignedUrl(this.presignClient, command, { expiresIn: expiresInSeconds });
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);

    return {
      url,
      expiresAt,
    };
  }
}
