import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/tenant.decorator';
import { ProceduresService } from './procedures.service';
import type { ProcedureStep, ProcedureStatus } from '@parallext/shared';

interface UpsertProcedureDto {
    name?: string;
    description?: string;
    trigger?: { keywords?: string[]; description?: string };
    steps?: ProcedureStep[];
    vertical?: string;
    status?: ProcedureStatus;
}

/**
 * Procedures (AOP/SOP) — T2.12. Tenants write SOPs that compile to deterministic
 * step graphs the conversation engine executes.
 */
@Controller('procedures')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
export class ProceduresController {
    constructor(private readonly procedures: ProceduresService) {}

    @Get(':tenantId')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    async list(@Param('tenantId') tenantId: string) {
        return { success: true, data: await this.procedures.list(tenantId) };
    }

    @Get(':tenantId/:id')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    async get(@Param('tenantId') tenantId: string, @Param('id') id: string) {
        return { success: true, data: await this.procedures.get(tenantId, id) };
    }

    @Post(':tenantId/compile')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    async compile(
        @Param('tenantId') tenantId: string,
        @Body() body: { sop: string; vertical?: string },
        @CurrentUser('email') email?: string,
    ) {
        return { success: true, data: await this.procedures.compile(tenantId, body.sop, body.vertical, email) };
    }

    @Post(':tenantId')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    async create(
        @Param('tenantId') tenantId: string,
        @Body() body: UpsertProcedureDto,
        @CurrentUser('email') email?: string,
    ) {
        return { success: true, data: await this.procedures.create(tenantId, body as any, email) };
    }

    @Put(':tenantId/:id')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    async update(@Param('tenantId') tenantId: string, @Param('id') id: string, @Body() body: UpsertProcedureDto) {
        return { success: true, data: await this.procedures.update(tenantId, id, body as any) };
    }

    @Put(':tenantId/:id/status')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    async setStatus(@Param('tenantId') tenantId: string, @Param('id') id: string, @Body() body: { status: ProcedureStatus }) {
        return { success: true, data: await this.procedures.setStatus(tenantId, id, body.status) };
    }

    @Delete(':tenantId/:id')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    async remove(@Param('tenantId') tenantId: string, @Param('id') id: string) {
        await this.procedures.remove(tenantId, id);
        return { success: true };
    }
}
