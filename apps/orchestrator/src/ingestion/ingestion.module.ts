import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { MediaModule } from '../media/media.module';
import { MqttConsumerService } from './mqtt-consumer.service';
import { FrigateModule } from '../frigate/frigate.module';
import { ZonesModule } from '../zones/zones.module';
import { BullModule } from '@nestjs/bullmq';

@Module({
  imports: [EventsModule, MediaModule, FrigateModule, ZonesModule, BullModule.registerQueue({ name: 'face-recognition' })],
  providers: [MqttConsumerService],
  exports: [MqttConsumerService],
})
export class IngestionModule {}
