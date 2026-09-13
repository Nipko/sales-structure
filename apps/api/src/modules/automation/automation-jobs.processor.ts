import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../prisma/prisma.service';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
import { AUTOMATION_JOBS_QUEUE } from './automation-listener.service';
import { HttpRequestHandler } from './handlers/http-request.handler';
import { LeadCapturedEvent } from './events/lead-captured.event';
import { senderOriginProblem, whatsappSenderFrom } from '../channels/whatsapp-sender-origin';
import { PipelineService } from '../pipeline/pipeline.service';
import { resolveTenantSubscriptionAccess } from '../../common/utils/subscription-entitlement.util';
import { ProactiveDispatchService, producerMayAdvance } from '../channels/proactive-dispatch.service';

export interface AutomationJobData {
    tenantId: string;
    schemaName: string;
    executionId: string;
    ruleId: string;
    ruleName: string;
    /** Position in the rule snapshot. It binds delayed work to that exact action. */
    actionIndex?: number;
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
        private readonly throttle: TenantThrottleService,
        private readonly httpRequestHandler: HttpRequestHandler,
        private readonly pipelineService: PipelineService,
        /**
         * The durable lane, which this rule action could not use before.
         *
         * `send_template` went straight to `WhatsappMessagingService.sendTemplate`
         * on this worker's stack: no row, no lease, no receipt of its own. A
         * restart between "the trigger matched" and the POST either lost the
         * message — the customer simply never heard — or, because the queue add
         * carries no `jobId`, sent it again on the retry. From October each
         * repeat is a charge on the tenant's own WABA.
         */
        private readonly proactive: ProactiveDispatchService,
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
                     SET status = 'failed', finished_at = CURRENT_TIMESTAMP, result_json = $2::jsonb
                     WHERE id = $1::uuid`,
                    [executionId, JSON.stringify({ error: reason, skipped: true })],
                );
            }
            this.logger.warn(
                `[AutomationJobs] Omitido '${action.type}' para tenant=${tenantId}: ${reason}`,
            );
            return { skipped: true, reason };
        }

        // A delayed job is authority carried through time. Re-read the exact
        // rule action before consuming quota or producing any effect: disabling
        // the rule, deleting it, or editing this position revokes old jobs.
        // `send_template` also has a transactional check at outbox admission,
        // but the other five action families previously had no check at all.
        const actionIndex = job.data.actionIndex;
        if (!executionId || !job.data.ruleId || !Number.isInteger(actionIndex) || actionIndex! < 0) {
            throw new Error('automation_job_missing_rule_authority');
        }
        const authority = await this.prisma.executeInTenantSchema<Array<{ authorised: boolean }>>(
            schemaName,
            `SELECT EXISTS (
                 SELECT 1
                   FROM automation_executions ae
                   JOIN automation_rules ar ON ar.id = ae.rule_id
                  WHERE ae.id = $1::uuid
                    AND ae.rule_id = $2::uuid
                    AND ar.active = TRUE
                    AND ar.actions_json -> $3 = $4::jsonb
             ) AS authorised`,
            [executionId, job.data.ruleId, actionIndex, JSON.stringify(action)],
        );
        if (authority?.[0]?.authorised !== true) {
            const result = {
                action: action.type,
                suppressed: 'rule_no_longer_authorises',
                actionIndex,
            };
            await this.prisma.executeInTenantSchema(
                schemaName,
                `UPDATE automation_executions
                    SET status = 'suppressed', finished_at = CURRENT_TIMESTAMP,
                        result_json = $2::jsonb
                  WHERE id = $1::uuid`,
                [executionId, JSON.stringify(result)],
            );
            this.logger.log(
                `[AutomationJobs] Regla ${job.data.ruleId} ya no autoriza la accion ${actionIndex}; suprimida`,
            );
            return result;
        }

        // One quota unit belongs to one logical BullMQ action, not to every
        // execution attempt. BullMQ preserves job.id across retries and the
        // listener assigns deterministic ids to durable rule actions. Without
        // that identity a retry could consume another unit, so fail closed.
        const jobId = String(job.id ?? '').trim();
        if (!jobId) {
            throw new Error('automation_job_missing_stable_id');
        }
        const quotaEffectId = `automation-job:${jobId}`;
        const reservation = await this.throttle.reserveActionUsage(
            tenantId,
            'automation',
            quotaEffectId,
        );
        if (!reservation.allowed) {
            throw new Error(`Tenant ${tenantId} rate limited for automation — will retry`);
        }
        // Automation quota measures admitted logical work. Commit before the
        // handler because an HTTP request or provider hand-off may have taken
        // effect even when its response is lost. A retry adopts this marker.
        await this.throttle.commitActionUsage(tenantId, 'automation', quotaEffectId);

        this.logger.log(
            `[AutomationJobs] Procesando job '${action.type}' para regla '${ruleName}' tenant=${tenantId} (intento ${job.attemptsMade + 1})`,
        );

        try {
            let result: any;

            switch (action.type) {
                case 'send_template':
                    result = await this.handleSendTemplate(
                        tenantId, schemaName, job.data.executionId, job.data.ruleId, action, event);
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
                    result = await this.httpRequestHandler.execute(
                        schemaName,
                        action.config || action,
                        event,
                        { idempotencyKey: quotaEffectId },
                    );
                    break;

                default:
                    // NO se traga como éxito. Antes devolvía { skipped: true } y el
                    // bloque de abajo marcaba la ejecución como 'success': el
                    // registro de auditoría afirmaba que la automatización había
                    // corrido cuando no había hecho nada. Un tipo desconocido es
                    // una regla rota, y tiene que verse como rota.
                    throw new Error(`Tipo de accion desconocido: ${action.type}`);
            }

            // A provider response is a receipt. A missing response is not a
            // failure and never authorises another mutating HTTP request: it
            // remains visible for reconciliation. A conclusive non-2xx answer
            // is recorded as failed and likewise completes this BullMQ job.
            const terminalStatus = result?.outcome === 'unknown'
                ? 'reconciliation_required'
                : result?.outcome === 'rejected' ? 'failed' : 'success';

            // Actualizar registro de ejecucion con el resultado conocido
            if (executionId) {
                await this.prisma.executeInTenantSchema(
                    schemaName,
                    `UPDATE automation_executions
                     SET status = $2, finished_at = CURRENT_TIMESTAMP, result_json = $3::jsonb
                     WHERE id = $1::uuid`,
                    [executionId, terminalStatus, JSON.stringify(result || {})],
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
                         SET status = 'failed', finished_at = CURRENT_TIMESTAMP, result_json = $2::jsonb
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
     *
     * ═══ IT COMMITS A ROW NOW, AND THE ROW IS THE RECORD ═══
     *
     * This used to call `sendTemplate` on this worker's own stack. Three things
     * followed from that and none of them were visible from outside:
     *
     *   · a restart between the decision and the POST lost the message, and the
     *     execution row said `queued` for ever;
     *   · the queue add carries no `jobId`, so a retry after an ambiguous
     *     timeout sent the same template a second time — from October, a second
     *     charge on the tenant's own WABA;
     *   · nothing re-checked the rule. An operator who switched the rule off
     *     while the action sat in its delay (up to three days, for the seeded
     *     templates) still got the message, which is the one case they
     *     explicitly tried to prevent.
     *
     * The durable lane answers all three: the row commits before anything is
     * published, its origin is derived from the execution so two attempts
     * collide on one row, and the authority is revalidated against the rule
     * inside the transaction that grants the lease.
     */
    private async handleSendTemplate(
        tenantId: string,
        schemaName: string,
        executionId: string | undefined,
        ruleId: string,
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

        // WHICH of the tenant's numbers pays for this template.
        //
        // The rule wins over the event: a rule that names a connection is an
        // explicit decision by the business, and the one thing that can answer a
        // form lead, which arrived through no connection at all. Otherwise it is
        // the connection the customer actually wrote to.
        //
        // Both absent is left absent on purpose rather than defaulted: the
        // resolver serves it when the tenant has exactly one number and refuses
        // `connection_ambiguous` when it has several. Meta charges the business
        // per delivered service message from 1 October 2026, so guessing here
        // spends somebody's money on a decision nobody made.
        const fromPhoneNumberId = typeof action.channel_account_id === 'string'
            && action.channel_account_id.trim()
            ? action.channel_account_id.trim()
            // Only a WhatsApp conversation may lend its connection. An
            // Instagram lead carries an Instagram id, and handing that to the
            // WhatsApp resolver is how a send gets attributed to an account
            // that is not a WhatsApp account at all.
            : whatsappSenderFrom({
                channelType: event.channelAccountType ?? event.channel,
                channelAccountId: event.channelAccountId,
            });
        if (!fromPhoneNumberId) {
            const problem = senderOriginProblem({
                channelType: event.channelAccountType ?? event.channel,
                channelAccountId: event.channelAccountId,
            });
            // Actionable, not silent: an operator has to be able to tell
            // "the rule has no number" from "the rule sent from the wrong
            // number", and from outside those look identical.
            //
            // And it REFUSES now rather than sending unnamed. A durable row has
            // to name the account it will be billed to before the processor
            // picks it up; letting the resolver choose would put the oldest
            // connection on the row, which is a property of row order and not of
            // any decision anybody made.
            throw new Error(`automation_rule_action_sin_conexion:${problem ?? 'unknown'}`);
        }
        // The execution row is the rule firing's own durable identity, and the
        // origin is derived from it together with what this action sends. Two
        // attempts at the same action collide on one outbox row; two DIFFERENT
        // template actions in one rule stay two effects.
        if (!executionId) throw new Error('automation_rule_action_sin_ejecucion');
        const contactId = String(event.contactId ?? '').trim();
        if (!contactId) throw new Error('automation_rule_action_sin_contacto');

        const channelType = 'whatsapp';
        // Resolved against the SENDER, never taken from the event: the outbox
        // refuses a binding whose conversation belongs to another connection,
        // and a rule that overrides the number is precisely the case where the
        // event's own thread is the wrong one.
        const conversationId = await this.proactive.conversationFor(schemaName, {
            contactId, channelType, channelAccountId: fromPhoneNumberId,
        });
        if (!conversationId) throw new Error('automation_rule_action_sin_conversacion');

        // ── THE AUTHORITY, READ FROM THE RULE ───────────────────────────────
        //
        // Built by reading `automation_rules`, so the revision describes the
        // rule as it IS — active, with these actions. The store revalidates it
        // inside the transaction that grants the lease, which is what makes a
        // rule switched off during the action's delay a suppression instead of
        // a message nobody currently authorises.
        const operationalScope = await this.proactive.policyAuthority(schemaName, {
            tenantId, producer: 'automation_rule_action', channelType,
            channelAccountId: fromPhoneNumberId, entityId: ruleId,
        });
        if (!operationalScope) {
            // Switched off, edited, or gone. Nothing is owed, so the execution
            // is closed rather than retried every five seconds for three tries.
            this.logger.log(`[AutomationJobs] la regla ${ruleId} ya no autoriza `
                + `'${templateName}' — suprimido`);
            return { action: 'send_template', templateName, phone, suppressed: 'rule_no_longer_authorises' };
        }

        const result = await this.proactive.send(tenantId, {
            originKey: `automation_rule_action:${executionId}:${templateName}`
                + `:${JSON.stringify(components)}`,
            conversationId: String(conversationId),
            contactId,
            channelType,
            channelAccountId: fromPhoneNumberId,
            recipient: phone,
            items: [{ kind: 'template', payload: { templateName, language, components } }],
            operationalScope,
        });
        // Thrown, not returned. `process` writes `automation_executions.status =
        // 'success'` on whatever this returns, and an execution marked
        // successful for a message that was never committed is the same lie the
        // reminders used to tell about an appointment.
        if (!producerMayAdvance(result)) {
            throw new Error(`automation_rule_action_no_despachada:${result.kind}`
                + `:${'reason' in result ? result.reason : ''}`);
        }

        return {
            action: 'send_template',
            templateName,
            phone,
            dispatch: result.kind,
            originId: 'originId' in result ? result.originId : null,
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
