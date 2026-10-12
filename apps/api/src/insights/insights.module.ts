import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AclModule } from '../acl/acl.module';
import { HydraModule } from '../hydra/hydra.module';
import { LlmModule } from '../llm/llm.module';
import { IngestionModule } from '../ingestion/ingestion.module';
import { AgentActionsModule } from '../agent-actions/agent-actions.module';
import { InsightsController } from './insights.controller';
import { InsightsService } from './insights.service';

@Module({
  imports: [PrismaModule, AclModule, HydraModule, LlmModule, IngestionModule, AgentActionsModule],
  controllers: [InsightsController],
  providers: [InsightsService],
  exports: [InsightsService],
})
export class InsightsModule {}
