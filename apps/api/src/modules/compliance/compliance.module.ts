import { Module } from '@nestjs/common';
import { ComplianceService } from './compliance.service';
import { ComplianceService as AnalyticsComplianceService } from '../analytics/compliance.service';
import { ComplianceController } from './compliance.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { LearningModule } from '../learning/learning.module';

@Module({
    imports: [PrismaModule, RedisModule, LearningModule],
    controllers: [ComplianceController],
    providers: [ComplianceService, AnalyticsComplianceService],
    exports: [ComplianceService]
})
export class ComplianceModule {}
