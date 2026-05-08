import { Module } from '@nestjs/common';
import { VerticalAnalyticsService } from './vertical-analytics.service';
import { VerticalAnalyticsController } from './vertical-analytics.controller';

@Module({
    controllers: [VerticalAnalyticsController],
    providers: [VerticalAnalyticsService],
    exports: [VerticalAnalyticsService],
})
export class VerticalAnalyticsModule {}
