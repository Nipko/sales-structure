import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappMessagingService } from '../whatsapp/services/whatsapp-messaging.service';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
import { AUTOMATION_JOBS_QUEUE } from './automation-listener.service';
import { HttpRequestHandler } from './handlers/http-request.handler';
import { LeadCapturedEvent } from './events/lead-captured.event';
import { PipelineService } from '../pipeline/pipeline.service';
import { resolveTenantSubscriptionAccess } from '../../common/utils/subscription-entitlement.util';

export interface AutomationJobData {
    tenantId: string;
    schemaName: string;
    executionId: string;
    ruleId: string;
    ruleName: string;
    action: {
        type: string;
        delay_seconds?: number;
        template_name?: string;
        language?: string;
        components?: any[];
        stage?: string;
        task_description?: string;
        task_due_hours?: number;
        [key: string]: any;
    };
    event: LeadCapturedEvent;
}

/**
 * Procesador BullMQ para acciones de automatizacion diferidas.
 *
 * Tipos de job soportados:
 * - send_template: Envia plantilla WhatsApp via WhatsappMessagingService
 * - create_task: Crea tarea de seguimiento para un agente
 * - update_stage: Mueve la oportunidad a una nueva etapa
 *
 * 3 reintentos con backoff exponencial.
 */
@Processor(AUTOMATION_JOBS_QUEUE, {
    concurrency: 10,
    limiter: { max: 30, duration: 1000 },
})
export class AutomationJobsProcessor extends WorkerHost {
    private readonly logger = new Logger(AutomationJobsProcessor.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly whatsappMessaging: WhatsappMessagingService,
        private readonly throttle: TenantThrottleService,
        private readonly httpRequestHandler: HttpRequestHandler,
        private readonly pipelineService: PipelineService,
    ) {
        super();
    }

    async process(job: Job<AutomationJobData>): Promise<any> {
        const { tenantId, schemaName, executionId, ruleName, action, event } = job.data;
        const startTime = Date.now();

        const entitlement = await resolveTenantSubscriptionAccess(this.prisma, tenantId, 'write');
        if (!entitlement.allowed) {
            if (entitlement.restrictionLevel === 'unavailable') {
                throw new Error(`subscription_entitlement_unavailable:${entitlement.error ?? 'unknown'}`);
            }
            const reason = entitlement.error ?? 'subscription_restricted';
            if (executionId) {
                await this.prisma.executeInTenantSchema(
                    schemaName,
                    `UPDATE automation_executions
                     SET status = 'failed', finished_at = CURRENT_TIMESTAMP, result_json = $2
                     WHERE id = $1::uuid`,
                    [executionId, JSON.stringify({ error: reason, skipped: true })],
                );
            }
            this.logger.warn(
                `[AutomationJobs] Omitido '${action.type}' para tenant=${tenantId}: ${reason}`,
            );
            return { skipped: true, reason };
        }

        // Per-tenant rate limit check — if exceeded, throw to trigger BullMQ retry
        if (await this.throttle.isLimited(tenantId, 'automation')) {
            throw new Error(`Tenant ${tenantId} rate limited for automation — will retry`);
        }

        this.logger.log(
            `[AutomationJobs] Procesando job '${action.type}' para regla '${ruleName}' tenant=${tenantId} (intento ${job.attemptsMade + 1})`,
        );

        try {
            let result: any;

            switch (action.type) {
                case 'send_template':
                    result = await this.handleSendTemplate(schemaName, action, event);
                    break;

                case 'create_task':
                    result = await this.handleCreateTask(schemaName, action, event);
                    break;

                // `change_stage` es el nombre que usan las plantillas sembradas
                // (seed-templates.ts) y `update_stage` el que esperaba este
                // switch. Nadie los alineó nunca, así que la acción caía en el
                // default y no hacía nada. Se aceptan los dos.
                case 'update_stage':
                case 'change_stage':
                    result = await this.handleUpdateStage(tenantId, schemaName, action, event);
                    break;

                case 'add_tag':
                    result = await this.handleAddTag(schemaName, action, event);
                    break;

                case 'assign_agent':
                    result = await this.handleAssignAgent(schemaName, action, event);
                    break;

                case 'http_request':
                    result = await this.httpRequestHandler.execute(schemaName, action.config || action, event);
                    break;

                default:
                    // NO se traga como éxito. Antes devolvía { skipped: true } y el
                    // bloque de abajo marcaba la ejecución como 'success': el
                    // registro de auditoría afirmaba que la automatización había
                    // corrido cuando no había hecho nada. Un tipo desconocido es
                    // una regla rota, y tiene que verse como rota.
                    throw new Error(`Tipo de accion desconocido: ${action.type}`);
            }

            // Actualizar registro de ejecucion como exitoso
            if (executionId) {
                await this.prisma.executeInTenantSchema(
                    schemaName,
                    `UPDATE automation_executions
                     SET status = 'success', finished_at = CURRENT_TIMESTAMP, result_json = $2
                     WHERE id = $1::uuid`,
                    [executionId, JSON.stringify(result || {})],
                );
            }

            const durationMs = Date.now() - startTime;
            this.logger.log(`[AutomationJobs] Job '${action.type}' completado para '${ruleName}' tenant=${tenantId} (${durationMs}ms)`);
            return result;

        } catch (error: any) {
            this.logger.error(
                `[AutomationJobs] Error en job '${action.type}' para regla '${ruleName}': ${error.message}`,
                error.stack,
            );

            // Si es el ultimo intento, marcar ejecucion como fallida
            if (job.attemptsMade + 1 >= (job.opts?.attempts || 3)) {
                if (executionId) {
                    await this.prisma.executeInTenantSchema(
                        schemaName,
                        `UPDATE automation_executions
                         SET status = 'failed', finished_at = CURRENT_TIMESTAMP, result_json = $2
                         WHERE id = $1::uuid`,
                        [executionId, JSON.stringify({ error: error.message })],
                    ).catch(e => this.logger.warn(`No se pudo actualizar ejecucion fallida: ${e.message}`));
                }
            }

            throw error; // Re-throw para que BullMQ maneje el retry
        }
    }

