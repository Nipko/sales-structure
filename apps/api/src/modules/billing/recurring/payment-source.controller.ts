import { Body, Controller, Delete, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { TenantGuard } from '../../../common/guards/tenant.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { PaymentSourceService } from './payment-source.service';
import { PaymentSourceKind } from '../adapters/provider-capabilities';

const STOREABLE_KINDS = ['card', 'nequi', 'bancolombia_transfer', 'daviplata'] as const;

class AddPaymentSourceDto {
    @IsIn(STOREABLE_KINDS as unknown as string[])
    kind!: PaymentSourceKind;

    /**
     * Single-use token produced CLIENT-SIDE by the provider widget. A raw card
     * number must never reach this endpoint — that would put the platform in PCI
     * scope, and the provider forbids it.
     */
    @IsString()
    @MaxLength(255)
    token!: string;

    @IsOptional() @IsString() @MaxLength(255) customerEmail?: string;
    @IsOptional() @IsBoolean() makeDefault?: boolean;
}

/**
 * Payment methods a tenant can be charged with.
 *
 * Tenant-scoped and admin-only: adding or removing a payment method decides
 * whether the account keeps its subscription, so it is not an agent-level action.
 */
@Controller('billing/payment-sources')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
export class PaymentSourceController {
    constructor(private readonly paymentSources: PaymentSourceService) {}

    /** Contracts the checkout must show before storing anything (habeas data). */
    @Get(':tenantId/acceptance')
    @Roles('tenant_admin', 'super_admin')
    async acceptance(@Param('tenantId') tenantId: string) {
        const contracts = await this.paymentSources.getAcceptanceContracts(tenantId);
        return {
            success: true,
            data: {
                provider: contracts.provider,
                // Only the links and types travel to the browser; the tokens are
                // re-fetched server-side when the source is actually created.
                endUserPolicy: {
                    permalink: contracts.endUserPolicy.permalink,
                    type: contracts.endUserPolicy.type,
                },
                personalDataAuth: contracts.personalDataAuth
                    ? {
                          permalink: contracts.personalDataAuth.permalink,
                          type: contracts.personalDataAuth.type,
                      }
                    : null,
            },
        };
    }

    @Get(':tenantId')
    @Roles('tenant_admin', 'super_admin')
    async list(@Param('tenantId') tenantId: string) {
        return { success: true, data: await this.paymentSources.listPaymentSources(tenantId) };
    }

    @Post(':tenantId')
    @Roles('tenant_admin', 'super_admin')
    async add(
        @Param('tenantId') tenantId: string,
        @Body() body: AddPaymentSourceDto,
        @Req() req: any,
    ) {
        const result = await this.paymentSources.addPaymentSource({
            tenantId,
            kind: body.kind,
            token: body.token,
            customerEmail: body.customerEmail || req?.user?.email || '',
            // Consent evidence: who accepted, and from where.
            acceptedIp: req?.headers?.['cf-connecting-ip'] || req?.ip,
            makeDefault: body.makeDefault,
        });
        return { success: true, data: result };
    }

    /** Poll a wallet source the customer is still approving in their bank app. */
    @Get(':tenantId/:sourceId/status')
    @Roles('tenant_admin', 'super_admin')
    async status(@Param('tenantId') tenantId: string, @Param('sourceId') sourceId: string) {
        return { success: true, data: await this.paymentSources.pollAuthorization(tenantId, sourceId) };
    }

    @Put(':tenantId/:sourceId/default')
    @Roles('tenant_admin', 'super_admin')
    async makeDefault(@Param('tenantId') tenantId: string, @Param('sourceId') sourceId: string) {
        await this.paymentSources.setDefault(tenantId, sourceId);
        return { success: true };
    }

    @Delete(':tenantId/:sourceId')
    @Roles('tenant_admin', 'super_admin')
    async remove(@Param('tenantId') tenantId: string, @Param('sourceId') sourceId: string) {
        await this.paymentSources.removePaymentSource(tenantId, sourceId);
        return { success: true };
    }
}
