import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { RegionalProfileService } from '../tenants/regional-profile.service';
import { PersonaService } from '../persona/persona.service';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
import { LeadCapturedEvent } from './events/lead-captured.event';

export const AUTOMATION_JOBS_QUEUE = 'automation-jobs';

/**
 * Servicio que escucha eventos de dominio y programa acciones automatizadas
 * basandose en las reglas configuradas por tenant.
 *
 * El delay es critico: el saludo AI debe llegar primero, LUEGO la plantilla.
 */
@Injectable()
export class AutomationListenerService {
    private readonly logger = new Logger(AutomationListenerService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly personaService: PersonaService,
        private readonly throttle: TenantThrottleService,
        @InjectQueue(AUTOMATION_JOBS_QUEUE) private readonly automationQueue: Queue,
        private readonly regionalProfile: RegionalProfileService,
    ) {}

    @OnEvent('lead.captured')
    async handleLeadCaptured(event: LeadCapturedEvent) {
        this.logger.log(
            `[AutomationListener] Evento lead.captured recibido — lead: ${event.leadId}, fuente: ${event.source}`,
        );

        try {
            const schemaName = event.schemaName || await this.prisma.getTenantSchemaName(event.tenantId);
            // 1. Verificar horario comercial
            const config = await this.personaService.getActivePersona(event.tenantId);
            if (config && !(await this.isWithinBusinessHours(config, event.tenantId))) {
                this.logger.log(
                    `[AutomationListener] Fuera de horario comercial para tenant ${event.tenantId}. Omitiendo automatizaciones.`,
                );
                return;
            }

            // 2. Buscar reglas activas con trigger_type = 'lead.captured'
            const activeRules = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT * FROM automation_rules WHERE trigger_type = $1 AND active = true`,
                ['lead.captured'],
            );

            if (!activeRules || activeRules.length === 0) {
                this.logger.debug(
                    `[AutomationListener] No hay reglas activas para lead.captured en tenant ${event.tenantId}`,
                );
                return;
            }

            // 3. Check tenant rate limit before queueing any jobs
            if (await this.throttle.isLimited(event.tenantId, 'automation')) {
                this.logger.warn(
                    `[AutomationListener] Tenant ${event.tenantId} rate limited — skipping ${activeRules.length} rules`,
                );
                return;
            }

            // 4. Resolve job priority based on tenant plan
            const priority = await this.throttle.getPriority(event.tenantId);

            // 5. Evaluar y programar cada regla
            for (const rule of activeRules) {
                await this.dispatchRule({
                    tenantId: event.tenantId,
                    schemaName,
                    rule,
                    entityType: 'lead',
                    entityId: event.leadId,
                    payload: event,
                    priority,
                });
            }
        } catch (error: any) {
            this.logger.error(
                `[AutomationListener] Error procesando lead.captured: ${error.message}`,
                error.stack,
            );
        }
    }

    /**
     * Cita completada — la ventana post-visita.
     *
     * El cron de auto-completado ya marcaba las citas y no avisaba a nadie, así
     * que el momento en que un cliente está más dispuesto a dejar una reseña o
     * a volver a agendar pasaba sin que el negocio pudiera engancharse. Es el
     * disparador que le faltaba a toda la vertical de agenda (salud, belleza,
     * veterinaria, inmobiliaria, automotriz).
     *
     * No duplica a `rebooking.due` del evaluador temporal: aquel corre semanas
     * o meses después (la re-reserva); éste es el mismo día.
     */
    @OnEvent('appointment.completed')
    async handleAppointmentCompleted(event: {
        tenantId: string;
        schemaName: string;
        appointmentId: string;
        phone?: string;
        leadId?: string | null;
    }) {
        await this.runRulesForTrigger(
            'appointment.completed',
            event.tenantId,
            event.schemaName,
            'appointment',
            event.appointmentId,
            event,
        );
    }

    @OnEvent('message.inbound')
    async handleMessageInbound(event: {
        tenantId: string;
        schemaName?: string;
        conversationId: string;
        contactId?: string;
        phone?: string;
        [key: string]: any;
    }) {
        try {
            const schemaName = event.schemaName || await this.prisma.getTenantSchemaName(event.tenantId);
            let phone = event.phone;
            if (!phone) {
                // El `contactId` de `message.inbound` viene de NormalizedMessage y es el
                // identificador DEL CANAL (el user id de Telegram, el numero de
                // WhatsApp…), no el UUID de `contacts`. Casteado a ::uuid reventaba con
                //   22P02 invalid input syntax for type uuid: "860048121"
                // y como el error se atrapa mas abajo, las automatizaciones dejaban de
                // correr en silencio para cada mensaje entrante.
                //
                // Se resuelve por la conversacion, cuyo id si es UUID siempre.
                const contacts = await this.prisma.executeInTenantSchema<any[]>(
                    schemaName,
                    `SELECT ct.phone
                       FROM conversations c
                       JOIN contacts ct ON ct.id = c.contact_id
                      WHERE c.id = $1::uuid
                      LIMIT 1`,
                    [event.conversationId],
                );
                phone = contacts?.[0]?.phone || undefined;
            }

            let businessHoursStatus: 'open' | 'closed' | 'unknown' = 'unknown';
            try {
                const persona = await this.personaService.getActivePersona(event.tenantId);
                if (persona) {
                    businessHoursStatus = await this.isWithinBusinessHours(persona, event.tenantId)
                        ? 'open' : 'closed';
                }
            } catch (error: any) {
                this.logger.warn(`[AutomationListener] No se pudo resolver horario para new_message: ${error.message}`);
            }

            await this.runRulesForTrigger(
                'new_message',
                event.tenantId,
                schemaName,
                'conversation',
                event.conversationId,
                { ...event, schemaName, phone, businessHoursStatus, eventType: 'new_message' },
            );
        } catch (error: any) {
            this.logger.error(`[AutomationListener] Error preparando new_message: ${error.message}`);
        }
    }

    @OnEvent('conversation.assigned')
    async handleConversationAssigned(event: {
        tenantId: string;
        schemaName?: string;
        conversationId: string;
        agentId: string;
        [key: string]: any;
    }) {
        try {
            const schemaName = event.schemaName || await this.prisma.getTenantSchemaName(event.tenantId);
            await this.runRulesForTrigger(
                'conversation_assigned',
                event.tenantId,
                schemaName,
                'conversation',
                event.conversationId,
                { ...event, schemaName, assignedTo: event.agentId, eventType: 'conversation_assigned' },
            );
        } catch (error: any) {
            this.logger.error(`[AutomationListener] Error preparando conversation_assigned: ${error.message}`);
        }
    }

    @OnEvent('pipeline.stage_changed')
    async handlePipelineStageChanged(event: {
        tenantId: string;
        dealId: string;
        toStageSlug?: string;
        [key: string]: any;
    }) {
        await this.handleDealTrigger('stage_changed', event, {
            stage: event.toStageSlug,
            eventType: 'stage_changed',
        });
    }

    @OnEvent('pipeline.sla_violated')
    async handlePipelineSlaViolated(event: {
        tenantId: string;
        dealId: string;
        stageSlug?: string;
        [key: string]: any;
    }) {
        await this.handleDealTrigger('sla_timeout', event, {
            stage: event.stageSlug,
            eventType: 'sla_timeout',
        });
    }

    private async handleDealTrigger(
        triggerType: 'stage_changed' | 'sla_timeout',
        event: { tenantId: string; dealId: string; [key: string]: any },
        aliases: Record<string, any>,
    ): Promise<void> {
        try {
            const schemaName = event.schemaName || await this.prisma.getTenantSchemaName(event.tenantId);
            const links = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT o.lead_id, l.contact_id,
                        COALESCE(NULLIF(l.phone, ''), NULLIF(c.phone, '')) AS phone
                   FROM opportunities o
                   JOIN leads l ON l.id = o.lead_id
                   LEFT JOIN contacts c ON c.id = l.contact_id
                  WHERE o.deal_id = $1::uuid
                  LIMIT 2`,
                [event.dealId],
            );
            if (links?.length !== 1) {
                this.logger.warn(
                    `[AutomationListener] ${triggerType} omitido: deal ${event.dealId} tiene ${links?.length || 0} correlaciones exactas`,
                );
                return;
            }
            const link = links[0];
            await this.runRulesForTrigger(
                triggerType,
                event.tenantId,
                schemaName,
                'deal',
                event.dealId,
                {
                    ...event,
                    ...aliases,
                    schemaName,
                    leadId: link.lead_id,
                    contactId: link.contact_id,
                    phone: link.phone || undefined,
                },
            );
        } catch (error: any) {
            this.logger.error(`[AutomationListener] Error preparando ${triggerType}: ${error.message}`);
        }
    }

    /**
     * Corre las reglas activas de un trigger sobre una entidad.
     *
     * Es el mismo camino que `lead.captured` —mismas condiciones, mismo audit
     * trail, misma cola con reintentos— extraído para que agregar un disparador
     * de dominio nuevo sea declarar un `@OnEvent` y llamar acá, en vez de
     * reimplementar la evaluación y que las dos versiones diverjan.
     */
    async runRulesForTrigger(
        triggerType: string,
        tenantId: string,
        schemaName: string,
        entityType: string,
        entityId: string,
        payload: any,
    ): Promise<void> {
        try {
            const rules = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT * FROM automation_rules WHERE trigger_type = $1 AND active = true`,
                [triggerType],
            );
            if (!rules?.length) return;

            if (await this.throttle.isLimited(tenantId, 'automation')) {
                this.logger.warn(`[AutomationListener] Tenant ${tenantId} rate limited — se omiten ${rules.length} reglas de ${triggerType}`);
                return;
            }
            const priority = await this.throttle.getPriority(tenantId);

            for (const rule of rules) {
                await this.dispatchRule({ tenantId, schemaName, rule, entityType, entityId, payload, priority });
            }
        } catch (error: any) {
            this.logger.error(`[AutomationListener] Error procesando ${triggerType}: ${error.message}`);
        }
    }

    /**
     * Evalúa las condiciones de UNA regla y encola sus acciones.
     *
     * Estaba escrito dentro del handler de `lead.captured`, que era el único
     * disparador que existía. Se extrae tal cual —mismas condiciones, mismo
     * audit trail, mismos reintentos— para que el evaluador temporal (H-3)
     * dispare reglas por el paso del tiempo sin duplicar esta lógica ni
     * divergir de ella con el tiempo.
     *
     * `entityType`/`entityId` dejan de estar hardcodeados en 'lead': lo que
     * dispara una regla puede ser una vacuna, una póliza o una estadía.
     */
    async dispatchRule(params: {
        tenantId: string;
        schemaName: string;
        rule: any;
        entityType: string;
        entityId: string;
        payload: any;
        priority: number;
    }): Promise<void> {
        const { tenantId, schemaName, rule, entityType, entityId, payload, priority } = params;

        if (!this.evaluateConditions(rule.conditions_json, payload)) {
            this.logger.debug(`[AutomationListener] Regla '${rule.name}' no cumple condiciones. Omitiendo.`);
            return;
        }

        let actions: any[] = [];
        if (typeof rule.actions_json === 'string') {
            try { actions = JSON.parse(rule.actions_json); } catch { actions = []; }
        } else if (Array.isArray(rule.actions_json)) {
            actions = rule.actions_json;
        }

        // Crear registro de ejecucion (audit trail)
        const execution = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `INSERT INTO automation_executions (rule_id, entity_type, entity_id, status)
             VALUES ($1, $2, $3, 'queued') RETURNING *`,
            [rule.id, entityType, entityId],
        );
        const executionId = execution?.[0]?.id;

        // Programar cada accion como un job con delay en BullMQ
        for (const action of actions) {
            // `delay` y `delay_seconds` son el MISMO campo con dos nombres. Las
            // plantillas sembradas escriben `delay` (seed-templates.ts) y esto
            // leia solo `delay_seconds`, asi que las 10 acciones sembradas con
            // retardo real —hasta 3 dias— se disparaban al instante: el
            // seguimiento "3 dias despues de la visita" llegaba pegado al
            // mensaje anterior. Se aceptan los dos nombres.
            const delaySeconds = Number(action.delay_seconds ?? action.delay ?? 0);
            const delayMs = (Number.isFinite(delaySeconds) && delaySeconds > 0 ? delaySeconds : 0) * 1000;

            await this.automationQueue.add(
                action.type,
                {
                    tenantId,
                    schemaName,
                    executionId,
                    ruleId: rule.id,
                    ruleName: rule.name,
                    action,
                    event: payload,
                },
                {
                    priority,
                    delay: delayMs,
                    attempts: 3,
                    backoff: { type: 'exponential', delay: 5000 },
                    removeOnComplete: { age: 3600 * 24 },
                    removeOnFail: { age: 3600 * 24 * 7 },
                },
            );

            this.logger.log(
                `[AutomationListener] Job '${action.type}' programado (priority=${priority}, delay=${delayMs}ms) para regla '${rule.name}' tenant=${tenantId}`,
            );
        }
    }

    /**
     * Evaluador de condiciones con soporte para formato estructurado y legacy.
     * Formato nuevo: [{ field, operator, value }] con operadores avanzados.
     * Formato legacy: { key: value } con igualdad simple.
     */
    private evaluateConditions(conditions: any, event: LeadCapturedEvent | Record<string, any>): boolean {
        if (!conditions) return true;

        // New structured format: [{ field, operator, value }]
        if (Array.isArray(conditions)) {
            if (conditions.length === 0) return true;
            return conditions.every((c: any) => {
                const actual = (event as any)[c.field];
                const expected = c.value;
                switch (c.operator) {
                    case 'equals': return String(actual) === String(expected);
                    case 'not_equals': return String(actual) !== String(expected);
                    case 'greater_than': return Number(actual) > Number(expected);
                    case 'less_than': return Number(actual) < Number(expected);
                    case 'contains': return String(actual || '').toLowerCase().includes(String(expected).toLowerCase());
                    default: return String(actual) === String(expected);
                }
            });
        }

        // Legacy format: { key: value }
        if (typeof conditions !== 'object' || Object.keys(conditions).length === 0) return true;
        for (const [key, expectedValue] of Object.entries(conditions)) {
            if ((event as any)[key] !== expectedValue) return false;
        }
        return true;
    }

    /**
     * Verifica si estamos dentro del horario comercial configurado en la persona.
     */
    private async isWithinBusinessHours(config: any, tenantId: string): Promise<boolean> {
        if (!config.hours || !config.hours.schedule) return true;

        // El literal decidía cuándo un negocio mexicano está "abierto": a las 8
        // de la mañana en Bogotá son las 7 en Ciudad de México, así que una
        // secuencia de nurturing salía una hora antes de abrir. Ahora, sin
        // horario propio en la persona, se usa la zona del negocio.
        const timezone = config.hours.timezone
            || await this.regionalProfile.timezoneFor(tenantId);
        const localTime = new Intl.DateTimeFormat('en-US', {
            timeZone: timezone,
            weekday: 'short',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        }).formatToParts(new Date());

        const dayPart = localTime.find(p => p.type === 'weekday')?.value?.toLowerCase();
        const hourPart = localTime.find(p => p.type === 'hour')?.value || '0';
        const minutePart = localTime.find(p => p.type === 'minute')?.value || '0';
        const currentMinutes = parseInt(hourPart) * 60 + parseInt(minutePart);

        const schedule: Record<string, { start: string; end: string } | string> = config.hours.schedule;
        const todaySchedule = schedule[dayPart || ''];

        if (!todaySchedule || typeof todaySchedule === 'string') return false;

        const [startH, startM] = todaySchedule.start.split(':').map(Number);
        const [endH, endM] = todaySchedule.end.split(':').map(Number);

        return currentMinutes >= (startH * 60 + startM) && currentMinutes < (endH * 60 + endM);
    }
}
