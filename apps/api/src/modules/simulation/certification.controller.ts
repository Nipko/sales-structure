import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CertificationService } from './certification.service';
import type { PlanCertificationRequest } from './certification-contract';

/**
 * The entrypoint the executor never had.
 *
 * Writing is super_admin only: a run spends a shared budget and produces the
 * evidence the product's claims rest on, which is a platform decision rather
 * than a tenant one. Reading is open to the tenant admin whose data the run
 * used, because being able to see what was executed against your own tenant is
 * not a privilege.
 */
@Controller('certification/:tenantId')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
export class CertificationController {
    constructor(private readonly certification: CertificationService) {}
    private actor(req: any) { return { id: req.user?.sub ?? req.user?.id, role: req.user?.role }; }

    @Post('runs')
    @Roles('super_admin')
    async plan(@Param('tenantId') tenantId: string, @Body() body: PlanCertificationRequest, @Req() req: any) {
        return { success: true, data: await this.certification.plan(tenantId, body, this.actor(req)) };
    }

    @Get('runs/:runId')
    @Roles('super_admin', 'tenant_admin')
    async read(@Param('tenantId') tenantId: string, @Param('runId') runId: string, @Req() req: any) {
        return { success: true, data: await this.certification.read(tenantId, runId, this.actor(req)) };
    }

    @Get('runs/:runId/report')
    @Roles('super_admin', 'tenant_admin')
    async report(@Param('tenantId') tenantId: string, @Param('runId') runId: string, @Req() req: any) {
        return { success: true, data: await this.certification.report(tenantId, runId, this.actor(req)) };
    }

    @Post('runs/:runId/start')
    @Roles('super_admin')
    async start(@Param('tenantId') tenantId: string, @Param('runId') runId: string,
        @Body() body: { workers?: number; casesPerWorker?: number }, @Req() req: any) {
        return { success: true,
            data: await this.certification.start(tenantId, runId, this.actor(req), body?.workers, body?.casesPerWorker) };
    }

    @Post('runs/:runId/pause')
    @Roles('super_admin')
    async pause(@Param('tenantId') tenantId: string, @Param('runId') runId: string, @Req() req: any) {
        return { success: true, data: await this.certification.pause(tenantId, runId, this.actor(req)) };
    }

    @Post('runs/:runId/resume')
    @Roles('super_admin')
    async resume(@Param('tenantId') tenantId: string, @Param('runId') runId: string, @Req() req: any) {
        return { success: true, data: await this.certification.resume(tenantId, runId, this.actor(req)) };
    }

    @Post('runs/:runId/cancel')
    @Roles('super_admin')
    async cancel(@Param('tenantId') tenantId: string, @Param('runId') runId: string, @Req() req: any) {
        return { success: true, data: await this.certification.cancel(tenantId, runId, this.actor(req)) };
    }

    @Post('runs/:runId/cases/:caseKey/retry')
    @Roles('super_admin')
    async retry(@Param('tenantId') tenantId: string, @Param('runId') runId: string,
        @Param('caseKey') caseKey: string, @Req() req: any) {
        return { success: true, data: await this.certification.retry(tenantId, runId, caseKey, this.actor(req)) };
    }
}
