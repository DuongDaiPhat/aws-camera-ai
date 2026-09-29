import { Module } from '@nestjs/common';
import { FrigateModule } from '../frigate/frigate.module';
import { FrigateConfigSyncWorker } from './frigate-config-sync.worker';
import { ZoneScheduleService } from './zone-schedule.service';
import { ZonesController } from './zones.controller';
import { ZonesRepository } from './zones.repository';
import { ZonesService } from './zones.service';

@Module({
  imports: [FrigateModule],
  controllers: [ZonesController],
  providers: [ZonesRepository, ZonesService, ZoneScheduleService, FrigateConfigSyncWorker],
  exports: [ZonesRepository, ZoneScheduleService, FrigateConfigSyncWorker],
})
export class ZonesModule {}
