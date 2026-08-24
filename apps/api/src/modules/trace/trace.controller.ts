import { Controller, ForbiddenException, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { TraceService } from './trace.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';

@Controller('trace')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
@Roles('super_admin', 'tenant_admin', 'tenant_supervisor', 'tenant_agent')
export class TraceController {
    constructor(
        private readonly trace: TraceService,
        private readonly prisma: PrismaService,
    ) {}

    private limit(raw: unknown, fallback: number, max: number): number {
        if (typeof raw !== 'string') return fallback;
        const parsed = Number.parseInt(raw, 10);
        return Number.isFinite(parsed) ? Math.min(max, Math.max(1, parsed)) : fallback;
    }

    private async assertConversationAccess(
        tenantId: string,
        conversationId: string,
        user: any,
    ): Promise<void> {
        if (['super_admin', 'tenant_admin', 'tenant_supervisor'].includes(user?.role)) return;
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const rows = await this.prisma.executeInTenantSchema<Array<{ assigned_to: string | null }>>(
            schemaName,
            'SELECT assigned_to FROM conversations WHERE id = $1::uuid LIMIT 1',
            [conversationId],
        );
        const actorId = user?.id || user?.sub;
        if (!rows.length || (rows[0].assigned_to !== null && rows[0].assigned_to !== actorId)) {
            throw new ForbiddenException('Conversation trace access denied');
        }
    }

    @Get(':tenantId/:conversationId')
    async getTrace(
        @Param('tenantId') tenantId: string,
        @Param('conversationId') conversationId: string,
        @Req() req: any,
        @Query('limit') limit?: string,
    ) {
        await this.assertConversationAccess(tenantId, conversationId, req.user);
        const data = await this.trace.getTrace(tenantId, conversationId, this.limit(limit, 100, 200));
        return { success: true, data };
    }

    /** Step-by-step turn traces for a conversation (WS5 #1). */
    @Get(':tenantId/:conversationId/turns')
    async getTurnTraces(
        @Param('tenantId') tenantId: string,
        @Param('conversationId') conversationId: string,
        @Req() req: any,
        @Query('limit') limit?: string,
    ) {
        await this.assertConversationAccess(tenantId, conversationId, req.user);
        const data = await this.trace.getTurnTraces(tenantId, conversationId, this.limit(limit, 50, 100));
        return { success: true, data };
    }
}
