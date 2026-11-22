import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { KnownFacesController } from './known-faces.controller';
import { KnownFacesService } from './known-faces.service';
import { KnownFacesRepository } from './known-faces.repository';
import { KnownFacesGuard } from './known-faces.guard';
import { FaceCollectionSyncService } from './face-collection-sync.service';
import { FACE_INFERENCE, type IFaceInference } from './face-inference.interface';
import { AiFaceInferenceService } from './ai-face-inference.service';
import { readFaceConfig, readPositiveFaceNumber } from './face-config';
import {
  FACE_ENROLLMENT,
  RekognitionFaceEnrollmentService,
  type IRekognitionFaceEnrollment,
} from './rekognition-face-enrollment.service';

function disabledLocalInference(): IFaceInference {
  const reject = async (): Promise<never> => {
    throw new Error('Local AI face inference is disabled when FACE_PROVIDER=rekognition');
  };
  return {
    embed: reject,
    sync: reject,
  };
}

@Module({
  imports: [
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        limits: {
          fileSize: readPositiveFaceNumber(config, 'FACE_MAX_IMAGE_BYTES', 5242880),
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
    AiFaceInferenceService,
    {
      provide: FACE_INFERENCE,
      inject: [ConfigService, AiFaceInferenceService],
      useFactory: (
        config: ConfigService,
        localInference: AiFaceInferenceService,
      ): IFaceInference =>
        readFaceConfig(config).provider === 'local' ? localInference : disabledLocalInference(),
    },
    {
      provide: FACE_ENROLLMENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): IRekognitionFaceEnrollment | undefined =>
        readFaceConfig(config).provider === 'rekognition'
          ? new RekognitionFaceEnrollmentService(config)
          : undefined,
    },
  ],
})
export class KnownFacesModule {}
