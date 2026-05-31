import { Module } from '@nestjs/common';
import { SlackService } from './slack.service';
import { SlackListenerService } from './slack-listener.service';
import { SlackController } from './slack.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
    imports: [PrismaModule],
    providers: [SlackService, SlackListenerService],
    controllers: [SlackController],
    exports: [SlackService],
})
export class SlackModule {}
