import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { EventMediaRepository } from './event-media.repository';
import { MediaService } from './media.service';
import { MediaController } from './media.controller';

@Module({
  imports: [StorageModule],
  controllers: [MediaController],
  providers: [EventMediaRepository, MediaService],
  exports: [MediaService, EventMediaRepository],
})
export class MediaModule {}