    /**
     * Envia una plantilla WhatsApp pre-aprobada al lead capturado.
     */
    private async handleSendTemplate(
        schemaName: string,
        action: AutomationJobData['action'],
        event: LeadCapturedEvent,
    ) {
        const templateName = action.template_name;
        const language = action.language || 'es';
        const components = action.components || [];
        const phone = event.phone;

        if (!templateName) {
            throw new Error('template_name es requerido para accion send_template');
        }

        if (!phone) {
            throw new Error('El evento no contiene numero de telefono');
        }

        this.logger.log(
            `[AutomationJobs] Enviando plantilla '${templateName}' (${language}) a ${phone}`,
        );

        const result = await this.whatsappMessaging.sendTemplate(
            schemaName,
            phone,
            templateName,
            language,
            components,
        );

        return {
            action: 'send_template',
            templateName,
            phone,
            messageId: result.messageId,
            success: result.success,
        };
    }

    /**
     * Crea una tarea de seguimiento asignada al propietario del lead.
     */
    private async handleCreateTask(
        schemaName: string,
        action: AutomationJobData['action'],
        event: LeadCapturedEvent,
    ) {
        const description = action.task_description || 'Seguimiento de nuevo lead';
        const dueHours = action.task_due_hours || 24;
        const dueAt = new Date(Date.now() + dueHours * 3600 * 1000).toISOString();

        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `INSERT INTO tasks (lead_id, title, description, due_at, status, created_at)
             VALUES ($1::uuid, $2, $3, $4, 'pending', NOW()) RETURNING id`,
            [event.leadId, description, description, dueAt],
        );

        this.logger.log(`[AutomationJobs] Tarea creada: ${rows?.[0]?.id} para lead ${event.leadId}`);

