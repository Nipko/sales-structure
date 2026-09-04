import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AgentQualityService } from './agent-quality.service';
import { QualityService } from './quality.service';
import { AgentQualitySignalService } from './agent-quality-signal.service';
import type { AgentQualitySignalState } from '@parallext/shared';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Controller('quality')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
export class QualityController {
    constructor(
        private readonly quality: QualityService,
        private readonly agentQuality: AgentQualityService,
        private readonly qualitySignals: AgentQualitySignalService,
    ) {}

    private resolveRange(start?: string, end?: string): { startDate: string; endDate: string } {
        if (start && end) return { startDate: start, endDate: end };
        const endDate = new Date();
        const startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
        return { startDate: startDate.toISOString(), endDate: endDate.toISOString() };
    }

    @Get(':tenantId/agents')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    async listAgents(@Param('tenantId') tenantId: string) {
        const data = await this.agentQuality.listAgents(tenantId);
        return { success: true, data };
    }

    @Get(':tenantId/agents/:agentId/overview')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    async getAgentOverview(
        @Param('tenantId') tenantId: string,
        @Param('agentId') agentId: string,
    ) {
        const data = await this.agentQuality.getOverview(tenantId, agentId);
        return { success: true, data };
    }

    @Get(':tenantId/attention-summary')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    async getAttentionSummary(@Param('tenantId') tenantId: string) {
        const data = await this.qualitySignals.getAttentionSummary(tenantId);
        return { success: true, data };
    }

    @Post(':tenantId/reconcile')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    async reconcileAttention(@Param('tenantId') tenantId: string) {
        const data = await this.qualitySignals.reconcileTenantManual(tenantId);
        return { success: true, data };
    }

    @Get(':tenantId/signals')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    async getSignals(
        @Param('tenantId') tenantId: string,
        @Query('state') state?: AgentQualitySignalState,
        @Query('limit') limit?: string,
    ) {
        const data = await this.qualitySignals.getSignals(
            tenantId,
            state || 'open',
            parseInt(limit || '50', 10) || 50,
        );
        return { success: true, data };
    }

    /**
     * One still-open signal, so a surface that only holds an id (Assist, a
     * guided tour, a deep link that was bookmarked) can show what the alert
     * actually says instead of restating the code. Declared BEFORE the
     * `:tenantId` catch-all below so Nest reaches it.
     *
     * `agentId` is required: the signal lookup is scoped by both ids, so a
     * guessed signal UUID cannot surface another agent's evidence.
     */
    @Get(':tenantId/signals/:signalId')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    async getSignal(
        @Param('tenantId') tenantId: string,
        @Param('signalId') signalId: string,
        @Query('agentId') agentId?: string,
    ) {
        if (!agentId || !UUID_PATTERN.test(agentId)) {
            throw new BadRequestException('agentId is required and must be a UUID');
        }
        const data = await this.qualitySignals.getActiveSignal(tenantId, signalId, agentId);
        return { success: true, data };
    }

    @Post(':tenantId/signals/:signalId/acknowledge')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    async acknowledgeSignal(
        @Param('tenantId') tenantId: string,
        @Param('signalId') signalId: string,
        @Req() req: any,
    ) {
        const data = await this.qualitySignals.acknowledgeSignal(
            tenantId,
            signalId,
            req.user?.sub || req.user?.id,
        );
        return { success: true, data };
    }

    @Post(':tenantId/signals/:signalId/snooze')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    async snoozeSignal(
        @Param('tenantId') tenantId: string,
        @Param('signalId') signalId: string,
        @Body() body: { until?: string; durationHours?: number },
        @Req() req: any,
    ) {
        const data = await this.qualitySignals.snoozeSignal(
            tenantId,
            signalId,
            req.user?.sub || req.user?.id,
            body || {},
        );
        return { success: true, data };
    }

    @Get(':tenantId')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    async getSummary(
        @Param('tenantId') tenantId: string,
        @Query('start') start?: string,
        @Query('end') end?: string,
    ) {
        const { startDate, endDate } = this.resolveRange(start, end);
        const data = await this.quality.getQualitySummary(tenantId, startDate, endDate);
        return { success: true, data };
    }

    @Get(':tenantId/flagged')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    async getFlagged(
        @Param('tenantId') tenantId: string,
        @Query('start') start?: string,
        @Query('end') end?: string,
        @Query('limit') limit?: string,
    ) {
        const { startDate, endDate } = this.resolveRange(start, end);
        const data = await this.quality.getFlagged(tenantId, startDate, endDate, parseInt(limit || '50') || 50);
        return { success: true, data };
    }
}
