import { Module } from '@nestjs/common';
import { AgentAnalyticsService } from './agent-analytics.service';
import { AgentAnalyticsController } from './agent-analytics.controller';

@Module({
    providers: [AgentAnalyticsService],
    controllers: [AgentAnalyticsController],
    exports: [AgentAnalyticsService],
})
export class AgentAnalyticsModule { }
