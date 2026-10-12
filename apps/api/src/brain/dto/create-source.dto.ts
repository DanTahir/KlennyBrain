import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateSourceDto {
  @ApiProperty({ enum: ['DEMO', 'SLACK'] })
  @IsIn(['DEMO', 'SLACK'])
  type!: 'DEMO' | 'SLACK';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;
}
