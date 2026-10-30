import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { BUSINESS_FACT_WRITTEN } from './business-facts.service';
import { ReadinessService } from './readiness.service';

/**
 * Invalida la caché de preparación cuando cambia un dato que lee la especificación:
 * - la configuración del agente (instrucciones, traspaso, horario de cuenta);
 * - un valor del negocio escrito por BusinessFactsService (`business_fact.written`, R3).
 * Las pantallas de catálogo de hoy aún no avisan: la caché dura poco y el panel reevalúa al abrirse (ADR 0004).
 */
@Injectable()
export class ReadinessInvalidationListener {
    private readonly logger = new Logger(ReadinessInvalidationListener.name);

    constructor(private readonly readiness: ReadinessService) {}

    @OnEvent('agent.config.updated', { async: true })
    @OnEvent('agent.version.updated', { async: true })
    @OnEvent(BUSINESS_FACT_WRITTEN, { async: true })
    async onAgentChanged(payload: { tenantId?: string } | undefined): Promise<void> {
        if (!payload?.tenantId) return;
        await this.readiness.invalidate(payload.tenantId)
            .catch(err => this.logger.warn(`readiness: no se pudo invalidar ${payload.tenantId}: ${(err as Error).message}`));
    }
}
