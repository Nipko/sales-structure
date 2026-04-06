import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { PersonaService } from '../persona/persona.service';
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
        @InjectQueue(AUTOMATION_JOBS_QUEUE) private readonly automationQueue: Queue,
    ) {}

    @OnEvent('lead.captured')
    async handleLeadCaptured(event: LeadCapturedEvent) {
        this.logger.log(
            `[AutomationListener] Evento lead.captured recibido — lead: ${event.leadId}, fuente: ${event.source}`,
        );

        const schemaName = event.schemaName || `tenant_${event.tenantId.replace(/-/g, '_')}`;

        try {
            // 1. Verificar horario comercial
            const config = await this.personaService.getActivePersona(event.tenantId);
            if (config && !this.isWithinBusinessHours(config)) {
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

            // 3. Evaluar y programar cada regla
            for (const rule of activeRules) {
                const conditionsMatch = this.evaluateConditions(rule.conditions_json, event);
                if (!conditionsMatch) {
                    this.logger.debug(`[AutomationListener] Regla '${rule.name}' no cumple condiciones. Omitiendo.`);
                    continue;
                }

                // Parsear acciones
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
                     VALUES ($1, 'lead', $2, 'queued') RETURNING *`,
                    [rule.id, event.leadId],
                );
                const executionId = execution?.[0]?.id;

                // Programar cada accion como un job con delay en BullMQ
                for (const action of actions) {
                    const delayMs = (action.delay_seconds || 0) * 1000;

                    await this.automationQueue.add(
                        action.type, // job name: 'send_template', 'create_task', 'update_stage'
                        {
                            tenantId: event.tenantId,
                            schemaName,
                            executionId,
                            ruleId: rule.id,
                            ruleName: rule.name,
                            action,
                            event,
                        },
                        {
                            delay: delayMs,
                            attempts: 3,
                            backoff: { type: 'exponential', delay: 5000 },
                            removeOnComplete: { age: 3600 * 24 },
                            removeOnFail: { age: 3600 * 24 * 7 },
                        },
                    );

                    this.logger.log(
                        `[AutomationListener] Job '${action.type}' programado con delay ${delayMs}ms para regla '${rule.name}'`,
                    );
                }
            }
        } catch (error: any) {
            this.logger.error(
                `[AutomationListener] Error procesando lead.captured: ${error.message}`,
                error.stack,
            );
        }
    }

    /**
     * Evaluador de condiciones con soporte para formato estructurado y legacy.
     * Formato nuevo: [{ field, operator, value }] con operadores avanzados.
     * Formato legacy: { key: value } con igualdad simple.
     */
    private evaluateConditions(conditions: any, event: LeadCapturedEvent): boolean {
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
    private isWithinBusinessHours(config: any): boolean {
        if (!config.hours || !config.hours.schedule) return true;

        const timezone = config.hours.timezone || 'America/Bogota';
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
