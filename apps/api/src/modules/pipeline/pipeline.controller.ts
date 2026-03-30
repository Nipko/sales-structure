import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { PipelineService } from './pipeline.service';
import { AutomationService } from './automation.service';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';

@Controller('pipeline')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
@ApiBearerAuth()
export class PipelineController {
    constructor(
        private pipelineService: PipelineService,
        private automationService: AutomationService,
    ) {}

    // ---- Kanban ----

    @Get('kanban/:tenantId')
    async getKanban(@Param('tenantId') tenantId: string) {
        const kanban = await this.pipelineService.getKanban(tenantId);
        return { success: true, data: kanban };
    }

    // ---- Stages ----

    @Get('stages/:tenantId')
    async getStages(@Param('tenantId') tenantId: string) {
        const stages = await this.pipelineService.getStages(tenantId);
        return { success: true, data: stages };
    }

    @Post('stages/:tenantId')
    async createStage(
        @Param('tenantId') tenantId: string,
        @Body() body: {
            name: string; color: string; defaultProbability?: number;
            slug?: string; slaHours?: number; isTerminal?: boolean;
        },
    ) {
        await this.pipelineService.createStage(tenantId, body);
        return { success: true, message: 'Stage created' };
    }

    // ---- Deals ----

    @Get('deals/:tenantId')
    async getDeals(
        @Param('tenantId') tenantId: string,
        @Query('stageId') stageId?: string,
        @Query('status') status?: string,
        @Query('assignedAgentId') assignedAgentId?: string,
        @Query('slaStatus') slaStatus?: 'on_track' | 'at_risk' | 'breached',
    ) {
        const deals = await this.pipelineService.getDeals(tenantId, {
            stageId, status, assignedAgentId, slaStatus,
        });
        return { success: true, data: deals };
    }

    @Get('deals/:tenantId/:dealId')
    async getDealDetail(
        @Param('tenantId') tenantId: string,
        @Param('dealId') dealId: string,
    ) {
        const detail = await this.pipelineService.getDealDetail(tenantId, dealId);
        if (!detail) return { success: false, message: 'Deal not found' };
        return { success: true, data: detail };
    }

    @Post('deals/:tenantId')
    async createDeal(
        @Param('tenantId') tenantId: string,
        @Body() body: {
            contactId: string; title: string; value: number; stageId: string;
            probability?: number; expectedCloseDate?: string; assignedAgentId?: string; notes?: string;
        },
    ) {
        const deal = await this.pipelineService.createDeal(tenantId, body);
        return { success: true, data: deal };
    }

    @Put('deals/:tenantId/:dealId/move')
    async moveDeal(
        @Param('tenantId') tenantId: string,
        @Param('dealId') dealId: string,
        @Body() body: { stageId: string; agentId?: string; reason?: string },
    ) {
        await this.pipelineService.moveToStage(tenantId, dealId, body.stageId, body.agentId, body.reason);
        return { success: true, message: 'Deal moved' };
    }

    @Put('deals/:tenantId/:dealId')
    async updateDeal(
        @Param('tenantId') tenantId: string,
        @Param('dealId') dealId: string,
        @Body() body: any,
    ) {
        await this.pipelineService.updateDeal(tenantId, dealId, body);
        return { success: true, message: 'Deal updated' };
    }

    // ---- Analytics ----

    @Get('analytics/:tenantId')
    async getStageAnalytics(@Param('tenantId') tenantId: string) {
        const analytics = await this.pipelineService.getStageAnalytics(tenantId);
        return { success: true, data: analytics };
    }

    @Get('sla-violations/:tenantId')
    async getSLAViolations(@Param('tenantId') tenantId: string) {
        const deals = await this.pipelineService.getDeals(tenantId, { slaStatus: 'breached' });
        return { success: true, data: deals };
    }

    // ---- Automation Rules ----

    @Get('automation/:tenantId')
    async getRules(@Param('tenantId') tenantId: string) {
        const rules = await this.automationService.getRules(tenantId);
        return { success: true, data: rules };
    }

    @Post('automation/:tenantId')
    async createRule(
        @Param('tenantId') tenantId: string,
        @Body() body: {
            name: string; type: string; trigger: string;
            conditions: Record<string, any>; actions: Record<string, any>;
        },
    ) {
        const rule = await this.automationService.createRule(tenantId, body);
        return { success: true, data: rule };
    }

    @Put('automation/:tenantId/:ruleId/toggle')
    async toggleRule(
        @Param('tenantId') tenantId: string,
        @Param('ruleId') ruleId: string,
        @Body() body: { isActive: boolean },
    ) {
        await this.automationService.toggleRule(tenantId, ruleId, body.isActive);
        return { success: true, message: 'Rule toggled' };
    }

    @Delete('automation/:tenantId/:ruleId')
    async deleteRule(
        @Param('tenantId') tenantId: string,
        @Param('ruleId') ruleId: string,
    ) {
        await this.automationService.deleteRule(tenantId, ruleId);
        return { success: true, message: 'Rule deleted' };
    }

    @Get('automation/:tenantId/sla-violations')
    async getAutomationSLAViolations(@Param('tenantId') tenantId: string) {
        const violations = await this.automationService.checkSLAViolations(tenantId);
        return { success: true, data: violations };
    }
}
