import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AclModule } from '../acl/acl.module';
import { AskModule } from '../ask/ask.module';
import { SlackBotService } from './slack-bot.service';

@Module({
  imports: [PrismaModule, AclModule, AskModule],
  providers: [SlackBotService],
})
export class SlackBotModule {}
