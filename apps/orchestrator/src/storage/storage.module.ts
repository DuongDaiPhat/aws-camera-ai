import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MinioStorageService } from './minio-storage.service';
import { S3StorageService } from './s3-storage.service';
import { IStorageService, STORAGE_SERVICE } from './storage.interface';

@Global()
@Module({
  providers: [
    MinioStorageService,
    S3StorageService,
    {
      provide: STORAGE_SERVICE,
      inject: [ConfigService, MinioStorageService, S3StorageService],
      useFactory: (
        configService: ConfigService,
        minioStorage: MinioStorageService,
        s3Storage: S3StorageService,
      ): IStorageService => {
        const provider = configService.get<string>('STORAGE_PROVIDER', 'minio').toLowerCase();
        return provider === 's3' ? s3Storage : minioStorage;
      },
    },
  ],
  exports: [STORAGE_SERVICE],
})
export class StorageModule {}
