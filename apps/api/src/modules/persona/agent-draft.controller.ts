import { Body, Controller, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { AgentDraftService } from './agent-draft.service';
import type { SaveAgentDraftRequest, DiscardAgentDraftRequest } from '@parallext/shared';

@ApiTags('persona')
@Controller('persona/:tenantId/agents/:agentId/configuration')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
@ApiBearerAuth()
export class AgentDraftController {
    constructor(private readonly drafts: AgentDraftService) {}

    @Get()
    @Roles('tenant_admin', 'tenant_supervisor')
    @ApiOperation({ summary: 'Read the operational configuration and its current editable revision' })
    async read(@Param('tenantId') tenantId: string, @Param('agentId') agentId: string, @Req() req: any) {
        return { success: true, data: await this.drafts.read(tenantId, agentId, { id: req.user?.sub ?? req.user?.id, role: req.user?.role }) };
    }

    @Put('draft')
    @Roles('tenant_admin')
    @ApiOperation({ summary: 'Save an immutable draft without publishing or changing live connections' })
    async save(@Param('tenantId') tenantId: string, @Param('agentId') agentId: string, @Body() body: SaveAgentDraftRequest, @Req() req: any) {
        return { success: true, data: await this.drafts.save(tenantId, agentId, body, { id: req.user?.sub ?? req.user?.id, role: req.user?.role }) };
    }
    @Post('draft/discard')
    @Roles('tenant_admin')
    @ApiOperation({ summary: 'Discard the exact current draft pointer while retaining immutable history' })
    async discard(@Param('tenantId') tenantId: string, @Param('agentId') agentId: string, @Body() body: DiscardAgentDraftRequest, @Req() req: any) {
        return { success: true, data: await this.drafts.discard(tenantId, agentId, body, { id: req.user?.sub ?? req.user?.id, role: req.user?.role }) };
    }
}
