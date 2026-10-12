import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsIn, IsOptional } from 'class-validator';

const INSIGHT_TYPES = ['CONTRADICTION', 'STALE_DOC', 'DECISION', 'ACTION_ITEM'] as const;
const INSIGHT_STATUSES = ['OPEN', 'RESOLVED', 'DISMISSED'] as const;

export class ListInsightsQueryDto {
  @ApiPropertyOptional({ enum: INSIGHT_TYPES })
  @IsOptional()
  @IsIn([...INSIGHT_TYPES])
  type?: (typeof INSIGHT_TYPES)[number];

  @ApiPropertyOptional({ enum: INSIGHT_STATUSES })
  @IsOptional()
  @IsIn([...INSIGHT_STATUSES])
  status?: (typeof INSIGHT_STATUSES)[number];

  @ApiPropertyOptional({ description: 'OWNER/ADMIN only: list insights as this person would see them' })
  @IsOptional()
  @IsEmail()
  viewAs?: string;
}

export class UpdateInsightDto {
  @ApiProperty({ enum: INSIGHT_STATUSES })
  @IsIn([...INSIGHT_STATUSES])
  status!: (typeof INSIGHT_STATUSES)[number];
}
