import {
    BadRequestException,
    Body,
    Controller,
    Get,
    Param,
    Post,
    Query,
    Req,
    UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { ToolApprovalWorkflowService } from './tool-approval-workflow.service';
import type { ToolApprovalStatus } from './tool-execution-control.service';

@ApiTags('tool-approvals')
@ApiBearerAuth()
@Controller('tool-approvals')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
export class ToolApprovalController {
    constructor(private readonly workflow: ToolApprovalWorkflowService) {}

    @Get(':tenantId')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    @ApiOperation({ summary: 'List A4 approval tickets scoped to one tenant' })
    async list(
        @Param('tenantId') tenantId: string,
        @Query('status') status?: string,
        @Query('limit') limit?: string,
    ) {
        const allowedStatuses = new Set(['pending', 'approved', 'rejected', 'expired']);
        if (status && !allowedStatuses.has(status)) {
            throw new BadRequestException('status must be pending, approved, rejected or expired');
        }
        const parsedLimit = limit === undefined ? undefined : Number(limit);
        if (parsedLimit !== undefined && (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100)) {
            throw new BadRequestException('limit must be an integer between 1 and 100');
        }
        const data = await this.workflow.listApprovals({
            tenantId,
            status: status as ToolApprovalStatus | undefined,
            limit: parsedLimit,
        });
        return { success: true, data };
    }

    @Post(':tenantId/:ticketId/decision')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    @ApiOperation({ summary: 'Approve or reject a pending A4 conversational action' })
    async decide(
        @Param('tenantId') tenantId: string,
        @Param('ticketId') ticketId: string,
        @Body() body: { decision?: 'approved' | 'rejected'; reason?: string },
        @Req() req: any,
    ) {
        if (body?.decision !== 'approved' && body?.decision !== 'rejected') {
            throw new BadRequestException('decision must be approved or rejected');
        }
        const data = await this.workflow.decide({
            tenantId,
            ticketId,
            actorId: req.user.id,
            decision: body.decision,
            reason: body.reason,
        });
        return { success: true, data };
    }

    @Post(':tenantId/:ticketId/resume')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    @ApiOperation({ summary: 'Idempotently resume an already-approved A4 action' })
    async resume(
        @Param('tenantId') tenantId: string,
        @Param('ticketId') ticketId: string,
    ) {
        const data = await this.workflow.resumeApprovedTicket(tenantId, ticketId);
        return { success: true, data };
    }
}
