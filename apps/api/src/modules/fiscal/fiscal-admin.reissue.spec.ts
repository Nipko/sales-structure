import { FiscalAdminController } from './fiscal-admin.controller';
import { FiscalInvoiceService } from './fiscal-invoice.service';

/**
 * "Re-emitir" resetea la fila a 'pending' y RECIÉN AHÍ llama a `requeue`, así
 * que el guard de estado de `requeue` llega tarde: ve la fila ya limpia y la
 * deja pasar. En una factura anulada esa era, además, la única acción que el
 * panel ofrecía — un clic gastaba el consecutivo DIAN que se acababa de
 * decidir no gastar.
 */
describe('FiscalAdminController — re-emitir no puede resucitar una decisión', () => {
    function makeController(invoice: any) {
        const prisma = {
            fiscalInvoice: {
                findUnique: jest.fn().mockResolvedValue(invoice),
                update: jest.fn().mockResolvedValue({}),
            },
        };
        const fiscalService = {
            requeue: jest.fn().mockResolvedValue(true),
            withIssuanceLock: jest.fn(async (_id: string, work: () => Promise<unknown>) => work()),
            assertCanReissue: jest.fn().mockResolvedValue(undefined),
        };
        const factus = { deleteByReference: jest.fn().mockResolvedValue(undefined) };
        const controller = new FiscalAdminController(
            {} as any, prisma as any, fiscalService as any, factus as any, {} as any,
        );
        return { controller, prisma, fiscalService, factus };
    }

    const base = {
        id: 'fi-1', tenantId: 't-1', provider: 'factus',
        cufe: null, invoiceNumber: null, status: 'failed',
    };

    it('rechaza re-emitir una anulada, sin tocar Factus ni la fila', async () => {
        const h = makeController({ ...base, status: 'cancelled' });

        await expect(h.controller.reissueInvoice('fi-1')).rejects.toMatchObject({
            response: expect.objectContaining({ error: 'deliberately_not_issued' }),
        });
        expect(h.factus.deleteByReference).not.toHaveBeenCalled();
        expect(h.prisma.fiscalInvoice.update).not.toHaveBeenCalled();
        expect(h.fiscalService.requeue).not.toHaveBeenCalled();
    });

    it('rechaza re-emitir una omitida por no ser una venta', async () => {
        const h = makeController({ ...base, status: 'skipped' });

        await expect(h.controller.reissueInvoice('fi-1')).rejects.toMatchObject({
            response: expect.objectContaining({ error: 'deliberately_not_issued' }),
        });
        expect(h.fiscalService.requeue).not.toHaveBeenCalled();
    });

    it('sigue rechazando una ya validada por la DIAN', async () => {
        const h = makeController({ ...base, cufe: 'abc123', status: 'issued' });

        await expect(h.controller.reissueInvoice('fi-1')).rejects.toMatchObject({
            response: expect.objectContaining({ error: 'already_validated' }),
        });
    });

    it('sigue re-emitiendo una que falló de verdad', async () => {
        const h = makeController({ ...base, status: 'failed' });

        await expect(h.controller.reissueInvoice('fi-1')).resolves.toEqual({ success: true });
        expect(h.factus.deleteByReference).toHaveBeenCalledWith('fi-1');
        expect(h.fiscalService.requeue).toHaveBeenCalledWith('fi-1');
    });

    it('does not reset or delete the provider document when fiscal eligibility fails', async () => {
        const h = makeController({ ...base, status: 'blocked_config' });
        h.fiscalService.assertCanReissue.mockRejectedValue(new Error('fiscal_configuration_blocked'));
        await expect(h.controller.reissueInvoice('fi-1')).rejects.toThrow('fiscal_configuration_blocked');
        expect(h.factus.deleteByReference).not.toHaveBeenCalled();
        expect(h.prisma.fiscalInvoice.update).not.toHaveBeenCalled();
        expect(h.fiscalService.requeue).not.toHaveBeenCalled();
    });
});

