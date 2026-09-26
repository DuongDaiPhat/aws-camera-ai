import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { MediaModule } from '../media/media.module';
import { MqttConsumerService } from './mqtt-consumer.service';
import { FrigateModule } from '../frigate/frigate.module';

@Module({
  imports: [EventsModule, MediaModule, FrigateModule],
  providers: [MqttConsumerService],
  exports: [MqttConsumerService],
})
export class IngestionModule {}
