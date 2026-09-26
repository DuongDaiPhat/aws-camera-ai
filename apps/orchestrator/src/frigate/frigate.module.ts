import { Module } from '@nestjs/common';
import { CamerasRepository } from '../cameras/cameras.repository';
import { FrigateClientService } from './frigate-client.service';
import { FrigateConfigService } from './frigate-config.service';
import { FrigateSyncService } from './frigate-sync.service';
import { FrigateDetectionTrackerService } from './frigate-detection-tracker.service';

@Module({
  providers: [
    CamerasRepository,
    FrigateClientService,
    FrigateConfigService,
    FrigateSyncService,
    FrigateDetectionTrackerService,
  ],
  exports: [
    FrigateClientService,
    FrigateConfigService,
    FrigateSyncService,
    FrigateDetectionTrackerService,
  ],
})
export class FrigateModule {}
