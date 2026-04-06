import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappMessagingService } from '../whatsapp/services/whatsapp-messaging.service';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
import { AUTOMATION_JOBS_QUEUE } from './automation-listener.service';
import { LeadCapturedEvent } from './events/lead-captured.event';

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
    ) {
        super();
    }

    async process(job: Job<AutomationJobData>): Promise<any> {
        const { tenantId, schemaName, executionId, ruleName, action, event } = job.data;
        const startTime = Date.now();

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

                case 'update_stage':
                    result = await this.handleUpdateStage(schemaName, action, event);
                    break;

                default:
                    this.logger.warn(`[AutomationJobs] Tipo de accion desconocido: ${action.type}`);
                    result = { skipped: true, reason: `Tipo desconocido: ${action.type}` };
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
            `INSERT INTO tasks (lead_id, description, due_at, status, created_at)
             VALUES ($1, $2, $3, 'pending', NOW()) RETURNING id`,
            [event.leadId, description, dueAt],
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
        schemaName: string,
        action: AutomationJobData['action'],
        event: LeadCapturedEvent,
    ) {
        const newStage = action.stage;
        if (!newStage) {
            throw new Error('stage es requerido para accion update_stage');
        }

        // Actualizar la oportunidad vinculada al lead
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `UPDATE opportunities SET stage = $1, updated_at = NOW()
             WHERE lead_id = $2::uuid AND stage != $1
             RETURNING id, stage`,
            [newStage, event.leadId],
        );

        this.logger.log(
            `[AutomationJobs] Etapa actualizada a '${newStage}' para ${rows?.length || 0} oportunidad(es) del lead ${event.leadId}`,
        );

        return {
            action: 'update_stage',
            newStage,
            updatedOpportunities: rows?.length || 0,
        };
    }
}
