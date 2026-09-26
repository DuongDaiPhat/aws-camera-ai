import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { EscalationModule } from '../escalation/escalation.module';
import { AiResultOutboxService } from './ai-result-outbox.service';
import { AiResultValidator } from './ai-result.validator';
import { AiResultsController } from './ai-results.controller';
import { AiResultsRepository } from './ai-results.repository';
import { AiResultsService } from './ai-results.service';
import { InternalTokenGuard } from './internal-token.guard';

@Module({
  imports: [EventsModule, EscalationModule],
  controllers: [AiResultsController],
  providers: [
    AiResultValidator,
    AiResultsRepository,
    AiResultsService,
    AiResultOutboxService,
    InternalTokenGuard,
  ],
  exports: [AiResultsService],
})
export class AiResultsModule {}
