import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { MediaModule } from '../media/media.module';
import { MqttConsumerService } from './mqtt-consumer.service';
import { FrigateModule } from '../frigate/frigate.module';
import { ZonesModule } from '../zones/zones.module';
import { BullModule } from '@nestjs/bullmq';
import { AiResultsModule } from '../ai-results/ai-results.module';
import { ZoneResultProducerService } from './zone-result-producer.service';

@Module({
  imports: [
    EventsModule,
    MediaModule,
    FrigateModule,
    ZonesModule,
    AiResultsModule,
    BullModule.registerQueue({ name: 'face-recognition' }),
  ],
  providers: [MqttConsumerService, ZoneResultProducerService],
  exports: [MqttConsumerService],
})
export class IngestionModule {}
