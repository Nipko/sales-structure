import { Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { SmsCreditsService, SmsPackagesConfig } from './sms-credits.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';

@Controller('sms-credits')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
@ApiBearerAuth()
export class SmsCreditsController {
    constructor(private readonly smsCredits: SmsCreditsService) { }

    // -------------------------------------------------------------- catalog

    /** Active tiers for the tenant purchase UI. */
    @Get('packages')
    @Roles('super_admin', 'tenant_admin')
    async getPackages() {
        // P26: balances/history remain readable for legacy obligations, but a
        // tenant endpoint must never publish a price catalogue for a retired
        // product even if an old platform setting is accidentally re-enabled.
        return { success: true, data: [], meta: { retired: true, code: 'sms_product_retired' } };
    }

    // -------------------------------------------------------------- super admin

    /** Full config (all tiers incl. inactive + sender). */
    @Get('admin/config')
    @Roles('super_admin')
    async getConfig() {
        const config = await this.smsCredits.getConfig();
        return { success: true, data: config };
    }

    @Put('admin/config')
    @Roles('super_admin')
    async setConfig(@Body() body: SmsPackagesConfig) {
        try {
            const saved = await this.smsCredits.setConfig(body);
            return { success: true, data: saved };
        } catch (e: any) {
            return { success: false, error: e.message };
        }
    }

    /** Balances across all tenants (billing-ops). */
    @Get('admin/balances')
    @Roles('super_admin')
    async listBalances() {
        const data = await this.smsCredits.listBalances();
        return { success: true, data };
    }

    /** Manual balance adjustment (signed). */
    @Post('admin/:tenantId/adjust')
    @Roles('super_admin')
    async adjust(
        @Param('tenantId') tenantId: string,
        @Body() body: { delta: number; reason: string },
        @Req() req: any,
    ) {
        if (!Number.isInteger(body?.delta) || body.delta === 0) {
            return { success: false, error: 'delta debe ser un entero distinto de cero' };
        }
        if (!body?.reason?.trim()) {
            return { success: false, error: 'reason es obligatorio' };
        }
        try {
            const balance = await this.smsCredits.adjust(tenantId, body.delta, body.reason.trim(), req.user?.id);
            return { success: true, data: { balance } };
        } catch (e: any) {
            return { success: false, error: e.message };
        }
    }

    // -------------------------------------------------------------- tenant

    @Get(':tenantId/balance')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    async getBalance(@Param('tenantId') tenantId: string) {
        const data = await this.smsCredits.getConsumption(tenantId);
        return { success: true, data };
    }

    @Get(':tenantId/ledger')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    async getLedger(@Param('tenantId') tenantId: string, @Query('limit') limit?: string) {
        const data = await this.smsCredits.listLedger(tenantId, limit ? parseInt(limit, 10) : 50);
        return { success: true, data };
    }
}
