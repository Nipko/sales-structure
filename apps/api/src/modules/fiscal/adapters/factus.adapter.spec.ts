import { FactusAdapter } from './factus.adapter';
import { CreditNoteData } from '../interfaces/fiscal-provider.interface';

describe('FactusAdapter issuance and read-only diagnostics', () => {
    const originalBaseUrl = process.env.FACTUS_BASE_URL;
    const cfg = () => ({
        factusEnvironment: 'production', factusNumberingRangeId: '2241', factusCreditNumberingRangeId: '2242',
        defaultMunicipalityId: null, itemCodeReference: 'PARALLLY', defaultUnitMeasureCode: '94', defaultStandardCode: '999',
    });
    const range = (credit = false) => ({
        id: credit ? 2242 : 2241, document: credit ? 'Nota Crédito' : 'Factura de Venta', prefix: credit ? 'NC' : 'AT',
        from: 1, to: 1000, current: 1, is_active: 1, is_expired: 0,
        start_date: '2020-01-01', end_date: '2099-01-01', resolution_number: 'resolution-example', technical_key: 'never-return-this',
    });
    const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
    const credit: CreditNoteData = {
        referenceCode: 'local-credit-id', tenantId: 'tenant', originalProviderRef: '42', originalInvoiceNumber: 'AT1',
        amountCents: 10000, currency: 'COP', description: 'Refund', ivaTreatment: 'excluido',
        acquirer: { documentType: '3', documentId: '222222222222', legalOrganizationId: '2', names: 'Consumidor Final' },
    };
    function fixture(patch: Record<string, unknown> = {}) {
        const config = { getConfig: jest.fn().mockResolvedValue({ ...cfg(), ...patch }) };
        const adapter = new FactusAdapter(config as any);
        const auth = jest.spyOn(adapter as any, 'getToken').mockResolvedValue('test-token');
        const http = jest.spyOn(adapter as any, 'authedFetch');
        return { adapter, config, auth, http };
    }
    beforeEach(() => { process.env.FACTUS_BASE_URL = 'https://api.factus.com.co'; });
    afterEach(() => {
        jest.restoreAllMocks();
        if (originalBaseUrl === undefined) delete process.env.FACTUS_BASE_URL;
        else process.env.FACTUS_BASE_URL = originalBaseUrl;
    });

    it('rejects an environment mismatch before submitting a credit note', async () => {
        const f = fixture({ factusEnvironment: 'sandbox' });
        await expect(f.adapter.issueCreditNote(credit)).rejects.toThrow('desalineada');
        expect(f.http).not.toHaveBeenCalled();
    });

    it('keeps an accepted credit note pending when no validated hash is available', async () => {
        const f = fixture();
        f.http.mockResolvedValueOnce(response({ data: [] }))
            .mockResolvedValueOnce(response({ data: { number: 'NC1', id: 50, is_validated: false } }))
            .mockResolvedValueOnce(response({ data: { number: 'NC1', id: 50, is_validated: false } }));
        await expect(f.adapter.issueCreditNote(credit)).resolves.toMatchObject({ status: 'pending', invoiceNumber: 'NC1', providerRef: '50' });
        expect(f.http.mock.calls[2]).toEqual(['/v2/credit-notes/NC1', { method: 'GET' }]);
        expect(f.http.mock.calls.some(([path]) => String(path).includes('/bills/'))).toBe(false);
    });

    it('does not accept an explicit unvalidated flag even if a hash is present', async () => {
        const f = fixture();
        f.http.mockResolvedValueOnce(response({ data: [] }))
            .mockImplementation(async () => response({ data: { number: 'NC1', cude: 'hash', is_validated: false } }));
        expect((await f.adapter.issueCreditNote(credit)).status).toBe('pending');
    });

    it('does not accept an empty hash or a true flag alone as an issued credit note', async () => {
        const f = fixture();
        f.http.mockResolvedValueOnce(response({ data: [] }))
            .mockResolvedValueOnce(response({ data: { is_validated: true, cude: '' } }));
        expect((await f.adapter.issueCreditNote(credit)).status).toBe('pending');
    });

    it('recovers a validated credit note with its own canonical GET endpoint', async () => {
        const f = fixture();
        f.http.mockResolvedValueOnce(response({ data: [] }))
            .mockResolvedValueOnce(response({ data: { credit_note: { id: 50, number: 'NC1' } } }))
            .mockResolvedValueOnce(response({ data: { credit_note: { id: 50, number: 'NC1', cude: 'validated-hash', is_validated: true } } }));
        await expect(f.adapter.issueCreditNote(credit)).resolves.toMatchObject({ status: 'issued', cufe: 'validated-hash', invoiceNumber: 'NC1' });
        expect(f.http.mock.calls[1][1]).toMatchObject({ method: 'POST', body: { reference_code: credit.referenceCode, bill_number: 'AT1' } });
    });

    it('retains pending when the canonical lookup is unavailable', async () => {
        const f = fixture();
        f.http.mockResolvedValueOnce(response({ data: [] }))
            .mockResolvedValueOnce(response({ data: { id: 50, number: 'NC1' } }))
            .mockRejectedValueOnce(new Error('network unavailable'));
        expect((await f.adapter.issueCreditNote(credit)).status).toBe('pending');
    });

    it('surfaces DIAN rejection from the canonical detail instead of issuing', async () => {
        const f = fixture();
        f.http.mockResolvedValueOnce(response({ data: [] }))
            .mockResolvedValueOnce(response({ data: { number: 'NC1' } }))
            .mockResolvedValueOnce(response({ data: { number: 'NC1', is_validated: false, errors: ['DIAN rechazo'] } }));
        await expect(f.adapter.issueCreditNote(credit)).resolves.toMatchObject({ status: 'failed', failureReason: 'DIAN rechazo' });
    });

    it.each([true, false])('reconciles an accepted credit note without POST or DELETE (validated=%s)', async (validated) => {
        const f = fixture();
        const note = { id: 50, number: 'NC1', reference_code: credit.referenceCode, is_validated: validated, cude: validated ? 'hash' : null };
        f.http.mockResolvedValueOnce(response({ data: { data: [note], pagination: { last_page: 1 } } }))
            .mockResolvedValueOnce(response({ data: note }));
        await expect(f.adapter.issueCreditNote(credit)).resolves.toMatchObject({ status: validated ? 'issued' : 'pending', invoiceNumber: 'NC1', providerRef: '50' });
        expect(f.http.mock.calls.every(([, options]) => (options as any).method === 'GET')).toBe(true);
        expect(f.http.mock.calls[0][0]).toContain(`filter[reference_code]=${credit.referenceCode}`);
    });

    it('recovers a credit note accepted concurrently when POST returns conflict', async () => {
        const f = fixture();
        const note = { id: 50, number: 'NC1', reference_code: credit.referenceCode, is_validated: true, cude: 'hash' };
        f.http.mockResolvedValueOnce(response({ data: [] }))
            .mockResolvedValueOnce(response({ message: 'pending document' }, 409))
            .mockResolvedValueOnce(response({ data: [note] }))
            .mockResolvedValueOnce(response({ data: note }));
        await expect(f.adapter.issueCreditNote(credit)).resolves.toMatchObject({ status: 'issued', cufe: 'hash' });
        expect(f.http.mock.calls.filter(([, options]) => (options as any).method === 'POST')).toHaveLength(1);
        expect(f.http.mock.calls.some(([, options]) => (options as any).method === 'DELETE')).toBe(false);
    });

    it('never borrows a different reference when resolving a conflict', async () => {
        const f = fixture();
        f.http.mockResolvedValueOnce(response({ data: [] }))
            .mockResolvedValueOnce(response({}, 409))
            .mockResolvedValueOnce(response({ data: [{ number: 'NC-other', reference_code: 'other', cude: 'other-hash' }] }));
        await expect(f.adapter.issueCreditNote(credit)).resolves.toMatchObject({ status: 'pending' });
        expect(f.http.mock.calls).toHaveLength(3);
    });

    it('does not create a credit note when the prior-attempt lookup fails', async () => {
        const f = fixture();
        f.http.mockResolvedValueOnce(response({}, 503));
        await expect(f.adapter.issueCreditNote(credit)).rejects.toThrow('lookup failed');
        expect(f.http.mock.calls.every(([, options]) => (options as any).method === 'GET')).toBe(true);
    });

    it.each(['list', 'detail'])('never reconciles an invoice from a different reference in its %s', async (mismatchAt) => {
        const f = fixture();
        const wrong = { id: 99, number: 'AT-other', reference_code: 'other', cufe: 'other-hash' };
        f.http.mockImplementation(async (path, options) => {
            const method = (options as { method: string }).method;
            if (method === 'POST') return response({}, 409);
            if (method === 'DELETE') return response({}, 404);
            if (String(path).includes('/show/')) return response({ data: { bill: wrong } });
            return response({ data: [{ ...wrong, reference_code: mismatchAt === 'list' ? 'other' : credit.referenceCode }] });
        });
        const result = await f.adapter.issue({ ...credit } as any);
        expect(result.status).toBe('pending');
        expect(result.cufe).toBeUndefined();
        expect(result.providerRef).toBeUndefined();
    });

    it('finds the exact credit-note reference on later pages before any mutation', async () => {
        const f = fixture();
        const note = { id: 50, number: 'NC1', reference_code: credit.referenceCode, is_validated: true, cude: 'hash' };
        f.http.mockResolvedValueOnce(response({ data: { data: [{ reference_code: 'other' }], last_page: 2 } }))
            .mockResolvedValueOnce(response({ data: { data: [note], last_page: 2 } }))
            .mockResolvedValueOnce(response({ data: note }));
        await expect(f.adapter.issueCreditNote(credit)).resolves.toMatchObject({ status: 'issued', invoiceNumber: 'NC1' });
        expect(f.http.mock.calls[1][0]).toContain('page=2');
        expect(f.http.mock.calls.every(([, options]) => (options as any).method === 'GET')).toBe(true);
    });

    it.each(['pdf', 'xml'] as const)('downloads credit-note %s from the credit-note route', async (format) => {
        const f = fixture();
        f.http.mockResolvedValue(response({ data: { [`${format}_base_64_encoded`]: Buffer.from('document').toString('base64') } }));
        const data = format === 'pdf' ? await f.adapter.downloadPdf('NC/1', 'credit_note') : await f.adapter.downloadXml('NC/1', 'credit_note');
        expect(data?.toString()).toBe('document');
        expect(f.http).toHaveBeenCalledWith(`/v2/credit-notes/NC%2F1/download-${format}`, { method: 'GET' });
    });

    it('reports authentication separately from a configured environment mismatch', async () => {
        const f = fixture({ factusEnvironment: 'sandbox' });
        f.http.mockResolvedValueOnce(response({ data: [range()] })).mockResolvedValueOnce(response({ data: [range(true)] }));
        const result = await f.adapter.testConnection();
        expect(result).toMatchObject({ ok: false, authenticated: true, apiEnvironment: 'production', configuredEnvironment: 'sandbox', blockers: ['factus_environment_mismatch'] });
        expect(JSON.stringify(result)).not.toMatch(/never-return-this|test-token|technical_key/);
        expect(f.http.mock.calls.every(([, options]) => (options as any).method === 'GET')).toBe(true);
    });

    it('verifies aligned environments and both live ranges without issuing a document', async () => {
        const f = fixture();
        f.http.mockResolvedValueOnce(response({ data: [range()] })).mockResolvedValueOnce(response({ data: [range(true)] }));
        await expect(f.adapter.testConnection()).resolves.toMatchObject({
            ok: true, authenticated: true, blockers: [],
            numberingRange: { configuredId: '2241', id: '2241', isActive: true, resolutionNumber: 'resolution-example' },
            creditNumberingRange: { configuredId: '2242', id: '2242' },
        });
        expect(f.http.mock.calls.every(([path, options]) => String(path).startsWith('/v2/numbering-ranges?') && (options as any).method === 'GET')).toBe(true);
    });

    it('allows an aligned sandbox diagnosis while distinguishing it from production', async () => {
        process.env.FACTUS_BASE_URL = 'https://api-sandbox.factus.com.co';
        const f = fixture({ factusEnvironment: 'sandbox' });
        f.http.mockResolvedValueOnce(response({ data: [range()] })).mockResolvedValueOnce(response({ data: [range(true)] }));
        await expect(f.adapter.testConnection()).resolves.toMatchObject({ ok: true, apiEnvironment: 'sandbox', configuredEnvironment: 'sandbox' });
    });

    it.each([
        [{ is_active: 0 }, 'inactive'], [{ is_expired: 1 }, 'expired'],
        [{ end_date: '2020-01-01' }, 'expired'], [{ start_date: '2099-01-01' }, 'not_yet_valid'],
        [{ current: 1001 }, 'exhausted'], [{ current: null }, 'invalid_bounds'], [{ document: 'Nota Débito' }, 'wrong_document'],
        [{ resolution_number: null }, 'resolution_missing'], [{ start_date: null }, 'invalid_dates'], [{ end_date: '2099-02-31' }, 'invalid_dates'],
    ])('blocks a selected unusable range (%s)', async (patch, expected) => {
        const f = fixture();
        f.http.mockResolvedValueOnce(response({ data: [{ ...range(), ...patch }] })).mockResolvedValueOnce(response({ data: [range(true)] }));
        const result = await f.adapter.testConnection();
        expect(result.ok).toBe(false);
        expect(result.blockers).toContain(`invoice_range_${expected}`);
    });

    it('does not silently use a different range when the selected credit range is missing', async () => {
        const f = fixture({ factusCreditNumberingRangeId: '100' });
        f.http.mockResolvedValueOnce(response({ data: [range()] })).mockResolvedValueOnce(response({ data: [range(true)] }));
        await expect(f.adapter.testConnection()).resolves.toMatchObject({ ok: false, creditNumberingRange: { configuredId: '100', id: null }, blockers: ['credit_range_not_found'] });
    });

    it('allows the documented single-active-credit-range default only without an explicit ID', async () => {
        const f = fixture({ factusCreditNumberingRangeId: null });
        f.http.mockResolvedValueOnce(response({ data: [range()] })).mockResolvedValueOnce(response({ data: [range(true)] }));
        await expect(f.adapter.testConnection()).resolves.toMatchObject({ ok: true, creditNumberingRange: { configuredId: null, id: '2242' } });
    });

    it('blocks ambiguous default credit ranges', async () => {
        const f = fixture({ factusCreditNumberingRangeId: null });
        f.http.mockResolvedValueOnce(response({ data: [range()] })).mockResolvedValueOnce(response({ data: [range(true), { ...range(true), id: 2243 }] }));
        expect((await f.adapter.testConnection()).blockers).toContain('credit_range_multiple_active');
    });

    it('does not expose provider authentication error content', async () => {
        const f = fixture();
        f.auth.mockRejectedValueOnce(new Error('upstream sensitive response'));
        const result = await f.adapter.testConnection();
        expect(result).toMatchObject({ ok: false, authenticated: false, blockers: ['factus_authentication_failed'] });
        expect(JSON.stringify(result)).not.toContain('sensitive');
        expect(f.http).not.toHaveBeenCalled();
    });

    it('rejects unknown endpoint environments before authenticating', async () => {
        process.env.FACTUS_BASE_URL = 'https://unexpected.example.test';
        const f = fixture();
        expect((await f.adapter.testConnection()).blockers).toContain('factus_api_environment_unknown');
        expect(f.auth).not.toHaveBeenCalled();
    });

    it('reads all reported pages rather than trusting an incomplete range list', async () => {
        const f = fixture();
        f.http.mockResolvedValueOnce(response({ data: { data: [range()], last_page: 2 } }))
            .mockResolvedValueOnce(response({ data: { data: [range(true)], last_page: 2 } }));
        expect(await f.adapter.listNumberingRanges()).toHaveLength(2);
        expect(f.http.mock.calls[1][0]).toContain('page=2');
    });
});
