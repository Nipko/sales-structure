import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { CronLockService } from '../redis/cron-lock.service';
import { AIToolExecutorService } from './ai-tool-executor.service';
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
            result = await this.executor.execute(
                claim.schemaName,
                claim.tenantId,
                claim.contactId,
                claim.toolName,
                claim.args,
                claim.conversationId,
                { channelType: claim.channelType },
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
