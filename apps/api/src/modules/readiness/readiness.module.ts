import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { ReadinessController } from './readiness.controller';
import { ReadinessInvalidationListener } from './readiness-invalidation.listener';
import { ReadinessService } from './readiness.service';

/** Preparación del negocio (C0 §1, rebanada R2): motor de @parallext/business-spec + historial + caché. */
@Module({
    imports: [PrismaModule, RedisModule],
    providers: [ReadinessService, ReadinessInvalidationListener],
    controllers: [ReadinessController],
    exports: [ReadinessService],
})
export class ReadinessModule {}
