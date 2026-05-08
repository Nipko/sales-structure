import { BadRequestException, Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { BillingService } from './billing.service';

/**
 * Super-admin only billing operations: refund a payment, grant a comp plan
 * to a tenant. Live in a separate controller from BillingController so the
 * @Roles('super_admin') decorator and the route prefix are unambiguous.
 */

class RefundPaymentDto {
    @IsOptional()
    @IsInt()
    @Min(1)
    amountCents?: number;

    @IsOptional()
    @IsString()
    reason?: string;
}

class CompPlanDto {
    @IsString()
    @IsIn(['starter', 'pro', 'enterprise', 'custom'])
    planSlug!: string;

    @IsInt()
    @Min(1)
    durationDays!: number;

    @IsString()
    reason!: string;
}

@Controller('billing-admin')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('super_admin')
export class BillingAdminController {
    constructor(private readonly billingService: BillingService) {}

    /**
     * Issue a refund for a single payment row. Pass `amountCents` for a
     * partial refund; omit for a full refund. Provider webhook will
     * eventually flip BillingPayment.status='refunded'.
     */
    @Post('payments/:paymentId/refund')
    async refundPayment(
        @Param('paymentId') paymentId: string,
        @Body() body: RefundPaymentDto,
        @Req() req: any,
    ) {
        const result = await this.billingService.refundPayment({
            paymentId,
            amountCents: body.amountCents,
            reason: body.reason,
            actorUserId: req.user?.sub,
        });
        return { success: true, data: result };
    }

    /**
     * Grant a tenant a free plan for N days. Does NOT charge or interact
     * with the provider — purely a local override. Existing provider
     * subscription (if any) keeps running on its own schedule.
     */
    @Post('tenants/:tenantId/comp-plan')
    async grantCompPlan(
        @Param('tenantId') tenantId: string,
        @Body() body: CompPlanDto,
        @Req() req: any,
    ) {
        if (!body.reason || body.reason.trim().length < 3) {
            throw new BadRequestException({ error: 'reason_required', message: 'Reason is required for audit trail.' });
        }
        await this.billingService.grantCompPlan({
            tenantId,
            planSlug: body.planSlug,
            durationDays: body.durationDays,
            reason: body.reason,
            actorUserId: req.user?.sub,
        });
        return { success: true };
    }
}
