import { Module } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';
import { DashboardAnalyticsService } from './dashboard-analytics.service';
import { DashboardAnalyticsController } from './dashboard-analytics.controller';
import { MetricsAggregationService } from './metrics-aggregation.service';
import { AlertsService } from './alerts.service';
import { AlertsController } from './alerts.controller';
import { BIApiController } from './bi-api.controller';
import { ScheduledReportsService } from './scheduled-reports.service';
import { ComplianceService } from './compliance.service';
import { AuditService } from './audit.service';
import { CsatTriggerService } from './csat-trigger.service';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';

@Module({
    imports: [PrismaModule, RedisModule],
    providers: [
        AnalyticsService, DashboardAnalyticsService, MetricsAggregationService,
        AlertsService, ScheduledReportsService,
        ComplianceService, AuditService, CsatTriggerService,
    ],
    controllers: [AnalyticsController, DashboardAnalyticsController, AlertsController, BIApiController],
    exports: [AnalyticsService, DashboardAnalyticsService, ComplianceService, AuditService, CsatTriggerService],
})
export class AnalyticsModule { }
