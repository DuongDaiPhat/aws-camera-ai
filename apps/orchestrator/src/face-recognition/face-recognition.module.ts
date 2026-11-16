import { ConfigService } from '@nestjs/config';
import { FrigateMediaAdapter } from '../media/frigate-media.adapter';
import { AiResultsService } from '../ai-results/ai-results.service';
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { FaceRecognitionWorker } from './face-recognition.worker';
import { MediaModule } from '../media/media.module';
import { AiResultsModule } from '../ai-results/ai-results.module';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'face-recognition',
    }),
    MediaModule,
    AiResultsModule,
  ],
  providers: [
    {
      provide: FaceRecognitionWorker,
      inject: [ConfigService, FrigateMediaAdapter, AiResultsService],
      useFactory: (config: ConfigService, media: FrigateMediaAdapter, ai: AiResultsService) =>
        config.get<string>('FACE_JOB_TRANSPORT', 'bullmq') === 'bullmq'
          ? new FaceRecognitionWorker(media, config, ai)
          : null,
    },
  ],
  exports: [BullModule],
})
export class FaceRecognitionModule {}
