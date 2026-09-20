import { InvoiceGeneratorService } from './invoice-generator.service';

describe('Payment receipt issuer', () => {
    it('identifies the Stripe seller as Parallext LLC without labeling the receipt a tax invoice', async () => {
        const prisma: any = {
            billingPayment: { findUnique: jest.fn().mockResolvedValue({
                id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', tenantId: 'tenant-1',
                status: 'succeeded', provider: 'stripe', amountCents: 2999, currency: 'USD',
                paidAt: new Date('2026-09-20T12:00:00Z'), createdAt: new Date('2026-09-20T12:00:00Z'),
                subscription: { plan: { name: 'Starter' } },
            }) },
            tenant: { findUnique: jest.fn().mockResolvedValue({
                name: 'International buyer', billingCountry: 'US', billingEmail: 'buyer@example.test', isInternal: false,
            }) },
        };
        const fiscalConfig: any = { getConfig: jest.fn().mockResolvedValue({
            usIssuer: { legalName: 'Parallext LLC', taxId: 'US-456', email: 'billing@example.test' },
            coIssuer: { legalName: 'Colombian seller', nit: 'CO-123' },
        }) };
        const service = new InvoiceGeneratorService(prisma, fiscalConfig);
        const render = jest.spyOn(service as any, 'renderPdf').mockResolvedValue(Buffer.from('%PDF-test'));
        await service.generate('tenant-1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
        expect(render).toHaveBeenCalledWith(expect.objectContaining({
            issuerName: 'Parallext LLC', issuerTaxId: 'US-456',
            customerName: 'International buyer', amountCents: 2999, currency: 'USD',
        }));
        expect(render.mock.calls[0][0]).not.toMatchObject({ issuerName: 'Colombian seller' });
    });
});
