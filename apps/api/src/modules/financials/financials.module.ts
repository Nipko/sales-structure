import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { FinancialsService } from './financials.service';
import { FinancialSnapshotService } from './financial-snapshot.service';
import { FinancialsController } from './financials.controller';

@Module({
    imports: [PrismaModule, RedisModule],
    controllers: [FinancialsController],
    providers: [FinancialsService, FinancialSnapshotService],
    exports: [FinancialsService, FinancialSnapshotService],
})
export class FinancialsModule {}
