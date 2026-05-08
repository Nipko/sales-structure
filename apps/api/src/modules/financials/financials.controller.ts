import { Body, Controller, Get, Post, Query, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Response } from 'express';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { FinancialsService } from './financials.service';
import { FinancialSnapshotService } from './financial-snapshot.service';
import { LLMRouterService } from '../ai/router/llm-router.service';
import { rowsToCsv } from './csv.util';

@Controller('financials')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('super_admin')
export class FinancialsController {
    constructor(
        private readonly financialsService: FinancialsService,
        private readonly snapshotService: FinancialSnapshotService,
        private readonly llmRouter: LLMRouterService,
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

    /**
     * Live LLM usage drilldown — pulls from Redis llm:stats:* (90-day window).
     * For historical data older than 90 days use the persisted
     * TenantFinancialSnapshot.llmCostCents instead.
     */
    @Get('llm-usage')
    async getLlmUsage(
        @Query('from') from?: string,
        @Query('to') to?: string,
        @Query('tenantId') tenantId?: string,
    ) {
        const since = from ? new Date(from) : (() => {
            const d = new Date();
            d.setUTCDate(d.getUTCDate() - 30);
            return d;
        })();
        const until = to ? new Date(to) : new Date();
        const data = await this.llmRouter.getStats({ since, until, tenantId });
        return { success: true, data };
    }

    @Post('snapshot/generate')
    async generateSnapshot(@Body() body: { month: string }) {
        const targetMonth = new Date(body.month + '-01');
        await this.snapshotService.generateSnapshot(targetMonth);
        return { success: true, month: body.month };
    }

    // ─── CSV exports (super_admin only) ────────────────────────────

    @Get('export/revenue.csv')
    async exportRevenue(@Query('months') months: string | undefined, @Res() res: Response) {
        const rows = await this.financialsService.getRevenueTrend(months ? parseInt(months, 10) : 12);
        const csv = rowsToCsv(rows.map((r: any) => ({
            month: r.month instanceof Date ? r.month.toISOString().slice(0, 7) : r.month,
            revenueCents: r.revenue,
            paymentsSucceeded: r.paymentsSucceeded,
            paymentsFailed: r.paymentsFailed,
            successRatePct: r.successRate,
        })));
        return this.sendCsv(res, 'parallly-revenue', csv);
    }

    @Get('export/costs.csv')
    async exportCosts(@Query('months') months: string | undefined, @Res() res: Response) {
        const rows = await this.financialsService.getCostsTrend(months ? parseInt(months, 10) : 12);
        const csv = rowsToCsv(rows.map((r: any) => ({
            month: r.month instanceof Date ? r.month.toISOString().slice(0, 7) : r.month,
            revenueCents: r.revenue,
            llmCostCents: r.llmCost,
            infraCostCents: r.infraCost,
            totalCostCents: r.totalCost,
            grossMarginPct: r.grossMargin,
        })));
        return this.sendCsv(res, 'parallly-costs', csv);
    }

    @Get('export/tenant-profitability.csv')
    async exportTenantProfitability(@Query('month') month: string | undefined, @Res() res: Response) {
        const rows = await this.financialsService.getTenantProfitability(month);
        const csv = rowsToCsv(rows.map((r: any) => ({
            tenantId: r.tenantId,
            tenantName: r.tenantName,
            plan: r.plan,
            revenueCents: r.revenue,
            llmCostCents: r.llmCost,
            profitCents: r.profit,
            marginPct: r.margin,
        })));
        const tag = month || new Date().toISOString().slice(0, 7);
        return this.sendCsv(res, `parallly-tenant-profitability-${tag}`, csv);
    }

    private sendCsv(res: Response, basename: string, csv: string) {
        const filename = `${basename}.csv`;
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        // BOM so Excel auto-detects UTF-8
        res.send('﻿' + csv);
    }
}