        return {
            action: 'create_task',
            taskId: rows?.[0]?.id,
            description,
            dueAt,
        };
    }

    /**
     * Mueve la oportunidad del lead a una nueva etapa del pipeline.
     */
    private async handleUpdateStage(
        tenantId: string,
        schemaName: string,
        action: AutomationJobData['action'],
        event: LeadCapturedEvent,
    ) {
        const newStage = action.stage;
        if (!newStage) {
            throw new Error('stage es requerido para accion update_stage');
        }

        const write = await this.pipelineService.writeLeadStage(
            tenantId,
            event.leadId,
            newStage,
            { schemaName, onlyActiveOpportunities: true },
        );

        this.logger.log(
            `[AutomationJobs] Etapa actualizada a '${write.stage.slug}' para ${write.updatedOpportunities} oportunidad(es) del lead ${event.leadId}`,
        );

        return {
            action: 'update_stage',
            newStage: write.stage.slug,
            updatedOpportunities: write.updatedOpportunities,
        };
    }

    /**
     * Etiqueta el lead. Es la acción más usada de las plantillas sembradas
     * después de enviar la plantilla (5 apariciones) y no estaba implementada:
     * caía en el default y se registraba como éxito.
     *
     * Mismo patrón que el CRM (`leads.repository.ts`): asegurar la etiqueta en
     * `tags` y después vincularla. Los dos INSERT llevan ON CONFLICT DO NOTHING
     * porque esto corre con reintentos de BullMQ y no puede fallar la segunda vez.
     */
    private async handleAddTag(
        schemaName: string,
        action: AutomationJobData['action'],
        event: LeadCapturedEvent,
    ) {
        const raw = action.tag ?? action.tags ?? action.config?.tag ?? action.config?.tags;
        const names = (Array.isArray(raw) ? raw : [raw])
            .filter((t: any) => typeof t === 'string' && t.trim())
            .map((t: string) => t.trim());

        if (!names.length) throw new Error('tag es requerido para accion add_tag');
        if (!event.leadId) throw new Error('El evento no contiene leadId');

        for (const name of names) {
            await this.prisma.executeInTenantSchema(
                schemaName,
                `INSERT INTO tags (name, color) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING`,
                [name, '#6366f1'],
            );
            await this.prisma.executeInTenantSchema(
                schemaName,
                `INSERT INTO lead_tags (lead_id, tag_id)
                 SELECT $1::uuid, t.id FROM tags t WHERE t.name = $2
                 ON CONFLICT DO NOTHING`,
                [event.leadId, name],
            );
        }

        this.logger.log(`[AutomationJobs] Etiquetas ${names.join(', ')} aplicadas al lead ${event.leadId}`);
        return { action: 'add_tag', tags: names, leadId: event.leadId };
    }

    /**
     * Asigna el lead a un agente. Tercera acción sembrada sin implementación.
     *
     * `leads.assigned_to` es VARCHAR y guarda el id del usuario. La acción puede
     * traer el id directo o un email, que es lo que un dueño escribe cuando
     * arma la regla a mano.
     */
    private async handleAssignAgent(
        schemaName: string,
        action: AutomationJobData['action'],
        event: LeadCapturedEvent,
    ) {
        const target = action.agentId || action.agent_id || action.assignTo || action.config?.agentId;
        if (!target) throw new Error('agentId es requerido para accion assign_agent');
        if (!event.leadId) throw new Error('El evento no contiene leadId');

        let userId = String(target);
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId);
        if (!isUuid) {
            // Vino un email: se resuelve contra los usuarios del tenant. Si no
            // existe se falla en vez de escribir basura en assigned_to, que
            // dejaría al lead asignado a nadie sin que se note.
            const found = await this.prisma.user.findFirst({
                where: { email: userId, tenantId: (event as any).tenantId },
                select: { id: true },
            });
            if (!found) throw new Error(`No existe un usuario '${target}' en el tenant`);
            userId = found.id;
        }

        await this.prisma.executeInTenantSchema(
            schemaName,
            `UPDATE leads SET assigned_to = $1, updated_at = NOW() WHERE id = $2::uuid`,
            [userId, event.leadId],
        );

        this.logger.log(`[AutomationJobs] Lead ${event.leadId} asignado a ${userId}`);
        return { action: 'assign_agent', leadId: event.leadId, assignedTo: userId };
    }

    @OnWorkerEvent('failed')
    onFailed(job: Job<AutomationJobData>, error: Error) {
        this.logger.error({ msg: 'Automation job failed', jobId: job.id, ruleId: job.data.ruleId, tenantId: job.data.tenantId, error: error.message });
        Sentry.captureException(error, { tags: { queue: 'automation-jobs', tenantId: job.data.tenantId }, extra: { jobId: job.id, ruleId: job.data.ruleId } });
    }
}
