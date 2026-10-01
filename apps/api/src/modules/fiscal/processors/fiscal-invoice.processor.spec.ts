import { FiscalInvoiceProcessor } from './fiscal-invoice.processor';
import { FiscalInvoiceService } from '../fiscal-invoice.service';

describe('FiscalInvoiceProcessor durable issuance decisions', () => {
    function harness(status = 'pending') {
        const invoice: any = {
            id: 'fi-1', tenantId: 't-1', status, type: 'invoice', provider: 'factus',
            amountCents: 120000, currency: 'COP', paymentId: 'p-1', cufe: null, invoiceNumber: null,
        };
        const payment: any = { id: 'p-1', tenantId: 't-1', provider: 'wompi', amountCents: 120000, status: 'succeeded',
            metadata: { railEnvironment: 'production', billingCountryAtPayment: 'CO', tenantInternalAtPayment: false } };
        const tenant = { settings: {}, isInternal: false, billingCountry: 'CO' };
        const prisma = {
            fiscalInvoice: {
                findUnique: jest.fn(async (_args?: any) => ({ ...invoice })),
                update: jest.fn(async ({ data }: any) => Object.assign(invoice, data)),
            },
            tenant: { findUnique: jest.fn().mockResolvedValue(tenant) },
            billingPayment: { findUnique: jest.fn().mockResolvedValue(payment) },
        };
        const config = { getConfig: jest.fn().mockResolvedValue({ itemDescription: 'Subscription', coIvaTreatment: 'excluido' }) };
        const provider = { name: 'factus', issue: jest.fn().mockResolvedValue({ status: 'pending', providerRef: 'factus-1' }), issueCreditNote: jest.fn() };
        const factory = { getByName: jest.fn().mockReturnValue(provider) };
        const factus = { downloadPdf: jest.fn().mockResolvedValue(null), downloadXml: jest.fn().mockResolvedValue(null), getNumberingRange: jest.fn().mockResolvedValue(null) };
        const email = { sendIssuedInvoice: jest.fn().mockResolvedValue(undefined) };
        let lockHeld = false;
        const redis = {
            acquireLockToken: jest.fn(async () => { if (lockHeld) return null; lockHeld = true; return 'owner'; }),
            releaseLockToken: jest.fn(async () => { lockHeld = false; }),
        };
        const service = new FiscalInvoiceService(prisma as any, config as any, factory as any, {} as any, redis as any);
        jest.spyOn(service as any, 'isProviderReady').mockImplementation((_name, _cfg, environment) => environment === 'production');
        const processor = new FiscalInvoiceProcessor(prisma as any, config as any, factory as any, factus as any, {} as any, email as any, redis as any, service);
        const job: any = { data: { fiscalInvoiceId: invoice.id, kind: 'issue' }, attemptsMade: 4, opts: { attempts: 5 } };
        return { invoice, payment, tenant, prisma, provider, processor, service, job, redis, config, factus };
    }

    it.each(['cancelled', 'skipped', 'blocked_config'])('never issues an old queued job whose invoice is %s', async (status) => {
        const h = harness(status);
        await h.processor.process(h.job);
        expect(h.provider.issue).not.toHaveBeenCalled();
        expect(h.provider.issueCreditNote).not.toHaveBeenCalled();
        expect(h.prisma.fiscalInvoice.update).not.toHaveBeenCalled();
        expect(h.redis.releaseLockToken).toHaveBeenCalled();
    });

    it('honors a cancellation made after the job was queued', async () => {
        const h = harness();
        await expect(h.service.cancelPending('fi-1', 'not a sale')).resolves.toEqual({ ok: true });
        await h.processor.process(h.job);
        expect(h.provider.issue).not.toHaveBeenCalled();
        expect(h.invoice.status).toBe('cancelled');
    });

    it('refuses cancellation while the provider call is running', async () => {
        const h = harness();
        let finish!: (result: any) => void;
        let started!: () => void;
        const called = new Promise<void>(resolve => { started = resolve; });
        h.provider.issue.mockImplementation(() => new Promise(resolve => { finish = resolve; started(); }));
        const running = h.processor.process(h.job);
        await called;
        await expect(h.service.cancelPending('fi-1', 'not a sale')).rejects.toMatchObject({
            response: expect.objectContaining({ error: 'fiscal_issuance_in_progress' }),
        });
        finish({ status: 'pending', providerRef: 'factus-1', invoiceNumber: 'FV1' });
        await running;
        expect(h.invoice.status).toBe('pending');
        expect(h.invoice.invoiceNumber).toBe('FV1');
    });

    it.each(['internal', 'sandbox'])('skips an inherited pending job for a %s payment', async kind => {
        const h = harness();
        if (kind === 'internal') h.payment.metadata.tenantInternalAtPayment = true;
        else h.payment.metadata.railEnvironment = 'sandbox';
        await h.processor.process(h.job);
        expect(h.provider.issue).not.toHaveBeenCalled();
        expect(h.invoice.status).toBe('skipped');
        expect(h.invoice.metadata.skipReason).toBe(kind === 'internal' ? 'tenant_internal_use' : 'test_mode_payment');
    });

    it('preserves a genuine historical sale after the tenant becomes internal', async () => {
        const h = harness();
        h.tenant.isInternal = true;
        await h.processor.process(h.job);
        expect(h.provider.issue).toHaveBeenCalledTimes(1);
    });

    it.each(['pending', 'failed'])('never issues a new document for a %s payment', async status => {
        const h = harness();
        h.payment.status = status;
        await h.processor.process(h.job);
        expect(h.provider.issue).not.toHaveBeenCalled();
        expect(h.invoice.status).toBe('blocked_config');
        expect(h.invoice.failureReason).toBe('fiscal_payment_not_settled');
    });

    it('retains an ambiguous old attempt for review instead of declaring it skipped', async () => {
        const h = harness();
        h.invoice.attempts = 1;
        h.payment.metadata.tenantInternalAtPayment = true;
        await h.processor.process(h.job);
        expect(h.provider.issue).not.toHaveBeenCalled();
        expect(h.invoice.status).toBe('blocked_config');
        expect(h.invoice.failureReason).toBe('issuance_outcome_unknown');
    });

    it('reconciles an already accepted document despite later classification changes', async () => {
        const h = harness();
        h.invoice.providerRef = 'already-accepted';
        h.payment.metadata.tenantInternalAtPayment = true;
        await h.processor.process(h.job);
        expect(h.provider.issue).toHaveBeenCalledTimes(1);
        expect(h.invoice.status).toBe('pending');
    });

    function creditNote(options: { provider?: string; taxCents?: number; metadata?: any; full?: boolean } = {}) {
        const h = harness();
        h.invoice.type = 'credit_note';
        h.invoice.provider = options.provider ?? 'factus';
        h.provider.name = h.invoice.provider;
        h.invoice.paymentId = null;
        h.invoice.relatedInvoiceId = 'original-1';
        h.invoice.amountCents = options.full ? 11900 : 5950;
        const original = { ...h.invoice, id: 'original-1', type: 'invoice', paymentId: 'p-1',
            status: 'issued', cufe: 'original-hash',
            providerRef: 'provider-original', invoiceNumber: 'FV1', amountCents: 11900,
            taxCents: options.taxCents ?? 0, metadata: options.metadata ?? {} };
        h.prisma.fiscalInvoice.findUnique.mockImplementation(async ({ where }: any) => where.id === original.id ? original : { ...h.invoice });
        h.provider.issueCreditNote.mockResolvedValue({ status: 'issued', providerRef: 'credit-1', invoiceNumber: 'NC1', cufe: 'credit-hash', taxCents: 0 });
        return { ...h, original };
    }

    it('uses the original tax treatment after configuration changes and downloads credit-note files', async () => {
        const h = creditNote({ metadata: { ivaTreatment: 'excluido' } });
        h.config.getConfig.mockResolvedValue({ itemDescription: 'Subscription', coIvaTreatment: 'gravado_19' });
        await h.processor.process(h.job);
        expect(h.provider.issueCreditNote).toHaveBeenCalledWith(expect.objectContaining({ ivaTreatment: 'excluido', correctionConceptCode: '1' }));
        expect(h.factus.downloadPdf).toHaveBeenCalledWith('NC1', 'credit_note');
        expect(h.factus.downloadXml).toHaveBeenCalledWith('NC1', 'credit_note');
        expect(h.invoice.metadata.ivaTreatment).toBe('excluido');
    });

    it('uses cancellation concept only for a refund matching the full original amount', async () => {
        const h = creditNote({ full: true });
        await h.processor.process(h.job);
        expect(h.provider.issueCreditNote).toHaveBeenCalledWith(expect.objectContaining({ correctionConceptCode: '2' }));
    });

    it('recovers the legacy 19-percent treatment only from the exact stored tax', async () => {
        const h = creditNote({ taxCents: 1900 });
        await h.processor.process(h.job);
        expect(h.provider.issueCreditNote).toHaveBeenCalledWith(expect.objectContaining({ ivaTreatment: 'gravado_19' }));
    });

    it.each([{ taxCents: 1800 }, { taxCents: 1900, metadata: { trmApplied: 4000 } }])('blocks ambiguous legacy taxes: %j', async options => {
        const h = creditNote(options);
        await h.processor.process(h.job);
        expect(h.provider.issueCreditNote).not.toHaveBeenCalled();
        expect(h.invoice.failureReason).toBe('missing_original_tax_treatment');
    });

    it('keeps the original LLC issuer on a credit memo after issuer settings change', async () => {
        const issuer = { legalName: 'Original LLC', taxId: 'original-tax-id' };
        const h = creditNote({ provider: 'us_remote', metadata: { issuerSnapshot: issuer } });
        h.config.getConfig.mockResolvedValue({ itemDescription: 'Subscription', coIvaTreatment: 'excluido', usIssuer: { legalName: 'Different LLC', taxId: 'new-tax-id' } } as any);
        await h.processor.process(h.job);
        expect(h.provider.issueCreditNote).toHaveBeenCalledTimes(1);
        expect(h.invoice.metadata.issuerSnapshot).toEqual(issuer);
    });

    it('blocks a legacy credit memo when its original issuer cannot be established', async () => {
        const h = creditNote({ provider: 'us_remote' });
        await h.processor.process(h.job);
        expect(h.provider.issueCreditNote).not.toHaveBeenCalled();
        expect(h.invoice.failureReason).toBe('missing_original_issuer_snapshot');
    });

    it.each(['internal', 'sandbox', 'legacy-now-internal'])('allows correction of an accepted original despite %s classification', async kind => {
        const h = creditNote();
        if (kind === 'internal') h.payment.metadata.tenantInternalAtPayment = true;
        else if (kind === 'sandbox') h.payment.metadata.railEnvironment = 'sandbox';
        else { delete h.payment.metadata.tenantInternalAtPayment; h.tenant.isInternal = true; }
        await h.processor.process(h.job);
        expect(h.provider.issueCreditNote).toHaveBeenCalledTimes(1);
        expect(h.invoice.status).toBe('issued');
    });
});
