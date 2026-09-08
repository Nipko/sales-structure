import { BadRequestException, Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { DispatchRolloutService } from './dispatch-rollout.service';
import { AgentDispatchOutboxStore } from './agent-dispatch-outbox.store';
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
            throw new BadRequestException(String(error?.message || 'dispatch_rollout_invalid'));
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
        try {
            const row = await this.outbox.resolve(tenantId, {
                dispatchId,
                resolution: String(body?.resolution || '') as DispatchResolution,
                evidence: String(body?.evidence || ''),
                receipt: body?.receipt ?? null,
                actorId: request?.user?.id ?? null,
            });
            await this.prisma.auditLog.create({
                data: {
                    tenantId,
                    userId: request?.user?.id ?? null,
                    action: 'dispatch.reconciliation.resolved',
                    resource: dispatchId,
                    details: JSON.parse(JSON.stringify({ resolution: body?.resolution,
                        evidence: String(body?.evidence || '').slice(0, 500),
                        receipt: body?.receipt ?? null, resultingState: row.state,
                        actorEmail: request?.user?.email ?? null })),
                },
            }).catch(() => undefined);
            return { success: true, data: row };
        } catch (error: any) {
            throw new BadRequestException(String(error?.code || error?.message || 'dispatch_resolution_failed'));
        }
    }

    @Post('disable')
    @ApiOperation({ summary: 'Turn the durable dispatch off for everyone (super_admin only)' })
    async disable(@Req() request: any) {
        return { success: true, data: await this.rollout.disable({
            userId: request?.user?.id ?? null, email: request?.user?.email ?? null }) };
    }
}
