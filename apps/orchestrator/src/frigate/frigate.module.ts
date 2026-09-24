import { Module } from '@nestjs/common';
import { CamerasRepository } from '../cameras/cameras.repository';
import { FrigateClientService } from './frigate-client.service';
import { FrigateConfigService } from './frigate-config.service';
import { FrigateSyncService } from './frigate-sync.service';

@Module({
  providers: [
    CamerasRepository,
    FrigateClientService,
    FrigateConfigService,
    FrigateSyncService,
  ],
  exports: [FrigateClientService, FrigateConfigService, FrigateSyncService],
})
export class FrigateModule {}
