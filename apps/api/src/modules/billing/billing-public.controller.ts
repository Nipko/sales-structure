import { Controller, Get, Query } from '@nestjs/common';
import { BillingPlanCatalogService } from './billing-plan-catalog.service';

@Controller('billing/public')
export class BillingPublicController {
    constructor(private readonly planCatalog: BillingPlanCatalogService) {}

    @Get('plans')
    async listPlans(@Query('country') country?: string) {
        const plans = await this.planCatalog.listPublicPlans(country);
        return { success: true, data: plans };
    }
}
