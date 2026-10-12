import { Body, Controller, Get, Logger, Param, ParseUUIDPipe, Post, Request, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { AskResponse, AskStreamEvent, ChatMessageDto, ConversationDto, TokenPayload } from '@app-starter/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { EmailVerifiedGuard } from '../auth/email-verified.guard';
import { AclService } from '../acl/acl.service';
import { AskService } from './ask.service';
import { AskDto, FeedbackDto } from './dto/ask.dto';

const HEARTBEAT_MS = 15_000;

@ApiTags('ask')
@Controller('organizations/:organizationId')
@UseGuards(JwtAuthGuard, EmailVerifiedGuard)
export class AskController {
  private readonly logger = new Logger(AskController.name);

  constructor(
    private readonly askService: AskService,
    private readonly acl: AclService,
  ) {}

  @Post('ask')
  @ApiOperation({ summary: 'Ask the brain (JSON response)' })
  async ask(
    @Request() req: { user: TokenPayload },
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Body() dto: AskDto,
  ): Promise<AskResponse> {
    const identity = await this.acl.resolveIdentity(req.user.sub, organizationId, dto.viewAsEmail);
    return this.askService.ask(identity, dto);
  }

  @Post('ask/stream')
  @ApiOperation({ summary: 'Ask the brain (Server-Sent Events: status, tool_call, sources, graph, token, done)' })
  async askStream(
    @Request() req: { user: TokenPayload },
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Body() dto: AskDto,
    @Res() res: Response,
  ): Promise<void> {
    // Resolve permissions before opening the stream so auth errors are plain HTTP errors.
    const identity = await this.acl.resolveIdentity(req.user.sub, organizationId, dto.viewAsEmail);

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const abort = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) abort.abort();
    });
    const send = (event: AskStreamEvent) => {
      if (res.writableEnded || abort.signal.aborted) return;
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    };
    const heartbeat = setInterval(() => send({ type: 'heartbeat' }), HEARTBEAT_MS);

    try {
      await this.askService.run(identity, dto, send, abort.signal);
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (!abort.signal.aborted) this.logger.warn(`ask stream failed: ${(error as Error).message}`);
      send({
        type: 'error',
        message: (error as Error).message || 'The brain could not answer that.',
        retryable: !status || status >= 500,
      });
    } finally {
      clearInterval(heartbeat);
      if (!res.writableEnded) res.end();
    }
  }

  @Get('conversations')
  listConversations(
    @Request() req: { user: TokenPayload },
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
  ): Promise<ConversationDto[]> {
    return this.askService.listConversations(req.user.sub, organizationId);
  }

  @Get('conversations/:conversationId')
  getConversation(
    @Request() req: { user: TokenPayload },
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
  ): Promise<ConversationDto> {
    return this.askService.getConversation(req.user.sub, organizationId, conversationId);
  }

  @Post('messages/:messageId/feedback')
  @ApiOperation({ summary: 'Thumbs up/down on an answer (forwarded to HydraDB feedback)' })
  submitFeedback(
    @Request() req: { user: TokenPayload },
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Body() dto: FeedbackDto,
  ): Promise<ChatMessageDto> {
    return this.askService.submitFeedback(req.user.sub, organizationId, messageId, dto);
  }
}
