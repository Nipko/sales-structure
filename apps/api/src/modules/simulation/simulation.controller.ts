import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/tenant.decorator';
import { SimulationService } from './simulation.service';

interface RunSimulationDto {
    agentId?: string;
    channelType?: string;
    scenarioSource?: 'synthetic' | 'replay';
    count?: number;
    vertical?: string;
    baselineRunId?: string;
}

/**
 * Agent Simulation pre-deploy (T2.13) — "CI/CD for your AI agent".
 * Runs N simulated conversations against the live persona/KB (without ever
 * touching production) and grades them with the QA LLM-judge, plus regression
 * diff vs a baseline run.
 */
@Controller('simulation')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
export class SimulationController {
    constructor(private readonly simulation: SimulationService) {}

    @Post(':tenantId/run')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    async run(
        @Param('tenantId') tenantId: string,
        @Body() body: RunSimulationDto,
        @CurrentUser('email') email?: string,
    ) {
        const data = await this.simulation.startRun(tenantId, {
            agentId: body.agentId,
            channelType: body.channelType,
            scenarioSource: body.scenarioSource === 'replay' ? 'replay' : 'synthetic',
            count: body.count,
            vertical: body.vertical,
            baselineRunId: body.baselineRunId,
            createdBy: email,
        });
        return { success: true, data };
    }

    @Get(':tenantId')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    async list(@Param('tenantId') tenantId: string, @Query('limit') limit?: string) {
        const data = await this.simulation.listRuns(tenantId, parseInt(limit || '20') || 20);
        return { success: true, data };
    }

    @Get(':tenantId/:runId')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    async get(@Param('tenantId') tenantId: string, @Param('runId') runId: string) {
        const data = await this.simulation.getRun(tenantId, runId);
        return { success: true, data };
    }
}
