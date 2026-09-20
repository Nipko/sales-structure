import { Injectable, Logger } from '@nestjs/common';
import {
    CreditNoteData,
    FiscalInvoiceData,
    FiscalIssueResult,
    FiscalStatusResult,
    IFiscalInvoiceProvider,
} from '../interfaces/fiscal-provider.interface';

/**
 * US_REMOTE fiscal provider — used when fiscalMode='US_REMOTE' (the LLC bills
 * from the US). This adapter issues a plain commercial receipt (no CUFE or
 * DIAN validation); selecting it does not determine the seller's tax obligations.
 * The downloadable PDF
 * is served on demand by the billing module's existing receipt generator
 * (InvoiceGeneratorService) from the BillingPayment, so this adapter only
 * records that a commercial document applies and assigns a sequential-ish
 * reference.
 *
 * Tax treatment and any required additional documents must be configured for
 * the actual seller separately. Connecting Stripe does not select this adapter
 * or establish an issuer.
 */
@Injectable()
export class UsRemoteAdapter implements IFiscalInvoiceProvider {
    readonly name = 'us_remote';
    private readonly logger = new Logger(UsRemoteAdapter.name);

    async issue(data: FiscalInvoiceData): Promise<FiscalIssueResult> {
        this.logger.log(`[us_remote] Commercial receipt for tenant=${data.tenantId} ref=${data.referenceCode}`);
        return {
            status: 'issued',
            providerRef: data.referenceCode,
            invoiceNumber: this.receiptNumber(data.referenceCode),
            taxCents: 0,
            raw: { provider: 'us_remote', note: 'commercial receipt (no DIAN FEV)' },
        };
    }

    async issueCreditNote(data: CreditNoteData): Promise<FiscalIssueResult> {
        this.logger.log(`[us_remote] Commercial credit memo for tenant=${data.tenantId} ref=${data.referenceCode}`);
        return {
            status: 'issued',
            providerRef: data.referenceCode,
            invoiceNumber: this.receiptNumber(data.referenceCode, 'CM'),
            taxCents: 0,
            raw: { provider: 'us_remote', note: 'credit memo (no DIAN NC)' },
        };
    }

    async getStatus(providerRef: string): Promise<FiscalStatusResult> {
        return { status: 'issued', raw: { providerRef } };
    }

    private receiptNumber(referenceCode: string, prefix = 'REC'): string {
        return `${prefix}-${referenceCode.slice(0, 8).toUpperCase()}`;
    }
}
