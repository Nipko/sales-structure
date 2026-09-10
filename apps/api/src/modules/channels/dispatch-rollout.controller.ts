import { BadRequestException, Body, ConflictException, Controller, Get, Logger, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { DispatchRolloutService } from './dispatch-rollout.service';
import { AgentDispatchOutboxStore } from './agent-dispatch-outbox.store';
import type { DispatchResolutionRecord } from './agent-dispatch-outbox';
import { PrismaService } from '../prisma/prisma.service';
import { DISPATCH_RECONCILIATION_SLA_SECONDS, type DispatchResolution } from './agent-dispatch-outbox';

/**
 * The operator's view of the durable dispatch switch.
 *
 * A kill switch nobody can read is not one. These endpoints exist so the state
 * can be inspected, changed deliberately, and turned off in a single call — with
 * the change audited and effective at once rather than after a cache expires.
 *
 * super_admin only, and platform-wide by design: this decides how replies leave
 * the system, which is never a tenant's own setting.
 */
@ApiTags('Dispatch rollout')
@Controller('dispatch-rollout')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('super_admin')
export class DispatchRolloutController {
    constructor(
        private readonly rollout: DispatchRolloutService,
        private readonly outbox: AgentDispatchOutboxStore,
        private readonly prisma: PrismaService,
    ) {}

    private readonly logger = new Logger(DispatchRolloutController.name);

    @Get()
    @ApiOperation({ summary: 'Effective durable dispatch rollout state (super_admin only)' })
    async state() {
        return { success: true, data: await this.rollout.state() };
    }

    @Put()
    @ApiOperation({ summary: 'Update the durable dispatch rollout (super_admin only)' })
    async set(@Body() body: any, @Req() request: any) {
        try {
            return { success: true, data: await this.rollout.set(body, {
                userId: request?.user?.id ?? null, email: request?.user?.email ?? null }) };
        } catch (error: any) {
            // A refused configuration is an operator mistake to surface now, not
            // a value to store and quietly ignore later.
            // The code goes in `error`, like every other refusal here: leaving it
            // in `message` hands a client reading `errorCode` the string
            // "Bad Request" and nothing it can act on.
            throw new BadRequestException({ error: String(error?.message || 'dispatch_rollout_invalid') });
        }
    }

    /**
     * The reconciliation queue for one tenant.
     *
     * `reconciliation_required` used to end in a log line. These effects may have
     * reached the customer or may not have, and only a person looking at the
     * provider can say which — so the queue has to be visible, searchable by
     * receipt or binding, and resolvable.
     */
    @Get('reconciliation/:tenantId')
    @ApiOperation({ summary: 'Uncertain dispatch effects awaiting a decision (super_admin only)' })
    async reconciliation(@Param('tenantId') tenantId: string, @Query('search') search?: string,
        @Query('limit') limit?: string) {
        const [entries, backlog] = await Promise.all([
            this.outbox.reconciliation(tenantId, { search: search ?? null, limit: Number(limit) || 50 }),
            this.outbox.backlog(tenantId),
        ]);
        return { success: true, data: { entries, backlog, slaSeconds: DISPATCH_RECONCILIATION_SLA_SECONDS } };
    }

    /**
     * Re-run the copies a previous export never completed.
     *
     * Declared BEFORE the `:dispatchId` route on purpose: Nest matches in
     * declaration order, so a parameter placed first swallows every literal
     * segment after it and this endpoint answers `dispatch_invalid_reference`
     * for a path that never reaches it.
     *
     * Nothing is lost while they wait — the decision, its author and its
     * evidence are in the tenant schema — but an operator asking "who resolved
     * this" looks in the platform log, so the copies have to be catchable up.
     */
    @Post('reconciliation/:tenantId/export')
    @ApiOperation({ summary: 'Copy pending reconciliation decisions into the audit log (super_admin only)' })
    async exportPending(@Param('tenantId') tenantId: string, @Req() request: any) {
        const pending = await this.outbox.unexportedResolutions(tenantId, 200);
        for (const resolution of pending) {
            await this.exportResolution(tenantId, resolution, request?.user?.email ?? null);
        }
        const remaining = await this.outbox.unexportedResolutions(tenantId, 200);
        return { success: true, data: { attempted: pending.length, remaining: remaining.length } };
    }

    /**
     * Record what a person found out.
     *
     * `retry` is the only resolution that can produce another request, and it
     * demands written evidence that the effect did not happen — silence is
     * exactly what this state means, so it can never be the justification.
     */
    @Post('reconciliation/:tenantId/:dispatchId')
    @ApiOperation({ summary: 'Resolve an uncertain dispatch effect (super_admin only)' })
    async resolve(@Param('tenantId') tenantId: string, @Param('dispatchId') dispatchId: string,
        @Body() body: any, @Req() request: any) {
        let settled;
        try {
            settled = await this.outbox.resolve(tenantId, {
                dispatchId,
                resolution: String(body?.resolution || '') as DispatchResolution,
                evidence: String(body?.evidence || ''),
                receipt: body?.receipt ?? null,
                actorId: request?.user?.id ?? request?.user?.sub ?? null,
                actorRole: request?.user?.role ?? null,
            });
        } catch (error: any) {
            const code = String(error?.code || error?.message || 'dispatch_resolution_failed');
            // A row that settled between the read and the decision is not a
            // malformed request; somebody else got there first, and the surface
            // has to be able to tell those apart to say the right thing.
            if (code.startsWith('dispatch_not_reconcilable')) throw new ConflictException({ error: code });
            throw new BadRequestException({ error: code });
        }
        // The decision itself already committed with the state change. This is
        // its copy in the platform-wide log, and losing it loses a duplicate,
        // not the record — the row keeps `exported_at` null and can be drained
        // again.
        await this.exportResolution(tenantId, settled.resolution, request?.user?.email ?? null);
        return { success: true, data: { ...settled.row, resolution: settled.resolution } };
    }

    /**
     * Copy one tenant decision into `public.audit_logs`.
     *
     * The audit row used to be the ONLY record of who resolved an uncertain
     * effect, written after the transaction and with its failure discarded — so
     * an irreversible decision could exist with no author at all. Now it is a
     * projection of a durable row, and a failure here is visible and retryable.
     */
    private async exportResolution(tenantId: string, resolution: DispatchResolutionRecord,
        actorEmail: string | null): Promise<void> {
        try {
            await this.prisma.auditLog.create({
                data: {
                    tenantId,
                    userId: resolution.actorId,
                    action: 'dispatch.reconciliation.resolved',
                    resource: resolution.dispatchId,
                    details: JSON.parse(JSON.stringify({
                        resolutionId: resolution.id, resolution: resolution.resolution,
                        evidence: resolution.evidence, receipt: resolution.receipt,
                        previousState: resolution.previousState, previousErrorCode: resolution.previousErrorCode,
                        resultingState: resolution.newState, actorRole: resolution.actorRole, actorEmail,
                    })),
                },
            });
            await this.outbox.markResolutionExported(tenantId, resolution.id);
        } catch (error: any) {
            this.logger.error(`[Dispatch] audit copy of resolution ${resolution.id} deferred: ${error?.message}`);
        }
    }

    @Post('disable')
    @ApiOperation({ summary: 'Turn the durable dispatch off for everyone (super_admin only)' })
    async disable(@Req() request: any) {
        return { success: true, data: await this.rollout.disable({
            userId: request?.user?.id ?? null, email: request?.user?.email ?? null }) };
    }
}
