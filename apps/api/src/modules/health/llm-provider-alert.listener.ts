import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PlatformMonitorService } from './platform-monitor.service';
import { IncidentService } from './incident.service';
import {
    LLM_PROVIDER_HEALTH_ALERT_EVENT, type LlmProviderHealthAlert,
} from '../ai/health/llm-provider-health.service';

/**
 * Convierte los avisos de salud de proveedores LLM (ADR-0026) en incidente +
 * Telegram + email por el mismo camino que el resto de alertas de plataforma.
 *
 * El dedupe ya lo hizo `LlmProviderHealthService` (una vez al entrar a un
 * estado grave, recordatorio cada 6 h); por eso aqui el cooldown del monitor
 * es corto: una recaida despues de recuperarse tiene que volver a sonar.
 */
@Injectable()
export class LlmProviderAlertListener {
    private readonly logger = new Logger(LlmProviderAlertListener.name);

    constructor(
        private readonly monitor: PlatformMonitorService,
        private readonly incidents: IncidentService,
    ) { }

    @OnEvent(LLM_PROVIDER_HEALTH_ALERT_EVENT, { async: true })
    async onAlert(alert: LlmProviderHealthAlert): Promise<void> {
        try {
            for (const key of alert.resolveKeys ?? []) await this.incidents.resolveByKey(key);
            if (alert.resolveOnly) return;
            await this.monitor.notify(alert.key, alert.subject, alert.html, alert.value, {
                severity: alert.severity,
                cooldownSec: 60,
                persistIncident: !alert.noIncident,
            });
            // Un simulacro deja rastro en el historial pero no un incidente abierto.
            if (alert.drill) await this.incidents.resolveByKey(alert.key);
        } catch (e: any) {
            this.logger.warn(`LLM provider alert delivery failed for ${alert.key}: ${e?.message}`);
        }
    }
}
