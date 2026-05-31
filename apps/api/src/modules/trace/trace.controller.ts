import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { TraceService } from './trace.service';

@Controller('trace')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
export class TraceController {
    constructor(private readonly trace: TraceService) {}

    @Get(':tenantId/:conversationId')
    async getTrace(
        @Param('tenantId') tenantId: string,
        @Param('conversationId') conversationId: string,
        @Query('limit') limit?: string,
    ) {
        const data = await this.trace.getTrace(tenantId, conversationId, parseInt(limit || '100') || 100);
        return { success: true, data };
    }
}
