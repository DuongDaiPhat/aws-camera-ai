import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { MediaModule } from '../media/media.module';
import { MqttConsumerService } from './mqtt-consumer.service';

@Module({
  imports: [EventsModule, MediaModule],
  providers: [MqttConsumerService],
  exports: [MqttConsumerService],
})
export class IngestionModule {}
