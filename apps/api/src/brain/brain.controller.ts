import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Request, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { BrainSpaceDto, PersonaDto, SourceDto, SyncJobDto, TokenPayload } from '@app-starter/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { EmailVerifiedGuard } from '../auth/email-verified.guard';
import { BrainService } from './brain.service';
import { CreateSourceDto } from './dto/create-source.dto';

@ApiTags('brain')
@Controller('organizations/:organizationId')
@UseGuards(JwtAuthGuard, EmailVerifiedGuard)
export class BrainController {
  constructor(private readonly brainService: BrainService) {}

  @Get('brain')
  @ApiOperation({ summary: 'Brain status, integration readiness and stats' })
  getBrain(
    @Request() req: { user: TokenPayload },
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
  ): Promise<BrainSpaceDto> {
    return this.brainService.getBrain(req.user.sub, organizationId);
  }

  @Post('brain/provision')
  @ApiOperation({ summary: 'Create the HydraDB database for this organization (owner/admin)' })
  provision(
    @Request() req: { user: TokenPayload },
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
  ): Promise<BrainSpaceDto> {
    return this.brainService.provision(req.user.sub, organizationId);
  }

  @Post('brain/demo')
  @ApiOperation({ summary: 'Load the Northwind demo dataset into the brain (owner/admin)' })
  loadDemo(
    @Request() req: { user: TokenPayload },
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
  ): Promise<{ source: SourceDto; job: SyncJobDto }> {
    return this.brainService.loadDemo(req.user.sub, organizationId);
  }

  @Get('sources')
  listSources(
    @Request() req: { user: TokenPayload },
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
  ): Promise<SourceDto[]> {
    return this.brainService.listSources(req.user.sub, organizationId);
  }

  @Post('sources')
  createSource(
    @Request() req: { user: TokenPayload },
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Body() dto: CreateSourceDto,
  ): Promise<SourceDto> {
    return this.brainService.createSource(req.user.sub, organizationId, dto);
  }

  @Post('sources/:sourceId/sync')
  syncSource(
    @Request() req: { user: TokenPayload },
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('sourceId', ParseUUIDPipe) sourceId: string,
  ): Promise<SyncJobDto> {
    return this.brainService.syncSource(req.user.sub, organizationId, sourceId);
  }

  @Post('sources/:sourceId/refresh-mirror')
  refreshMirror(
    @Request() req: { user: TokenPayload },
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('sourceId', ParseUUIDPipe) sourceId: string,
  ): Promise<{ items: number }> {
    return this.brainService.refreshMirror(req.user.sub, organizationId, sourceId);
  }

  @Get('sources/:sourceId/jobs')
  listJobs(
    @Request() req: { user: TokenPayload },
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('sourceId', ParseUUIDPipe) sourceId: string,
  ): Promise<SyncJobDto[]> {
    return this.brainService.listJobs(req.user.sub, organizationId, sourceId);
  }

  @Get('personas')
  @ApiOperation({ summary: 'Directory people for the admin "view as" picker' })
  listPersonas(
    @Request() req: { user: TokenPayload },
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
  ): Promise<PersonaDto[]> {
    return this.brainService.listPersonas(req.user.sub, organizationId);
  }
}
