import { Module } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';
import { ComplianceService } from './compliance.service';
import { AuditService } from './audit.service';
import { CsatTriggerService } from './csat-trigger.service';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';

@Module({
    imports: [PrismaModule, RedisModule],
    providers: [AnalyticsService, ComplianceService, AuditService, CsatTriggerService],
    controllers: [AnalyticsController],
    exports: [AnalyticsService, ComplianceService, AuditService, CsatTriggerService],
})
export class AnalyticsModule { }
