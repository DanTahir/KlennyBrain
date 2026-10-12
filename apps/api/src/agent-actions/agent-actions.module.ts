import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AclModule } from '../acl/acl.module';
import { IngestionModule } from '../ingestion/ingestion.module';
import { AgentActionsController } from './agent-actions.controller';
import { AgentActionsService } from './agent-actions.service';
import { GithubExecutor } from './executors/github.executor';
import { SlackExecutor } from './executors/slack.executor';
import { HydraDocExecutor } from './executors/hydra-doc.executor';

@Module({
  imports: [PrismaModule, AclModule, IngestionModule],
  controllers: [AgentActionsController],
  providers: [AgentActionsService, GithubExecutor, SlackExecutor, HydraDocExecutor],
  exports: [AgentActionsService, GithubExecutor, SlackExecutor],
})
export class AgentActionsModule {}
