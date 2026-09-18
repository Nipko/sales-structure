import { WidgetDeliveryModule } from './widget-delivery.module';
import { Module } from '@nestjs/common';
import { WidgetService } from './widget.service';
import { WidgetTriggersService } from './widget-triggers.service';
import { WidgetController } from './widget.controller';
import { WidgetTriggersController } from './widget-triggers.controller';
import { WidgetPublicController } from './widget-public.controller';
import { WidgetGateway } from './widget.gateway';
import { ConversationsModule } from '../conversations/conversations.module';
import { WidgetRateLimitService } from './widget-rate-limit.service';
import { DemoAllowanceController } from './demo-allowance.controller';

@Module({
    imports: [ConversationsModule, WidgetDeliveryModule],
    providers: [WidgetService, WidgetTriggersService, WidgetRateLimitService, WidgetGateway],
    // DemoAllowanceController: the super_admin screen for the platform-paid
    // allowance of the public link, which is this module's runtime.
    controllers: [WidgetController, WidgetTriggersController, WidgetPublicController, DemoAllowanceController],
    exports: [WidgetService, WidgetTriggersService],
})
export class WidgetModule {}
