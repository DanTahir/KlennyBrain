import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class AskDto {
  @ApiProperty({ example: 'What is blocking the Atlas launch?' })
  @IsString()
  @MinLength(2)
  @MaxLength(2000)
  question!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  conversationId?: string;

  @ApiPropertyOptional({ description: 'OWNER/ADMIN only: answer with this person\'s permissions' })
  @IsOptional()
  @IsEmail()
  viewAsEmail?: string;
}

export class FeedbackDto {
  @ApiProperty({ enum: [1, -1] })
  @IsInt()
  @IsIn([1, -1])
  rating!: 1 | -1;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}
