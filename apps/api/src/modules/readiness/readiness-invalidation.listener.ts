import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ReadinessService } from './readiness.service';

/**
 * Invalida la caché de preparación cuando cambia la configuración del agente (instrucciones, traspaso,
 * horario de cuenta): son datos que lee la especificación. Las escrituras de valores del negocio avisarán
 * con `business_fact.written` en R3; mientras tanto la caché dura poco y el panel reevalúa al abrirse (ADR 0004).
 */
@Injectable()
export class ReadinessInvalidationListener {
    private readonly logger = new Logger(ReadinessInvalidationListener.name);

    constructor(private readonly readiness: ReadinessService) {}

    @OnEvent('agent.config.updated', { async: true })
    @OnEvent('agent.version.updated', { async: true })
    async onAgentChanged(payload: { tenantId?: string } | undefined): Promise<void> {
        if (!payload?.tenantId) return;
        await this.readiness.invalidate(payload.tenantId)
            .catch(err => this.logger.warn(`readiness: no se pudo invalidar ${payload.tenantId}: ${(err as Error).message}`));
    }
}
