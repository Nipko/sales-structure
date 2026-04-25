import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { FinancialsService } from './financials.service';
import { FinancialSnapshotService } from './financial-snapshot.service';

@Controller('financials')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('super_admin')
export class FinancialsController {
    constructor(
        private readonly financialsService: FinancialsService,
        private readonly snapshotService: FinancialSnapshotService,
    ) {}

    @Get('overview')
    async getOverview() {
        return this.financialsService.getOverview();
    }

    @Get('mrr-trend')
    async getMrrTrend(@Query('months') months?: string) {
        return this.financialsService.getMrrTrend(months ? parseInt(months, 10) : 12);
    }

    @Get('revenue')
    async getRevenue(@Query('months') months?: string) {
        return this.financialsService.getRevenueTrend(months ? parseInt(months, 10) : 12);
    }

    @Get('churn-trend')
    async getChurnTrend(@Query('months') months?: string) {
        return this.financialsService.getChurnTrend(months ? parseInt(months, 10) : 12);
    }

    @Get('costs')
    async getCosts(@Query('months') months?: string) {
        return this.financialsService.getCostsTrend(months ? parseInt(months, 10) : 12);
    }

    @Get('tenant-profitability')
    async getTenantProfitability(@Query('month') month?: string) {
        return this.financialsService.getTenantProfitability(month);
    }

    @Get('trial-metrics')
    async getTrialMetrics() {
        return this.financialsService.getTrialMetrics();
    }

    @Get('infra-costs')
    async getInfraCosts(@Query('year') year?: string) {
        return this.financialsService.getInfraCosts(
            year ? parseInt(year, 10) : new Date().getFullYear(),
        );
    }

    @Post('infra-costs')
    async upsertInfraCost(
        @Body() body: { month: string; category: string; amountCents: number; description?: string; createdBy?: string },
    ) {
        return this.financialsService.upsertInfraCost(body);
    }

    @Post('exchange-rates')
    async upsertExchangeRate(
        @Body() body: { rateDate: string; fromCurrency: string; toCurrency: string; rate: number },
    ) {
        return this.financialsService.upsertExchangeRate(body);
    }

    @Post('snapshot/generate')
    async generateSnapshot(@Body() body: { month: string }) {
        const targetMonth = new Date(body.month + '-01');
        await this.snapshotService.generateSnapshot(targetMonth);
        return { success: true, month: body.month };
    }
}
