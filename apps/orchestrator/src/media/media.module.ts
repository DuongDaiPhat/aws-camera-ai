import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { EventMediaRepository } from './event-media.repository';
import { MediaService } from './media.service';
import { MediaController } from './media.controller';
import { FrigateMediaAdapter } from './frigate-media.adapter';

@Module({
  imports: [StorageModule],
  controllers: [MediaController],
  providers: [EventMediaRepository, MediaService, FrigateMediaAdapter],
  exports: [MediaService, EventMediaRepository, FrigateMediaAdapter],
})
export class MediaModule {}
