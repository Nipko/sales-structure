import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { BusinessFactsCacheListener } from './business-facts-cache.listener';
import { BusinessFactsReader } from './business-facts.reader';
import { BusinessFactsService } from './business-facts.service';
import { GoLiveService } from './go-live.service';
import { ReadinessContextService } from './readiness-context.service';
import { ReadinessController } from './readiness.controller';
import { ReadinessInvalidationListener } from './readiness-invalidation.listener';
import { ReadinessService } from './readiness.service';

/**
 * Preparación del negocio (C0 §1): motor de @parallext/business-spec + historial + caché (R2), la única puerta de
 * escritura de los valores del negocio, BusinessFactsService (R3), y el lector que usa el agente, BusinessFactsReader
 * (R3b: horario, políticas, not_offered e identidad). R4: el contrato de conocimiento del turno (ReadinessContextService,
 * `<knowledge_status>`) y el control de salida (GoLiveService, en modo sombra hasta la bandera `readiness.goLiveGate`).
 */
@Module({
    imports: [PrismaModule, RedisModule],
    providers: [ReadinessService, BusinessFactsService, BusinessFactsReader, ReadinessInvalidationListener, BusinessFactsCacheListener, GoLiveService, ReadinessContextService],
    controllers: [ReadinessController],
    exports: [ReadinessService, BusinessFactsService, BusinessFactsReader, GoLiveService, ReadinessContextService],
})
export class ReadinessModule {}
