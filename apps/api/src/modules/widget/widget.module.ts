import { Module } from '@nestjs/common';
import { WidgetService } from './widget.service';
import { WidgetTriggersService } from './widget-triggers.service';
import { WidgetController } from './widget.controller';
import { WidgetTriggersController } from './widget-triggers.controller';
import { WidgetPublicController } from './widget-public.controller';
import { WidgetGateway } from './widget.gateway';
import { ConversationsModule } from '../conversations/conversations.module';
import { WidgetRateLimitService } from './widget-rate-limit.service';

@Module({
    imports: [ConversationsModule],
    providers: [WidgetService, WidgetTriggersService, WidgetRateLimitService, WidgetGateway],
    controllers: [WidgetController, WidgetTriggersController, WidgetPublicController],
    exports: [WidgetService, WidgetTriggersService],
})
export class WidgetModule {}
