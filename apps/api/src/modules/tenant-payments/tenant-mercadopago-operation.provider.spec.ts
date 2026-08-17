import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { PaymentProviderCallError } from '../conversations/payment-operation.service';
import { TenantMercadoPagoOperationProvider } from './tenant-mercadopago-operation.provider';

const TENANT = '11111111-1111-4111-8111-111111111111';
const CONTACT = '22222222-2222-4222-8222-222222222222';
const REFERENCE = 'order:33333333-3333-4333-8333-333333333333';

describe('TenantMercadoPagoOperationProvider', () => {
    it('exposes payment links only and publishes authoritative purchase money', async () => {
        const service = {
            resolveOwnedReference: jest.fn().mockResolvedValue({
                canonicalReference: REFERENCE,
                amountCents: 10_000,
                currency: 'COP',
            }),
        };
        const provider = new TenantMercadoPagoOperationProvider(service as any);

        expect(provider.supports('payment_link')).toBe(true);
        expect(provider.supports('refund')).toBe(false);
        expect(provider.supports('discount')).toBe(false);
        await expect(provider.resolveOwnership({
            tenantId: TENANT,
            contactId: CONTACT,
            kind: 'payment_link',
            reference: REFERENCE,
        })).resolves.toEqual({
            owned: true,
            canonicalReference: REFERENCE,
            canonicalAmountCents: 10_000,
            canonicalCurrency: 'COP',
        });
    });

    it('rechecks ownership and money immediately before creating the external link', async () => {
        const service = {
            resolveOwnedReference: jest.fn().mockResolvedValue({
                canonicalReference: REFERENCE,
                amountCents: 10_000,
                currency: 'COP',
            }),
            createPaymentLink: jest.fn(),
        };
        const provider = new TenantMercadoPagoOperationProvider(service as any);

        await expect(provider.createPaymentLink({
            tenantId: TENANT,
            contactId: CONTACT,
            amountCents: 9_000,
            currency: 'COP',
            description: 'Pedido',
            canonicalReference: REFERENCE,
            idempotencyKey: 'operation-id',
        })).rejects.toThrow('tenant_payment_reference_changed');

        expect(service.createPaymentLink).not.toHaveBeenCalled();
    });

    it('classifies a known provider 4xx as no-effect and a 5xx as unknown', async () => {
        const service = {
            resolveOwnedReference: jest.fn().mockResolvedValue({
                canonicalReference: REFERENCE,
                amountCents: 10_000,
                currency: 'COP',
            }),
            createPaymentLink: jest
                .fn()
                .mockRejectedValueOnce(new BadRequestException({ error: 'wompi_link_creation_rejected' }))
                .mockRejectedValueOnce(new ServiceUnavailableException({ error: 'wompi_link_creation_outcome_unknown' })),
        };
        const provider = new TenantMercadoPagoOperationProvider(service as any);
        const input = {
            tenantId: TENANT,
            contactId: CONTACT,
            amountCents: 10_000,
            currency: 'COP',
            description: 'Pedido',
            canonicalReference: REFERENCE,
            idempotencyKey: 'operation-id',
        };

        const known = await provider.createPaymentLink(input).catch(error => error);
        expect(known).toBeInstanceOf(PaymentProviderCallError);
        expect(known).toMatchObject({
            outcome: 'known_no_effect',
            code: 'wompi_link_creation_rejected',
        });

        const unknown = await provider.createPaymentLink(input).catch(error => error);
        expect(unknown).toBeInstanceOf(PaymentProviderCallError);
        expect(unknown).toMatchObject({
            outcome: 'unknown',
            code: 'wompi_link_creation_outcome_unknown',
        });
    });
});
