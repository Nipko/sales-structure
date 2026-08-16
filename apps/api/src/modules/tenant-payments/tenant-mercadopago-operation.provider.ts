import { Injectable } from '@nestjs/common';
import {
    type DiscountProviderRequest,
    type PaymentLinkProviderRequest,
    type PaymentOperationKind,
    type PaymentOperationProvider,
    type RefundProviderRequest,
} from '../conversations/payment-operation.service';
import { TenantPaymentsService } from './tenant-payments.service';

/**
 * The only Mercado Pago rail left in the product: a tenant uses its own account
 * to create Checkout Pro links for purchases made by its own contacts.
 * Platform subscriptions, refunds and discounts never route through here.
 */
@Injectable()
export class TenantMercadoPagoOperationProvider implements PaymentOperationProvider {
    readonly id = 'tenant_mercadopago';

    constructor(private readonly tenantPayments: TenantPaymentsService) {}

    supports(kind: PaymentOperationKind): boolean {
        return kind === 'payment_link';
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
        };
    }

    async createPaymentLink(input: PaymentLinkProviderRequest) {
        // Re-check immediately before the provider effect to close the window in
        // which an order could change after the first ownership check.
        const owned = await this.tenantPayments.resolveOwnedReference(
            input.tenantId,
            input.contactId,
            input.externalReference,
        );
        if (!owned
            || owned.amountCents !== input.amountCents
            || owned.currency !== input.currency.toUpperCase()) {
            throw new Error('tenant_payment_reference_changed');
        }
        const link = await this.tenantPayments.createPaymentLink(input.tenantId, {
            amountCents: input.amountCents,
            currency: input.currency,
            description: input.description,
            externalReference: owned.canonicalReference,
            idempotencyKey: input.idempotencyKey,
        });
        return { providerOperationId: link.id, url: link.url };
    }

    async reconcile(input: {
        tenantId: string;
        kind: PaymentOperationKind;
        providerOperationId: string;
    }): Promise<{ status: 'confirmed' | 'pending' | 'failed' }> {
        if (input.kind !== 'payment_link') return { status: 'failed' };
        return await this.tenantPayments.verifyPaymentLink(input.tenantId, input.providerOperationId)
            ? { status: 'confirmed' }
            : { status: 'pending' };
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
}
