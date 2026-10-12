import { Controller, Get, Param, ParseUUIDPipe, Post, Query, Request, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AgentActionDto, TokenPayload } from '@app-starter/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { EmailVerifiedGuard } from '../auth/email-verified.guard';
import { AgentActionsService } from './agent-actions.service';
import { ListActionsQueryDto } from './dto/agent-actions.dto';

@ApiTags('agent-actions')
@Controller('organizations/:organizationId')
@UseGuards(JwtAuthGuard, EmailVerifiedGuard)
export class AgentActionsController {
  constructor(private readonly actionsService: AgentActionsService) {}

  @Get('actions')
  @ApiOperation({ summary: 'Agent action log (proposed, executed, failed, rejected)' })
  list(
    @Request() req: { user: TokenPayload },
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Query() query: ListActionsQueryDto,
  ): Promise<AgentActionDto[]> {
    return this.actionsService.list(req.user.sub, organizationId, query.status);
  }

  @Post('actions/:actionId/approve')
  @ApiOperation({ summary: 'Approve and execute a proposed action (owner/admin)' })
  approve(
    @Request() req: { user: TokenPayload },
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('actionId', ParseUUIDPipe) actionId: string,
  ): Promise<AgentActionDto> {
    return this.actionsService.approve(req.user.sub, organizationId, actionId);
  }

  @Post('actions/:actionId/reject')
  @ApiOperation({ summary: 'Reject a proposed action (owner/admin)' })
  reject(
    @Request() req: { user: TokenPayload },
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('actionId', ParseUUIDPipe) actionId: string,
  ): Promise<AgentActionDto> {
    return this.actionsService.reject(req.user.sub, organizationId, actionId);
  }
}
