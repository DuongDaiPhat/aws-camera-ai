import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MediaModule } from '../media/media.module';
import { StorageModule } from '../storage/storage.module';
import { EscalationModule } from '../escalation/escalation.module';
import { EventsRepository } from './events.repository';
import { EventsService } from './events.service';
import { EventsController } from './events.controller';

@Module({
  imports: [AuthModule, MediaModule, StorageModule, EscalationModule],
  controllers: [EventsController],
  providers: [EventsRepository, EventsService],
  exports: [EventsRepository, EventsService],
})
export class EventsModule {}
