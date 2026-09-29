import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { KnownFacesController } from './known-faces.controller';
import { KnownFacesService } from './known-faces.service';
import { KnownFacesRepository } from './known-faces.repository';
import { KnownFacesGuard } from './known-faces.guard';
import { FaceCollectionSyncService } from './face-collection-sync.service';
import { FACE_INFERENCE } from './face-inference.interface';
import { AiFaceInferenceService } from './ai-face-inference.service';

@Module({
  imports: [
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        limits: {
          fileSize: Number(config.get('FACE_MAX_IMAGE_BYTES', 5242880)),
          files: 5,
          fields: 4,
          fieldSize: 1024,
          parts: 9,
        },
      }),
    }),
  ],
  controllers: [KnownFacesController],
  providers: [
    KnownFacesService,
    KnownFacesRepository,
    KnownFacesGuard,
    FaceCollectionSyncService,
    { provide: FACE_INFERENCE, useClass: AiFaceInferenceService },
  ],
})
export class KnownFacesModule {}
