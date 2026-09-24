import { Module } from '@nestjs/common';
import { KnownFacesModule } from './known-faces/known-faces.module';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { CameraSourcesModule } from './camera-sources/camera-sources.module';
import { CamerasModule } from './cameras/cameras.module';
import { AiResultsModule } from './ai-results/ai-results.module';
import { DatabaseModule } from './database/database.module';
import { EventsModule } from './events/events.module';
import { FrigateModule } from './frigate/frigate.module';
import { HealthModule } from './health/health.module';
import { IngestionModule } from './ingestion/ingestion.module';
import { MediaModule } from './media/media.module';
import { StorageModule } from './storage/storage.module';
import { EscalationRulesModule } from './escalation-rules/escalation-rules.module';
import { EscalationModule } from './escalation/escalation.module';

/**
 * Module goc.
 *
 * Sprint 0 chi co HealthModule de `docker compose up` chay xanh.
 * Cac module ke tiep duoc them theo user story:
 *   Sprint 1: IngestionModule (US-03), MediaModule (US-04), AuthModule (US-05), EventsModule (US-06)
 *   Sprint 2: CamerasModule (CAM), FacesModule (US-09), ZonesModule (US-12), EscalationModule (US-13), NotificationsModule (US-14)
 *   Sprint 3: WellnessModule (US-20)
 * Xem docs/architecture/C4_ARCHITECTURE.md muc "C3 - Component".
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env', '../../.env'] }),
    DatabaseModule,
    AuthModule,
    KnownFacesModule,
    AiResultsModule,
    StorageModule,
    CameraSourcesModule,
    FrigateModule,
    CamerasModule,
    EventsModule,
    MediaModule,
    IngestionModule,
    HealthModule,
    EscalationRulesModule,
    EscalationModule,
  ],
})
export class AppModule {}
