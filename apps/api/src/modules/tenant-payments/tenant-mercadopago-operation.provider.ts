import { HttpException, Injectable } from '@nestjs/common';
import {
    type DiscountProviderRequest,
    type PaymentLinkProviderRequest,
    type PaymentOperationKind,
    type PaymentOperationProvider,
    PaymentProviderCallError,
    type RefundProviderRequest,
} from '../conversations/payment-operation.service';
import { TenantPaymentsService } from './tenant-payments.service';

/**
 * Historical class name kept for Nest wiring compatibility. The underlying
 * service is now the tenant-customer-payments router and selects MP or Wompi
 * from the tenant's active provider config.
 */
@Injectable()
export class TenantMercadoPagoOperationProvider implements PaymentOperationProvider {
    readonly id = 'tenant_customer_payments';

    constructor(private readonly tenantPayments: TenantPaymentsService) {}

    supports(kind: PaymentOperationKind): boolean {
        return kind === 'payment_link';
    }

    getRuntimeCapability(tenantId: string) {
        return this.tenantPayments.getRuntimeCapability(tenantId);
    }

    async resolveOwnership(input: {
        tenantId: string;
        contactId: string;
        kind: PaymentOperationKind;
        reference: string;
    }) {
        if (input.kind !== 'payment_link') return { owned: false };
        const owned = await this.tenantPayments.resolveOwnedReference(
            input.tenantId,
            input.contactId,
            input.reference,
        );
        if (!owned) return { owned: false };
        return {
            owned: true,
            canonicalReference: owned.canonicalReference,
            canonicalAmountCents: owned.amountCents,
            canonicalCurrency: owned.currency,
            canonicalDescription: owned.description,
            paymentStatus: owned.paymentStatus as any,
        };
    }

    async createPaymentLink(input: PaymentLinkProviderRequest) {
        // Re-check immediately before the provider effect to close the window in
        // which an order could change after the first ownership check.
        let owned;
        try {
            owned = await this.tenantPayments.resolveOwnedReference(
                input.tenantId,
                input.contactId,
                input.canonicalReference,
            );
        } catch (error) {
            throw new PaymentProviderCallError(
                'known_no_effect',
                'payment_ownership_lookup_failed',
                error,
            );
        }
        if (!owned
            || owned.amountCents !== input.amountCents
            || owned.currency !== input.currency.toUpperCase()) {
            throw new PaymentProviderCallError(
                'known_no_effect',
                'tenant_payment_reference_changed',
            );
        }
        let link;
        try {
            link = await this.tenantPayments.createPaymentLink({
                tenantId: input.tenantId,
                contactId: input.contactId,
                amountCents: input.amountCents,
                currency: input.currency,
                description: input.description,
                canonicalReference: owned.canonicalReference,
                idempotencyKey: input.idempotencyKey,
            });
        } catch (error) {
            throw this.classifyProviderFailure(error);
        }
        return {
            providerOperationId: link.id,
            url: link.url,
            provider: link.provider,
            paymentStatus: 'pending' as const,
        };
    }

    async getPaymentStatus(input: {
        tenantId: string;
        contactId: string;
        payableReference: string;
    }) {
        const status = await this.tenantPayments.getPaymentStatus(input);
        if (!status) return null;
        return {
            canonicalReference: status.canonicalReference,
            amountCents: status.amountCents,
            currency: status.currency,
            description: status.description,
            paymentStatus: status.status as any,
            provider: status.provider,
            providerTransactionId: status.providerTransactionId,
            paidAt: status.paidAt,
        };
    }

    async reconcile(input: {
        tenantId: string;
        kind: PaymentOperationKind;
        providerOperationId: string;
    }): Promise<{ status: 'confirmed' | 'pending' | 'failed' }> {
        if (input.kind !== 'payment_link') return { status: 'failed' };
        return this.tenantPayments.reconcilePaymentLinkCreation(input.tenantId, input.providerOperationId);
    }

    async findByIdempotencyKey(input: {
        tenantId: string;
        kind: PaymentOperationKind;
        idempotencyKey: string;
    }): Promise<{ providerOperationId: string } | null> {
        if (input.kind !== 'payment_link') return null;
        const id = await this.tenantPayments.findPaymentLinkByIdempotencyKey(
            input.tenantId,
            input.idempotencyKey,
        );
        return id ? { providerOperationId: id } : null;
    }

    async refundPayment(_input: RefundProviderRequest): Promise<{ providerOperationId: string }> {
        throw new Error('tenant_mercadopago_refunds_not_supported');
    }

    async applyDiscount(_input: DiscountProviderRequest): Promise<{ providerOperationId: string; code: string }> {
        throw new Error('tenant_mercadopago_discounts_not_supported');
    }

    private classifyProviderFailure(error: unknown): PaymentProviderCallError {
        if (error instanceof PaymentProviderCallError) return error;

        const structurallyAmbiguous = (error as any)?.ambiguous;
        const status = error instanceof HttpException ? error.getStatus() : undefined;
        const outcome = structurallyAmbiguous === false
            || (typeof status === 'number' && status >= 400 && status < 500)
            ? 'known_no_effect'
            : 'unknown';
        const response = error instanceof HttpException ? error.getResponse() : undefined;
        const candidate = typeof response === 'object' && response !== null
            ? (response as Record<string, unknown>).error
            : undefined;
        const structuralCode = (error as any)?.code;
        const code = [candidate, structuralCode, (error as any)?.message]
            .find(value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,80}$/.test(value)) as string | undefined;
        return new PaymentProviderCallError(
            outcome,
            code || (outcome === 'known_no_effect'
                ? 'payment_provider_rejected'
                : 'payment_provider_outcome_unknown'),
            error,
        );
    }
}
