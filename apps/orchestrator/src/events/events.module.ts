import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StorageModule } from '../storage/storage.module';
import { EventsRepository } from './events.repository';
import { EventsService } from './events.service';
import { EventsController } from './events.controller';

@Module({
  imports: [AuthModule, StorageModule],
  controllers: [EventsController],
  providers: [EventsRepository, EventsService],
  exports: [EventsRepository, EventsService],
})
export class EventsModule {}
