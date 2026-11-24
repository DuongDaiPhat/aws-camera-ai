import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { NotificationCloudController } from './notification-cloud.controller';
import { NotificationCloudService } from './notification-cloud.service';
import { NotificationSettingsController } from './notification-settings.controller';
import { EmailNotificationSettingsService } from './email-notification-settings.service';
import { PhoneNotificationSettingsService } from './phone-notification-settings.service';
import { NotificationRegistrationProvider } from './notification-registration.provider';

@Module({
  imports: [DatabaseModule],
  controllers: [NotificationCloudController, NotificationSettingsController],
  providers: [
    NotificationCloudService,
    EmailNotificationSettingsService,
    PhoneNotificationSettingsService,
    NotificationRegistrationProvider,
  ],
  exports: [NotificationCloudService],
})
export class NotificationCloudModule {}
