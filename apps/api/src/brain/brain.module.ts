import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AclModule } from '../acl/acl.module';
import { HydraModule } from '../hydra/hydra.module';
import { LlmModule } from '../llm/llm.module';
import { IngestionModule } from '../ingestion/ingestion.module';
import { BrainController } from './brain.controller';
import { BrainService } from './brain.service';

@Module({
  imports: [PrismaModule, AclModule, HydraModule, LlmModule, IngestionModule],
  controllers: [BrainController],
  providers: [BrainService],
  exports: [BrainService],
})
export class BrainModule {}
