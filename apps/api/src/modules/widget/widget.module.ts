import { Module } from '@nestjs/common';
import { WidgetService } from './widget.service';
import { WidgetController } from './widget.controller';
import { WidgetPublicController } from './widget-public.controller';
import { WidgetGateway } from './widget.gateway';
import { ConversationsModule } from '../conversations/conversations.module';

@Module({
    imports: [ConversationsModule],
    providers: [WidgetService, WidgetGateway],
    controllers: [WidgetController, WidgetPublicController],
    exports: [WidgetService],
})
export class WidgetModule {}
