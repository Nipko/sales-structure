import { Module } from '@nestjs/common';
import { TraceService } from './trace.service';
import { TraceListenerService } from './trace-listener.service';
import { TraceController } from './trace.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';

@Module({
    imports: [PrismaModule, RedisModule],
    providers: [TraceService, TraceListenerService],
    controllers: [TraceController],
    exports: [TraceService],
})
export class TraceModule {}
