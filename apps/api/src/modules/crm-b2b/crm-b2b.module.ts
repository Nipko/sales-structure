import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { OrganizationsService } from './organizations.service';
import { ForecastingService } from './forecasting.service';
import { DealRottingCronService } from './deal-rotting-cron.service';
import { CrmB2bController } from './crm-b2b.controller';

/**
 * CRM B2B (T3.21): organizations (built on the existing `companies` table),
 * weighted-pipeline forecasting, and a deal-rotting cron. EventEmitter is global.
 */
@Module({
    imports: [PrismaModule, RedisModule],
    providers: [OrganizationsService, ForecastingService, DealRottingCronService],
    controllers: [CrmB2bController],
    exports: [OrganizationsService, ForecastingService],
})
export class CrmB2bModule {}
