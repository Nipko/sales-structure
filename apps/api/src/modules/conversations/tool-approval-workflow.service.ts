import { ToolApprovalEffectsService } from './tool-approval-effects.service';
import { servedAgentAuthority, sameServedAgentAuthority, validServedAgentAuthority } from '../persona/served-agent-authority';
import { readServingPersona } from '../persona/serving-persona';
import { APPROVAL_EFFECTS_EVENT } from './tool-approval-effects.contracts';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Cron } from '@nestjs/schedule';
import { decideToolAuthority } from '@parallext/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CronLockService } from '../redis/cron-lock.service';
import { PersonaService } from '../persona/persona.service';
import { AIToolExecutorService } from './ai-tool-executor.service';
import { TurnCapabilityComposerService } from './turn-capability-composer.service';
import { isNonCommittalTool } from './tool-policy-registry';
import {
    ToolExecutionControlService,
    type ToolApprovalListItem,
    type ToolApprovalResumeClaim,
    type ToolApprovalResumeClaimResult,
    type ToolApprovalStatus,
} from './tool-execution-control.service';

const MAX_RESUMES_PER_TENANT_RUN = 25;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

/**
 * Durable A4 workflow boundary. Human decisions, execution resume and UI
 * notifications are all recoverable from tenant ledgers/outboxes after a
 * process crash; no approval ticket identifier is sent through the LLM path.
 */
@Injectable()
export class ToolApprovalWorkflowService {
    private readonly logger = new Logger(ToolApprovalWorkflowService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly controls: ToolExecutionControlService,
        private readonly executor: AIToolExecutorService,
        private readonly events: EventEmitter2,
        private readonly cronLock: CronLockService,
        @Optional() private readonly capabilityComposer?: TurnCapabilityComposerService,
        @Optional() private readonly personaService?: PersonaService,
        @Optional() private readonly approvalEffects?: ToolApprovalEffectsService,
    ) {}

    listApprovals(input: {
        tenantId: string;
        status?: ToolApprovalStatus;
        limit?: number;
        conversationId?: string;
    }): Promise<ToolApprovalListItem[]> {
        return this.controls.listApprovalTickets(input);
    }

    async decide(input: {
        tenantId: string;
        ticketId: string;
        actorId: string;
        decision: 'approved' | 'rejected';
        reason?: string;
    }) {
        const decision = await this.controls.decideApprovalTicket(input);

        // Publish the durable requested/decision events before running the
        // approved action. A crash at any point leaves the outbox reclaimable.
        await this.dispatchTenantEvents(decision.schemaName, input.tenantId).catch((error) => {
            this.logger.warn(`Approval event dispatch deferred for ${input.tenantId}: ${error.message}`);
        });

        const resume = input.decision === 'approved'
            ? await this.resumeApprovedTicket(input.tenantId, input.ticketId)
            : {
                state: 'completed' as const,
                result: {
                    error: 'approval_rejected',
                    message: 'Una persona autorizada rechazó la acción.',
                },
            };

        await this.dispatchTenantEvents(decision.schemaName, input.tenantId).catch((error) => {
            this.logger.warn(`Approval result dispatch deferred for ${input.tenantId}: ${error.message}`);
        });
        return { ...decision, resume };
    }

    async resumeApprovedTicket(
        tenantId: string,
        ticketId: string,
    ): Promise<ToolApprovalResumeClaimResult | {
        state: 'completed' | 'pending' | 'in_progress';
        result: Record<string, unknown>;
    }> {
        const claimed = await this.controls.claimApprovalResume({ tenantId, ticketId });
        if (claimed.state !== 'claimed') return claimed;
        return this.executeClaim(claimed.claim);
    }

    @Cron('19 * * * * *')
    async recoverCron(): Promise<void> {
        await this.cronLock.runExclusive(
            'tool-approval.recover',
            50,
            () => this.recoverAllTenants(),
            { prefer: 'api' },
        );
    }

    async recoverAllTenants(): Promise<void> {
        const tenants = await this.prisma.tenant.findMany({
            where: { isActive: true },
            select: { id: true, schemaName: true },
        });
        for (const tenant of tenants) {
            try {
                await this.controls.expirePendingApprovalTickets(tenant.schemaName);
                await this.controls.reconcileExpiredExecutionLeases(tenant.schemaName);
                for (let i = 0; i < MAX_RESUMES_PER_TENANT_RUN; i += 1) {
                    const claimed = await this.controls.claimApprovalResume({ tenantId: tenant.id });
                    if (claimed.state !== 'claimed') break;
                    await this.executeClaim(claimed.claim);
                }
                await this.approvalEffects?.recoverTenant(tenant.id);
                await this.dispatchTenantEvents(tenant.schemaName, tenant.id);
            } catch (error: any) {
                this.logger.warn(`Approval recovery failed for tenant ${tenant.id}: ${error.message}`);
            }
        }
    }

