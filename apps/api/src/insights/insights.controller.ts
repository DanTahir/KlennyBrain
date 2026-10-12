import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Request, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FixInsightResponse, InsightAnalysisDto, InsightDto, TokenPayload } from '@app-starter/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { EmailVerifiedGuard } from '../auth/email-verified.guard';
import { InsightsService } from './insights.service';
import { ListInsightsQueryDto, UpdateInsightDto } from './dto/insights.dto';

@ApiTags('insights')
@Controller('organizations/:organizationId')
@UseGuards(JwtAuthGuard, EmailVerifiedGuard)
export class InsightsController {
  constructor(private readonly insightsService: InsightsService) {}

  @Get('insights')
  @ApiOperation({ summary: 'Insights visible to the caller (filtered by evidence ACLs)' })
  list(
    @Request() req: { user: TokenPayload },
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Query() query: ListInsightsQueryDto,
  ): Promise<InsightDto[]> {
    return this.insightsService.list(req.user.sub, organizationId, {
      type: query.type,
      status: query.status,
      viewAsEmail: query.viewAs,
    });
  }

  @Get('insights/analysis')
  @ApiOperation({ summary: 'Status of the latest insight analysis run' })
  getAnalysis(
    @Request() req: { user: TokenPayload },
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
  ): Promise<InsightAnalysisDto> {
    return this.insightsService.getAnalysis(req.user.sub, organizationId);
  }

  @Post('insights/analyze')
  @ApiOperation({ summary: 'Run insight analysis in the background (owner/admin)' })
  analyze(
    @Request() req: { user: TokenPayload },
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
  ): Promise<InsightAnalysisDto> {
    return this.insightsService.startAnalysis(req.user.sub, organizationId);
  }

  @Patch('insights/:insightId')
  @ApiOperation({ summary: 'Resolve, dismiss or reopen an insight (owner/admin)' })
  update(
    @Request() req: { user: TokenPayload },
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('insightId', ParseUUIDPipe) insightId: string,
    @Body() dto: UpdateInsightDto,
  ): Promise<InsightDto> {
    return this.insightsService.update(req.user.sub, organizationId, insightId, dto.status);
  }

  @Post('insights/:insightId/fix')
  @ApiOperation({ summary: 'Agent proposes remediation actions for an insight (requires approval to run)' })
  fix(
    @Request() req: { user: TokenPayload },
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('insightId', ParseUUIDPipe) insightId: string,
  ): Promise<FixInsightResponse> {
    return this.insightsService.fix(req.user.sub, organizationId, insightId);
  }
}
