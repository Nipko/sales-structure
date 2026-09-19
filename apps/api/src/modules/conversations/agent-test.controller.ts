import { Body, Controller, Optional, Param, Post, UseGuards } from '@nestjs/common';
import { onboardingOnceKey } from '@parallext/shared';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AgentTestService } from './agent-test.service';
import { AgentTestRequestDto } from './dto/agent-test-request.dto';
import { AgentTestRateLimitGuard } from './agent-test-rate-limit.guard';
import { AgentTestRequestGuard } from './agent-test-request.guard';
import { PrismaService } from '../prisma/prisma.service';
import { recordOnboardingEvent } from '../../common/utils/onboarding-event.util';

@Controller('agent-test')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
export class AgentTestController {
    constructor(
        private readonly service: AgentTestService,
        @Optional() private readonly prisma?: PrismaService,
    ) {}

    /**
     * Run a single message through the operational turn core with isolated session state.
     * Returns the LLM reply plus complete debug info: assembled prompt,
     * tool calls, RAG hits, token usage, cost, latency.
     *
     * Booking and procedures use their real engines. Writer, provider and channel
     * delivery boundaries remain blocked. It does not persist business state;
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
        if (this.prisma && result?.reply) {
            const surface = options?.surface ?? 'agent_editor';
            void recordOnboardingEvent(this.prisma, {
                tenantId,
                event: 'test_chat_first_reply',
                detail: surface,
                dedupeKey: onboardingOnceKey('test_chat_first_reply', tenantId, surface),
            });
        }
        return { success: true, data: result };
    }
}