describe('Fiscal re-emission preserves payment eligibility', () => {
    function harness(options: { internalNow?: boolean; snapshot?: boolean; environment?: string; country?: string; status?: string } = {}) {
        const invoice = { id: 'fi-1', tenantId: 't-1', paymentId: 'p-1', type: 'invoice', status: options.status ?? 'failed', provider: 'us_remote' };
        const payment = {
            id: 'p-1', tenantId: 't-1', amountCents: 2900, provider: 'stripe', status: 'succeeded',
            metadata: { railEnvironment: options.environment ?? 'production', billingCountryAtPayment: options.country ?? 'US',
                ...(options.snapshot === undefined ? {} : { tenantInternalAtPayment: options.snapshot }) },
        };
        const prisma = {
            billingPayment: { findUnique: jest.fn().mockResolvedValue(payment) },
            tenant: { findUnique: jest.fn().mockResolvedValue({ isInternal: options.internalNow ?? false, billingCountry: 'US' }) },
        };
        const config = { getConfig: jest.fn().mockResolvedValue({ usIssuer: { legalName: 'Example LLC', taxId: 'fixture' } }) };
        const service = new FiscalInvoiceService(prisma as any, config as any, {} as any, {} as any, {} as any);
        return { service, invoice };
    }

    it.each([
        { internalNow: false, snapshot: true },
        { internalNow: true },
        { environment: 'sandbox' },
    ])('rejects a payment that was not a sale: %j', async options => {
        const h = harness(options);
        await expect(h.service.assertCanReissue(h.invoice)).rejects.toMatchObject({ response: { error: 'deliberately_not_issued' } });
    });

    it.each([{ environment: 'unknown' }, { country: 'CO' }, { status: 'blocked_config' }])('does not bypass a fiscal block: %j', async options => {
        const h = harness(options);
        await expect(h.service.assertCanReissue(h.invoice)).rejects.toMatchObject({ response: { error: 'fiscal_configuration_blocked' } });
    });

    it('keeps a genuine historical sale eligible after the tenant becomes internal', async () => {
        const h = harness({ snapshot: false, internalNow: true });
        await expect(h.service.assertCanReissue(h.invoice)).resolves.toBeUndefined();
    });
});

describe('Fiscal test invoice requires the official sandbox', () => {
    const originalBaseUrl = process.env.FACTUS_BASE_URL;
    afterEach(() => {
        if (originalBaseUrl === undefined) delete process.env.FACTUS_BASE_URL;
        else process.env.FACTUS_BASE_URL = originalBaseUrl;
    });

    function harness(environment: string, baseUrl?: string) {
        if (baseUrl === undefined) delete process.env.FACTUS_BASE_URL;
        else process.env.FACTUS_BASE_URL = baseUrl;
        const config = { getConfig: jest.fn().mockResolvedValue({ factusEnvironment: environment, factusNumberingRangeId: 'sandbox-range', itemDescription: 'Test' }) };
        const factus = { issue: jest.fn().mockResolvedValue({ status: 'issued' }) };
        const controller = new FiscalAdminController(config as any, {} as any, {} as any, factus as any, {} as any);
        return { controller, factus };
    }

    it.each([
        ['production', 'https://api.factus.com.co'],
        ['production', 'https://api-sandbox.factus.com.co'],
        ['sandbox', 'https://api.factus.com.co'],
        ['sandbox', 'https://api-sandbox.factus.com.co.example.com'],
        ['sandbox', 'https://api-sandbox.factus.com.co@api.factus.com.co'],
        ['sandbox', 'http://api-sandbox.factus.com.co'],
    ])('rejects %s at %s without contacting Factus', async (environment, baseUrl) => {
        const h = harness(environment, baseUrl);
        await expect(h.controller.testInvoice()).rejects.toMatchObject({ response: { error: 'fiscal_test_requires_sandbox' } });
        expect(h.factus.issue).not.toHaveBeenCalled();
    });

    it.each([undefined, 'https://api-sandbox.factus.com.co'])('allows sandbox with base URL %s', async baseUrl => {
        const h = harness('sandbox', baseUrl);
        await expect(h.controller.testInvoice()).resolves.toMatchObject({ success: true });
        expect(h.factus.issue).toHaveBeenCalledTimes(1);
    });
});
