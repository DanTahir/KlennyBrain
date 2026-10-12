import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { HydraModule } from '../hydra/hydra.module';
import { DemoAdapter } from './adapters/demo.adapter';
import { IngestionService } from './ingestion.service';
import { JobRunnerService } from './job-runner.service';

@Module({
  imports: [PrismaModule, HydraModule],
  providers: [JobRunnerService, DemoAdapter, IngestionService],
  exports: [JobRunnerService, IngestionService],
})
export class IngestionModule {}
