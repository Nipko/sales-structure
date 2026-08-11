import { Controller, Get, Post, Put, Delete, Body, Param, Query, Logger, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { DripSequenceService } from './drip-sequence.service';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@ApiTags('automation')
@Controller('automation/drip-sequences')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
@ApiBearerAuth()
export class DripSequenceController {
    private readonly logger = new Logger(DripSequenceController.name);

    constructor(private readonly dripService: DripSequenceService) {}

    @Get(':tenantId')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    @ApiOperation({ summary: 'List all drip sequences for a tenant' })
    async listSequences(@Param('tenantId') tenantId: string) {
        const data = await this.dripService.listSequences(tenantId);
        return { success: true, data };
    }

    @Get(':tenantId/:sequenceId')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    @ApiOperation({ summary: 'Get a specific drip sequence' })
    async getSequence(
        @Param('tenantId') tenantId: string,
        @Param('sequenceId') sequenceId: string,
    ) {
        const data = await this.dripService.getSequence(tenantId, sequenceId);
        return { success: true, data };
    }

    @Post(':tenantId')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    @ApiOperation({ summary: 'Create a new drip sequence' })
    async createSequence(
        @Param('tenantId') tenantId: string,
        @Body() body: any,
    ) {
        const data = await this.dripService.createSequence(tenantId, body);
        return { success: true, data };
    }

    @Put(':tenantId/:sequenceId')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    @ApiOperation({ summary: 'Update a drip sequence' })
    async updateSequence(
        @Param('tenantId') tenantId: string,
        @Param('sequenceId') sequenceId: string,
        @Body() body: any,
    ) {
        const data = await this.dripService.updateSequence(tenantId, sequenceId, body);
        return { success: true, data };
    }

    @Delete(':tenantId/:sequenceId')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    @ApiOperation({ summary: 'Delete a drip sequence' })
    async deleteSequence(
        @Param('tenantId') tenantId: string,
        @Param('sequenceId') sequenceId: string,
    ) {
        await this.dripService.deleteSequence(tenantId, sequenceId);
        return { success: true, message: 'Sequence deleted' };
    }

    @Post(':tenantId/:sequenceId/toggle')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    @ApiOperation({ summary: 'Toggle drip sequence active state' })
    async toggleSequence(
        @Param('tenantId') tenantId: string,
        @Param('sequenceId') sequenceId: string,
        @Body() body: { isActive: boolean },
    ) {
        const data = await this.dripService.toggleSequence(tenantId, sequenceId, body.isActive);
        return { success: true, data };
    }

    @Post(':tenantId/:sequenceId/enroll')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    @ApiOperation({ summary: 'Enroll a contact in a drip sequence' })
    async enrollContact(
        @Param('tenantId') tenantId: string,
        @Param('sequenceId') sequenceId: string,
        @Body() body: { contactId: string; conversationId?: string },
    ) {
        const data = await this.dripService.enrollContact(
            tenantId, sequenceId, body.contactId, body.conversationId,
        );
        return { success: true, data };
    }

    @Post(':tenantId/:sequenceId/enroll-segment')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    @ApiOperation({ summary: 'Bulk-enroll a CRM segment into a prospecting sequence' })
    async enrollSegment(
        @Param('tenantId') tenantId: string,
        @Param('sequenceId') sequenceId: string,
        @Body() body: { segmentId: string; cap?: number },
    ) {
        const data = await this.dripService.enrollSegment(
            tenantId, sequenceId, body.segmentId, { cap: body.cap },
        );
        return { success: true, data };
    }

    @Post(':tenantId/:sequenceId/unenroll')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    @ApiOperation({ summary: 'Unenroll a contact from a drip sequence' })
    async unenrollContact(
        @Param('tenantId') tenantId: string,
        @Param('sequenceId') sequenceId: string,
        @Body() body: { contactId: string },
    ) {
        await this.dripService.unenrollContact(tenantId, sequenceId, body.contactId);
        return { success: true, message: 'Contact unenrolled' };
    }

    @Get(':tenantId/:sequenceId/enrollments')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    @ApiOperation({ summary: 'Get enrollments for a drip sequence' })
    async getEnrollments(
        @Param('tenantId') tenantId: string,
        @Param('sequenceId') sequenceId: string,
        @Query('status') status?: string,
    ) {
        const data = await this.dripService.getEnrollments(tenantId, sequenceId, status);
        return { success: true, data };
    }
}
