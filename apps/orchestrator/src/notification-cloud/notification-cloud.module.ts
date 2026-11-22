import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { NotificationCloudController } from './notification-cloud.controller';
import { NotificationCloudService } from './notification-cloud.service';

@Module({
  imports: [DatabaseModule],
  controllers: [NotificationCloudController],
  providers: [NotificationCloudService],
  exports: [NotificationCloudService],
})
export class NotificationCloudModule {}
