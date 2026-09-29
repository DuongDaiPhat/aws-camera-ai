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
  providers: [FaceRecognitionWorker],
  exports: [BullModule],
})
export class FaceRecognitionModule {}
