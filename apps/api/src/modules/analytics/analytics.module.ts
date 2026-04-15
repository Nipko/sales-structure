import { Module } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';
import { DashboardAnalyticsService } from './dashboard-analytics.service';
import { DashboardAnalyticsController } from './dashboard-analytics.controller';
import { MetricsAggregationService } from './metrics-aggregation.service';
import { ComplianceService } from './compliance.service';
import { AuditService } from './audit.service';
import { CsatTriggerService } from './csat-trigger.service';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';

@Module({
    imports: [PrismaModule, RedisModule],
    providers: [
        AnalyticsService, DashboardAnalyticsService, MetricsAggregationService,
        ComplianceService, AuditService, CsatTriggerService,
    ],
    controllers: [AnalyticsController, DashboardAnalyticsController],
    exports: [AnalyticsService, DashboardAnalyticsService, ComplianceService, AuditService, CsatTriggerService],
})
export class AnalyticsModule { }
