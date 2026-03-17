import { Module } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';
import { ComplianceService } from './compliance.service';
import { AuditService } from './audit.service';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';

@Module({
    imports: [PrismaModule, RedisModule],
    providers: [AnalyticsService, ComplianceService, AuditService],
    controllers: [AnalyticsController],
    exports: [AnalyticsService, ComplianceService, AuditService],
})
export class AnalyticsModule { }
