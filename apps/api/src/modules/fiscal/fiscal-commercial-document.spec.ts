// @ts-expect-error -- pdf-parse does not ship TypeScript declarations.
import * as parsePdf from 'pdf-parse';
import { buildBrandedInvoiceData } from './fiscal-branded.util';
import { FiscalPdfService } from './fiscal-pdf.service';
import { fiscalInvoiceEmail } from '../email/email-layouts';

describe('International Stripe commercial documents', () => {
    const config = {
        mode: 'CO_LOCAL',
        itemDescription: 'Parallly subscription',
        coIssuer: { legalName: 'Colombian seller', nit: 'CO-123' },
        usIssuer: { legalName: 'Parallext LLC', taxId: 'US-456', address: 'United States', email: 'billing@example.test' },
    };

    it('prints the LLC and customer on the actual PDF without Colombian tax claims', async () => {
        const data = buildBrandedInvoiceData({
            id: '12345678-1234-1234-1234-123456789000', provider: 'us_remote', type: 'invoice',
            invoiceNumber: 'REC-123', issuedAt: new Date('2026-09-20T12:00:00Z'),
            amountCents: 2999, taxCents: 0, currency: 'USD',
            acquirerSnapshot: { businessName: 'International buyer', email: 'buyer@example.test' },
        }, config);
        const pdf = await new FiscalPdfService().render(data);
        const { text } = await parsePdf(pdf);

        expect(text).toContain('COMMERCIAL RECEIPT');
        expect(text).toContain('Parallext LLC');
        expect(text).toContain('International buyer');
        expect(text).toContain('$29.99');
        expect(text).not.toMatch(/DIAN|CUFE|Colombian seller|CO-123/);
    });

    it('labels a reversal as a commercial credit memo and references the original', async () => {
        const data = buildBrandedInvoiceData({
            id: '12345678-1234-1234-1234-123456789001', provider: 'us_remote', type: 'credit_note',
            invoiceNumber: 'CM-123', issuedAt: new Date('2026-09-20T12:00:00Z'),
            amountCents: 1250, taxCents: 0, currency: 'USD',
            acquirerSnapshot: { businessName: 'International buyer' },
        }, config, null, 'REC-123');
        expect(data.documentKind).toBe('commercial_receipt');
        expect(data.type).toBe('credit_note');
        expect(data.relatedInvoiceNumber).toBe('REC-123');
        const pdf = await new FiscalPdfService().render(data);
        expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    });

    it('sends a commercial email without DIAN validation or a signed XML claim', () => {
        const html = fiscalInvoiceEmail({
            invoiceNumber: 'REC-123', total: 'US$ 29,99', issuerName: 'Parallext LLC',
            commercial: true, cufe: 'should-never-appear', hasXml: true,
        });
        expect(html).toContain('recibo comercial');
        expect(html).toContain('Parallext LLC');
        expect(html).not.toMatch(/DIAN|CUFE|XML firmado|should-never-appear/);
    });
});