    private async executeClaim(claim: ToolApprovalResumeClaim) {
        const withoutFinalization = (result: Record<string, unknown>) => ({
            state: 'in_progress' as const,
            result: { ...result, persisted: false, controlBlocked: true },
        });
        // The finalizer itself opens claim.schemaName. Until ownership is
        // established, leave its lease to recovery by the legitimate owner.
        if (!claim || ![claim.tenantId, claim.ticketId, claim.leaseToken, claim.contactId, claim.conversationId]
            .every(id => typeof id === 'string' && UUID.test(id))
            || typeof claim.schemaName !== 'string' || !/^[a-z][a-z0-9_]*$/.test(claim.schemaName)) {
            return withoutFinalization({ error: 'approval_context_invalid' });
        }
        let tenantMappingVerified = false;
        let result: Record<string, unknown>;
        try {
            const tenant = await this.prisma.tenant.findUnique({
                where: { id: claim.tenantId },
                select: { schemaName: true, isActive: true, industry: true, settings: true, operatingCountry: true },
            });
            if (!tenant || tenant.schemaName !== claim.schemaName) {
                return withoutFinalization({ error: 'approval_tenant_unavailable' });
            }
            tenantMappingVerified = true;
            if (!tenant.isActive) {
                return this.controls.finishApprovalResume(claim, {
                    error: 'approval_tenant_unavailable',
                    message: 'La cuenta ya no está disponible. La acción no fue ejecutada.',
                    shouldHandoff: true,
                });
            }
            // A human decision authorises the ticket, not an obsolete tenant
            // configuration. Rebuild the same complete contract production
            // uses immediately before the side effect. This catches plan
            // downgrades, STOP profiles, owner subpermission changes, provider
            // outages and revoked MCP approval that happened while the ticket
            // was waiting in the queue.
            if (!this.capabilityComposer || !this.personaService) {
                result = {
                    error: 'approval_authority_unavailable',
                    message: 'La autorización vigente no se pudo verificar. La acción no fue ejecutada.',
                    shouldHandoff: true,
                };
                return this.controls.finishApprovalResume(claim, result);
            }

            // Only the private provenance loaded from the ledger is authority.
            // Older tickets without a hash cannot be upgraded from current
            // routing or model arguments; they require a fresh proposal.
            if (!validServedAgentAuthority(claim.operationalScope, claim.schemaName, claim.tenantId)) {
                return this.controls.finishApprovalResume(claim, {
                    error: 'agent_operational_revision_changed', persisted: false, controlBlocked: true,
                    message: 'La propuesta no conserva su versión de origen. Prepara una nueva propuesta.',
                });
            }

            // The global lookup above is only a precheck. Resolve the context
            // under one short mapping lock, using production's pure selector.
            // No bootstrap, provider call or effect runs inside this transaction.
            const context = await this.prisma.transactionInTenantSchema(claim.schemaName, async query => {
                await query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))::text', [`agent-privacy:${claim.schemaName}`]);
                const [owner] = await query<any[]>(`SELECT t.id,t.schema_name AS "schemaName",t.is_active AS "isActive",
                    to_jsonb(t)->>'industry' AS industry,to_jsonb(t)->'settings' AS settings,
                    to_jsonb(t)->>'operating_country' AS "operatingCountry"
                    FROM public.tenants t WHERE t.id=$1::uuid AND t.schema_name=$2 FOR SHARE`, [claim.tenantId, claim.schemaName]);
                if (!owner) return { state: 'owner_changed' as const };
                if (!owner.isActive) return { state: 'inactive' as const };
                const [conversation] = await query<Array<{
                    channel_type: string | null; channel_account_id: string | null; contact_id: string | null;
                }>>(`SELECT channel_type, channel_account_id, contact_id
                    FROM conversations WHERE id = $1::uuid LIMIT 1`, [claim.conversationId]);
                if (!conversation || conversation.contact_id !== claim.contactId || !conversation.channel_type
                    || !conversation.channel_account_id || (claim.channelType && claim.channelType !== conversation.channel_type))
                    return { state: 'context_changed' as const };
                const persona = await readServingPersona(query, conversation.channel_type, conversation.channel_account_id);
                return { state: 'resolved' as const, owner, conversation, persona };
            });
            if (context.state === 'owner_changed') return withoutFinalization({ error: 'approval_tenant_unavailable' });
            if (context.state === 'inactive') return this.controls.finishApprovalResume(claim, { error: 'approval_tenant_unavailable' });
            if (context.state === 'context_changed') {
                return this.controls.finishApprovalResume(claim, {
                    error: 'approval_context_changed', persisted: false, controlBlocked: true,
                    message: 'La conversación o su conexión cambió. Prepara una nueva propuesta.',
                });
            }
            const { conversation, persona, owner } = context;
            const currentChannel = conversation.channel_type!;
            // Conversation attribution records the FIRST agent for analytics.
            // Resolve the current connection with the production routing rules,
            // then require that it is still the exact proposal's agent/version.
            // The resolver only permits legacy config while no durable agents exist.
            if(!persona.config)return this.controls.finishApprovalResume(claim,{
                error:'approval_agent_unavailable',message:'El agente ya no está activo. La acción no fue ejecutada.',
            });
            const vertical = (owner.settings as any)?.verticalConfig ?? {};
            const currentScope = servedAgentAuthority(claim.tenantId, claim.schemaName, persona);
            if (!sameServedAgentAuthority(claim.operationalScope, currentScope)) {
                return this.controls.finishApprovalResume(claim, {
                    error: 'agent_operational_revision_changed', persisted: false, controlBlocked: true,
                    message: 'El agente cambió o la propuesta no conserva su versión de origen. Prepara una nueva propuesta.',
                });
            }
            if (claim.draftReview && (persona.agentId !== claim.draftReview.agentId
                || persona.version !== claim.draftReview.agentVersion)) {
                return this.controls.finishApprovalResume(claim, {
                    error: 'draft_revision_changed',
                    message: 'El agente cambió después de revisar la propuesta. La acción no fue ejecutada.',
                });
            }
            const capability = await this.capabilityComposer.resolve({
                tenantId: claim.tenantId,
                schemaName: claim.schemaName,
                config: persona.config,
                industry: vertical.industry || persona.config.industry || owner.industry,
                subType: vertical.subType ?? vertical.subtype,
                agentId: persona.agentId ?? undefined,
                role: 'tenant_agent',
                channelType: currentChannel,
                operatingCountry: owner.operatingCountry ?? undefined,
                jurisdiction: owner.operatingCountry ?? undefined,
            });
            const currentDecision = decideToolAuthority(capability.authority, claim.toolName, {
                isNonCommittal: isNonCommittalTool(claim.toolName),
            });
            if (!currentDecision.allowed) {
                result = {
                    error: 'approval_authority_revoked',
                    reason: currentDecision.reason || capability.status.reason || 'not_authorised',
                    message: 'La acción aprobada ya no está autorizada por la configuración vigente y no fue ejecutada.',
                    shouldHandoff: true,
                };
                return this.controls.finishApprovalResume(claim, result);
            }

