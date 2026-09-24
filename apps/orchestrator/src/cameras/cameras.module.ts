import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { CamerasController } from './cameras.controller';
import { CamerasRepository } from './cameras.repository';
import { CamerasService } from './cameras.service';
import { CAMERA_CONFIG_PORT_V1 } from '../contracts/vertical-slice.ports';

@Module({
  imports: [StorageModule],
  controllers: [CamerasController],
  providers: [
    CamerasRepository,
    CamerasService,
    {
      provide: CAMERA_CONFIG_PORT_V1,
      useExisting: CamerasService,
    },
  ],
  exports: [CamerasService, CamerasRepository, CAMERA_CONFIG_PORT_V1],
})
export class CamerasModule {}
