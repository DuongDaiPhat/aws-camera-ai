import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { MqttConsumerService } from './mqtt-consumer.service';

@Module({
  imports: [EventsModule],
  providers: [MqttConsumerService],
  exports: [MqttConsumerService],
})
export class IngestionModule {}
