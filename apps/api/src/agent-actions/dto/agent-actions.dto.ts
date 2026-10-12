import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

const ACTION_STATUSES = ['PROPOSED', 'APPROVED', 'EXECUTED', 'FAILED', 'REJECTED'] as const;

export class ListActionsQueryDto {
  @ApiPropertyOptional({ enum: ACTION_STATUSES })
  @IsOptional()
  @IsIn([...ACTION_STATUSES])
  status?: (typeof ACTION_STATUSES)[number];
}
