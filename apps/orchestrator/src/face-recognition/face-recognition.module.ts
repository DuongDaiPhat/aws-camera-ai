import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { FaceRecognitionWorker } from './face-recognition.worker';
import { MediaModule } from '../media/media.module';
import { EventsModule } from '../events/events.module';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'face-recognition',
    }),
    MediaModule,
    EventsModule,
  ],
  providers: [FaceRecognitionWorker],
  exports: [BullModule],
})
export class FaceRecognitionModule {}
