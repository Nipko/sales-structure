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
    ) {}

    listApprovals(input: {
        tenantId: string;
        status?: ToolApprovalStatus;
        limit?: number;
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
                await this.dispatchTenantEvents(tenant.schemaName, tenant.id);
            } catch (error: any) {
                this.logger.warn(`Approval recovery failed for tenant ${tenant.id}: ${error.message}`);
            }
        }
    }

    private async executeClaim(claim: ToolApprovalResumeClaim) {
        let result: Record<string, unknown>;
        try {
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

            const [conversationRows, tenant] = await Promise.all([
                typeof (this.prisma as any).executeInTenantSchema === 'function'
                    ? this.prisma.executeInTenantSchema<Array<{
                        channel_type: string | null;
                        channel_account_id: string | null;
                        agent_persona_id: string | null;
                    }>>(
                        claim.schemaName,
                        `SELECT channel_type, channel_account_id, agent_persona_id
                           FROM conversations WHERE id = $1::uuid LIMIT 1`,
                        [claim.conversationId],
                    )
                    : Promise.resolve([]),
                this.prisma.tenant.findUnique({
                    where: { id: claim.tenantId },
                    select: {
                        industry: true,
                        settings: true,
                        operatingCountry: true,
                    },
                }),
            ]);
            if (!tenant) {
                result = {
                    error: 'approval_tenant_unavailable',
                    message: 'La cuenta ya no está disponible. La acción no fue ejecutada.',
                    shouldHandoff: true,
                };
                return this.controls.finishApprovalResume(claim, result);
            }

            const conversation = conversationRows?.[0];
            const currentChannel = conversation?.channel_type || claim.channelType || 'whatsapp';
            let persona: Awaited<ReturnType<PersonaService['resolvePersonaForChannel']>>;
            if (conversation?.agent_persona_id) {
                const assigned = await this.personaService.getAgent(
                    claim.tenantId,
                    conversation.agent_persona_id,
                );
                if (!assigned || assigned.is_active === false || !assigned.config_json) {
                    result = {
                        error: 'approval_agent_unavailable',
                        message: 'El agente que solicitó la acción ya no está activo. La acción no fue ejecutada.',
                        shouldHandoff: true,
                    };
                    return this.controls.finishApprovalResume(claim, result);
                }
                persona = {
                    config: assigned.config_json,
                    agentId: String(assigned.id),
                    version: Number.isInteger(Number(assigned.version)) ? Number(assigned.version) : null,
                };
            } else {
                persona = await this.personaService.resolvePersonaForChannel(
                    claim.tenantId,
                    currentChannel,
                    conversation?.channel_account_id || undefined,
                );
            }

            const vertical = (tenant.settings as any)?.verticalConfig ?? {};
            const capability = await this.capabilityComposer.resolve({
                tenantId: claim.tenantId,
                schemaName: claim.schemaName,
                config: persona.config,
                industry: vertical.industry || persona.config.industry || tenant.industry,
                subType: vertical.subType ?? vertical.subtype,
                agentId: persona.agentId ?? undefined,
                role: 'tenant_agent',
                channelType: currentChannel,
                operatingCountry: tenant.operatingCountry ?? undefined,
                jurisdiction: tenant.operatingCountry ?? undefined,
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
        }
        return this.controls.finishApprovalResume(claim, result);
    }

    private async dispatchTenantEvents(schemaName: string, tenantId: string): Promise<void> {
        const outbox = await this.controls.claimApprovalOutboxEvents(schemaName, 25);
        for (const event of outbox) {
            const payload = {
                ...event.payload,
                tenantId,
                eventId: event.id,
                eventType: event.eventType,
            };
            try {
                await this.events.emitAsync(event.eventType, payload);
                await this.events.emitAsync('tool.approval.notification', payload);
                await this.controls.finishApprovalOutboxEvent(schemaName, event);
            } catch (error) {
                await this.controls.finishApprovalOutboxEvent(schemaName, event, error);
            }
        }
    }
}
