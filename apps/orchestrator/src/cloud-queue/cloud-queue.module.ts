import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { AiResultsModule } from '../ai-results/ai-results.module';
import { InternalTokenGuard } from '../ai-results/internal-token.guard';
import { CloudQueueService } from './cloud-queue.service';
import { CloudQueueController } from './cloud-queue.controller';
import { NotificationCloudModule } from '../notification-cloud/notification-cloud.module';
@Module({
  imports: [MediaModule, AiResultsModule, NotificationCloudModule],
  providers: [CloudQueueService, InternalTokenGuard],
  controllers: [CloudQueueController],
  exports: [CloudQueueService],
})
export class CloudQueueModule {}
