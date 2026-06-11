import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { EvalService, EvalScenarioInput } from './eval.service';

/**
 * Eval gate (#2) — a curated golden set run through the agent + LLM-judge, used
 * as a quality gate before activating/deploying an agent change.
 */
@Controller('eval')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
export class EvalController {
    constructor(private readonly evals: EvalService) {}

    @Get(':tenantId/scenarios')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    async list(@Param('tenantId') tenantId: string) {
        return { success: true, data: await this.evals.listScenarios(tenantId) };
    }

    @Post(':tenantId/scenarios')
    @Roles('super_admin', 'tenant_admin')
    async add(@Param('tenantId') tenantId: string, @Body() body: EvalScenarioInput) {
        await this.evals.addScenario(tenantId, body);
        return { success: true };
    }

    @Delete(':tenantId/scenarios/:id')
    @Roles('super_admin', 'tenant_admin')
    async remove(@Param('tenantId') tenantId: string, @Param('id') id: string) {
        await this.evals.deleteScenario(tenantId, id);
        return { success: true };
    }

    @Post(':tenantId/run')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    async run(@Param('tenantId') tenantId: string, @Body() body: { agentId: string; threshold?: number }) {
        return { success: true, data: await this.evals.runGate(tenantId, body.agentId, body.threshold) };
    }

    /** τ²-style gate: action verification (sandbox + evalMode) + pass^k. Manual trigger. */
    @Post(':tenantId/run-actions')
    @Roles('super_admin', 'tenant_admin')
    async runActions(
        @Param('tenantId') tenantId: string,
        @Body() body: { agentId: string; threshold?: number; k?: number; passPolicy?: 'all' | 'majority'; activationThreshold?: number },
    ) {
        return { success: true, data: await this.evals.runGateV2(tenantId, body.agentId, body) };
    }

    @Get(':tenantId/runs')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    async runs(@Param('tenantId') tenantId: string, @Query('agentId') agentId?: string) {
        return { success: true, data: await this.evals.listRuns(tenantId, agentId) };
    }
}
