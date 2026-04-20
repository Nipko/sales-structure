import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AgentTestService } from './agent-test.service';
import type { TestAgentRequest } from '@parallext/shared';

@Controller('agent-test')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
export class AgentTestController {
    constructor(private readonly service: AgentTestService) {}

    /**
     * Run a single test message through the full agent pipeline.
     * Returns the LLM reply plus complete debug info: assembled prompt,
     * tool calls, RAG hits, token usage, cost, latency.
     *
     * Does NOT persist anything — it's pure introspection.
     */
    @Post(':tenantId/:agentId')
    @Roles('super_admin', 'tenant_admin')
    async test(
        @Param('tenantId') tenantId: string,
        @Param('agentId') agentId: string,
        @Body() body: TestAgentRequest,
    ) {
        const result = await this.service.test(tenantId, agentId, body);
        return { success: true, data: result };
    }
}
