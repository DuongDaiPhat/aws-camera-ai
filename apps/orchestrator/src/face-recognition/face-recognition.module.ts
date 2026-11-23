import { ConfigService } from '@nestjs/config';
import { FrigateMediaAdapter } from '../media/frigate-media.adapter';
import { AiResultsService } from '../ai-results/ai-results.service';
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { FaceRecognitionWorker } from './face-recognition.worker';
import { MediaModule } from '../media/media.module';
import { AiResultsModule } from '../ai-results/ai-results.module';
import { EventsModule } from '../events/events.module';
import { FrigateModule } from '../frigate/frigate.module';
import { CloudQueueModule } from '../cloud-queue/cloud-queue.module';
import { FaceQualityGateClient } from './face-quality-gate.client';
import { FaceSessionCacheService } from './face-session-cache.service';
import { TrackIdentityStateService } from './track-identity-state.service';
import { FaceRecognitionCoordinatorService } from './face-recognition-coordinator.service';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'face-recognition',
    }),
    MediaModule,
    AiResultsModule,
    EventsModule,
    FrigateModule,
    CloudQueueModule,
  ],
  providers: [
    FaceQualityGateClient,
    FaceSessionCacheService,
    TrackIdentityStateService,
    FaceRecognitionCoordinatorService,
    {
      provide: FaceRecognitionWorker,
      inject: [
        ConfigService,
        FrigateMediaAdapter,
        AiResultsService,
        FaceRecognitionCoordinatorService,
      ],
      useFactory: (
        config: ConfigService,
        media: FrigateMediaAdapter,
        ai: AiResultsService,
        coordinator: FaceRecognitionCoordinatorService,
      ) =>
        config.get<string>('FACE_JOB_TRANSPORT', 'bullmq') === 'bullmq'
          ? new FaceRecognitionWorker(media, config, ai, coordinator)
          : null,
    },
  ],
  exports: [
    BullModule,
    FaceQualityGateClient,
    FaceSessionCacheService,
    TrackIdentityStateService,
    FaceRecognitionCoordinatorService,
  ],
})
export class FaceRecognitionModule {}