            result = await this.executor.execute(
                claim.schemaName,
                claim.tenantId,
                claim.contactId,
                claim.toolName,
                claim.args,
                claim.conversationId,
                {
                    // The ticket satisfies the A4 human-approval policy; the
                    // current composed contract decides whether the operation
                    // still exists at all. It is deliberately not widened to a
                    // fresh one-tool authority invented from the old ticket.
                    authority: capability.authority,
                    operationalScope: claim.operationalScope,
                    channelType: currentChannel,
                },
            );
            if (!result || typeof result !== 'object' || Array.isArray(result)) {
                result = { error: 'approval_resume_invalid_result' };
            }
        } catch (error: any) {
            this.logger.error(`Approved tool resume failed for ticket ${claim.ticketId}: ${error.message}`);
            result = {
                error: 'approval_resume_failed',
                message: 'No se pudo reanudar la acción aprobada en este momento.',
            };
            if (!tenantMappingVerified) return withoutFinalization(result);
        }
        return this.controls.finishApprovalResume(claim, result);
    }

    private async dispatchTenantEvents(schemaName: string, tenantId: string): Promise<void> {
        const outbox = await this.controls.claimApprovalOutboxEvents(schemaName, 25);
        for (const event of outbox) {
            try {
                await this.controls.publishApprovalOutboxEvent(schemaName,event,async currentPayload=>{
                    if (event.eventType === APPROVAL_EFFECTS_EVENT) {
                        if (!this.approvalEffects) throw new Error('approval_effect_delivery_unavailable');
                        await this.approvalEffects.schedule(tenantId, String(currentPayload.ticketId || ''));
                    }
                    const payload={...currentPayload,tenantId,eventId:event.id,eventType:event.eventType};
                    await this.events.emitAsync(event.eventType, payload);
                    await this.events.emitAsync('tool.approval.notification', payload);
                });
                await this.controls.finishApprovalOutboxEvent(schemaName, event);
            } catch (error) {
                await this.controls.finishApprovalOutboxEvent(schemaName, event, error);
            }
        }
    }
}
