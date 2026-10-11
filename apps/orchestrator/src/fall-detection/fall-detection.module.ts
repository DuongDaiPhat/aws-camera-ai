import { Module } from '@nestjs/common';
import { AiResultsModule } from '../ai-results/ai-results.module';
import { CamerasModule } from '../cameras/cameras.module';
import { ZonesModule } from '../zones/zones.module';
import { PoseInferenceAdapter } from './adapter/pose-inference.adapter';
import { PoseFrameConsumer } from './consumer/pose-frame.consumer';
import { FallIncidentCoordinator } from './coordinator/fall-incident.coordinator';
import { RestAreaEvaluator } from './evaluator/rest-area.evaluator';
import { FallIncidentRepository } from './repository/fall-incident.repository';

@Module({
  imports: [CamerasModule, ZonesModule, AiResultsModule],
  providers: [
    PoseInferenceAdapter,
    RestAreaEvaluator,
    FallIncidentRepository,
    FallIncidentCoordinator,
    PoseFrameConsumer,
  ],
  exports: [
    PoseFrameConsumer,
    FallIncidentCoordinator,
    RestAreaEvaluator,
    FallIncidentRepository,
    PoseInferenceAdapter,
  ],
})
export class FallDetectionModule {}
