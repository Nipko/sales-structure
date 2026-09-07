import { Module } from '@nestjs/common';
import { WidgetMessageStore } from './widget-message-store.service';

/** Dependency leaf: no gateway, conversations runtime or channel queue imports. */
@Module({providers:[WidgetMessageStore],exports:[WidgetMessageStore]})
export class WidgetDeliveryModule {}
