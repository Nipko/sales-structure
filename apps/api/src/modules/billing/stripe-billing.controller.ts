import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequiresVerifiedEmail } from '../../common/decorators/requires-verified-email.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { StripeBillingService } from './stripe-billing.service';

class StripeCheckoutDto {
    @IsOptional() @IsString() @MaxLength(80) planSlug?: string;
    @IsOptional() @IsIn(['monthly', 'annual']) billingCycle?: 'monthly' | 'annual';
}

@Controller('billing/:tenantId/stripe')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
@ApiBearerAuth()
@Roles('tenant_admin', 'super_admin')
export class StripeBillingController {
    constructor(private readonly stripeBilling: StripeBillingService) {}

    @Post('checkout')
    @RequiresVerifiedEmail('manage_billing')
    async checkout(@Param('tenantId') tenantId: string, @Body() body: StripeCheckoutDto) {
        return { success: true, data: await this.stripeBilling.createCheckout(tenantId, body) };
    }

    @Post('portal')
    @RequiresVerifiedEmail('manage_billing')
    async portal(@Param('tenantId') tenantId: string) {
        return { success: true, data: await this.stripeBilling.createPortal(tenantId) };
    }
}
