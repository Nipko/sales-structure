import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { RedisService } from '../redis/redis.service';
import { businessFactSourcesCacheKey } from './business-facts.reader';
import { BUSINESS_FACT_WRITTEN, type BusinessFactWrittenEvent } from './business-facts.service';

/**
 * Cachés de lo que lee el agente (R3b): cuando BusinessFactsService escribe un valor (y su proyección al almacenamiento
 * viejo), el agente debe leerlo en el turno siguiente, no cuando venzan las cachés de hoy.
 * - `business-facts:sources:{tenant}`: fuentes de BusinessFactsReader;
 * - `biz_hours:{tenant}`: horario del turno (ConversationsService.loadTenantBusinessHours);
 * - `business-info:{tenant}:primary`: identidad de `companies` (BusinessInfoService.getPrimary).
 * Las cachés del tenant y de la persona las invalida TenantsService (BusinessFactProjectionListener) cuando la proyección
 * tocó `settings` o `tenants.name`.
 */
@Injectable()
export class BusinessFactsCacheListener {
    private readonly logger = new Logger(BusinessFactsCacheListener.name);

    constructor(private readonly redis: RedisService) {}

    @OnEvent(BUSINESS_FACT_WRITTEN, { async: true })
    async onWritten(event: BusinessFactWrittenEvent | undefined): Promise<void> {
        if (!event?.tenantId) return;
        for (const key of [businessFactSourcesCacheKey(event.tenantId), `biz_hours:${event.tenantId}`, `business-info:${event.tenantId}:primary`]) {
            await this.redis.del(key).catch(err => this.logger.warn(`business-facts: no se pudo invalidar ${key}: ${(err as Error).message}`));
        }
    }
}
