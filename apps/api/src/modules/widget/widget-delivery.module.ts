import { Module } from '@nestjs/common';
import { WidgetMessageStore } from './widget-message-store.service';
import { WidgetAgentReplyStore } from './widget-agent-reply.store';

/** Dependency leaf: no gateway, conversations runtime or channel queue imports. */
@Module({providers:[WidgetMessageStore,WidgetAgentReplyStore],exports:[WidgetMessageStore,WidgetAgentReplyStore]})
export class WidgetDeliveryModule {}
