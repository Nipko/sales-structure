import { Injectable, Logger, Optional } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { BUSINESS_FACT_WRITTEN, type BusinessFactWrittenEvent } from '../readiness/business-facts.service';
import { AGENT_QUALITY_DEPENDENCIES_UPDATED } from '../quality/agent-quality-events';
import { TenantsService } from './tenants.service';

/**
 * R3b (expand, ADR 0009): BusinessFactsService escribió un valor y su proyección al almacenamiento de hoy en la misma
 * transacción. Aquí se hace lo que hacen las pantallas viejas después de guardar ese almacenamiento:
 * - `settings.businessHours` / `customerTypes` / `tenants.name` → `TenantsService.finalizeConfigurationUpdate` (cachés del
 *   tenant y de la persona, aviso de dependencias de calidad);
 * - `companies` y `policies` → aviso de dependencias de calidad (las cachés del agente las borra BusinessFactsCacheListener).
 * Se retira con la proyección, en la release siguiente.
 */
@Injectable()
export class BusinessFactProjectionListener {
    private readonly logger = new Logger(BusinessFactProjectionListener.name);

    constructor(
        private readonly tenants: TenantsService,
        @Optional() private readonly events?: EventEmitter2,
    ) {}

    @OnEvent(BUSINESS_FACT_WRITTEN, { async: true })
    async onWritten(event: BusinessFactWrittenEvent | undefined): Promise<void> {
        if (!event?.tenantId || !event.projectedTo) return;
        try {
            if (event.projectedTo === 'settings.businessHours') {
                await this.tenants.finalizeConfigurationUpdate(event.tenantId, { businessHours: true });
            } else if (event.projectedTo === 'tenants.name') {
                await this.tenants.finalizeConfigurationUpdate(event.tenantId, {});
            } else if (event.projectedTo.startsWith('companies.')) {
                if (event.requirementId === 'CORE.IDENTITY.DESCRIPTION') await this.tenants.finalizeConfigurationUpdate(event.tenantId, { customerTypes: true });
                this.events?.emit(AGENT_QUALITY_DEPENDENCIES_UPDATED, { tenantId: event.tenantId, source: 'business_info' });
            } else if (event.projectedTo.startsWith('policies.')) {
                this.events?.emit(AGENT_QUALITY_DEPENDENCIES_UPDATED, { tenantId: event.tenantId, source: 'knowledge' });
            }
        } catch (err) {
            this.logger.warn(`business-facts: proyección de ${event.requirementId} guardada; falló la invalidación: ${(err as Error).message}`);
        }
    }
}
