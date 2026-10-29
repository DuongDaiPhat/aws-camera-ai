import { Module } from '@nestjs/common';
import { AiResultsModule } from '../ai-results/ai-results.module';
import { MediaModule } from '../media/media.module';
import { EventsModule } from '../events/events.module';
import { StorageModule } from '../storage/storage.module';
import { FireMediaService } from './fire-media.service';
import { FireAiClient } from './fire-ai.client';
import { FireConfig } from './fire.config';
import { FireDeliveryService } from './fire-delivery.service';
import { FireFramesConsumer } from './fire-frames.consumer';
import { FireIncidentsRepository } from './fire-incidents.repository';
import { FireProcessorService } from './fire-processor.service';
import { FireHealthController } from './fire-health.controller';
import { FireHealthService } from './fire-health.service';
import { FireTelemetry } from './fire-telemetry.service';
import { InternalTokenGuard } from '../ai-results/internal-token.guard';

@Module({
  imports: [AiResultsModule, MediaModule, StorageModule, EventsModule],
  controllers: [FireHealthController],
  providers: [
    InternalTokenGuard,
    FireTelemetry,
    FireHealthService,
    FireConfig,
    FireAiClient,
    FireIncidentsRepository,
    FireProcessorService,
    FireFramesConsumer,
    FireDeliveryService,
    FireMediaService,
  ],
})
export class FireModule {}
