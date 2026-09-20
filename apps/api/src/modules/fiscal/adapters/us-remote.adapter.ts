import { Injectable, Logger } from '@nestjs/common';
import {
    CreditNoteData,
    FiscalInvoiceData,
    FiscalIssueResult,
    FiscalStatusResult,
    IFiscalInvoiceProvider,
} from '../interfaces/fiscal-provider.interface';

/**
 * US issuer for international Stripe payments in CO_LOCAL, or all payments
 * when fiscalMode='US_REMOTE'. This adapter issues a commercial receipt (no CUFE or
 * DIAN validation); selecting it does not determine the seller's tax obligations.
 * The fiscal PDF/email path renders the commercial document from the issued
 * FiscalInvoice; this adapter assigns its reference without claiming DIAN status.
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
