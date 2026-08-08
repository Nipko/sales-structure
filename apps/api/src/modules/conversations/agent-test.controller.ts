import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AgentTestService } from './agent-test.service';
import { AgentTestRequestDto } from './dto/agent-test-request.dto';
import { AgentTestRateLimitGuard } from './agent-test-rate-limit.guard';
import { AgentTestRequestGuard } from './agent-test-request.guard';

@Controller('agent-test')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
export class AgentTestController {
    constructor(private readonly service: AgentTestService) {}

    /**
     * Run a single message through the bounded prompt/read-only-tool preview.
     * Returns the LLM reply plus complete debug info: assembled prompt,
     * tool calls, RAG hits, token usage, cost, latency.
     *
     * It intentionally excludes Booking Engine, writers, MCP, vertical provider
     * integrations and channel delivery. It does not persist business state;
     * real LLM usage is quota- and cost-accounted.
     */
    @Post(':tenantId/:agentId')
    @Roles('super_admin', 'tenant_admin')
    @UseGuards(AgentTestRateLimitGuard, AgentTestRequestGuard)
    async test(
        @Param('tenantId') tenantId: string,
        @Param('agentId') agentId: string,
        @Body() body: AgentTestRequestDto,
    ) {
        const { options, ...request } = body;
        const result = await this.service.test(tenantId, agentId, request, {
            disableTools: options?.disableTools,
        });
        return { success: true, data: result };
    }
}
