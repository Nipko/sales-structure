import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { BusinessFactsService } from './business-facts.service';
import { ReadinessController } from './readiness.controller';
import { ReadinessInvalidationListener } from './readiness-invalidation.listener';
import { ReadinessService } from './readiness.service';

/**
 * Preparación del negocio (C0 §1): motor de @parallext/business-spec + historial + caché (R2) y la única puerta de
 * escritura de los valores del negocio, BusinessFactsService (R3).
 */
@Module({
    imports: [PrismaModule, RedisModule],
    providers: [ReadinessService, BusinessFactsService, ReadinessInvalidationListener],
    controllers: [ReadinessController],
    exports: [ReadinessService, BusinessFactsService],
})
export class ReadinessModule {}
