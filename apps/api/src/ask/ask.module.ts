import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AclModule } from '../acl/acl.module';
import { HydraModule } from '../hydra/hydra.module';
import { LlmModule } from '../llm/llm.module';
import { AskController } from './ask.controller';
import { AskService } from './ask.service';

@Module({
  imports: [PrismaModule, AclModule, HydraModule, LlmModule],
  controllers: [AskController],
  providers: [AskService],
  exports: [AskService],
})
export class AskModule {}
