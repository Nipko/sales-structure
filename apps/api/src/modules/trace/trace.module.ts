import { Module } from '@nestjs/common';
import { TraceService } from './trace.service';
import { TraceListenerService } from './trace-listener.service';
import { TraceMaintenanceService } from './trace-maintenance.service';
import { TraceController } from './trace.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';

@Module({
    imports: [PrismaModule, RedisModule],
    providers: [TraceService, TraceListenerService, TraceMaintenanceService],
    controllers: [TraceController],
    exports: [TraceService],
})
export class TraceModule {}
