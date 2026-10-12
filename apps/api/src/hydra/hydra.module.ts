import { Module } from '@nestjs/common';
import { HydraService } from './hydra.service';

@Module({
  providers: [HydraService],
  exports: [HydraService],
})
export class HydraModule {}
