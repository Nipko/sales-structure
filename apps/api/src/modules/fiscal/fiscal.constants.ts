/** BullMQ queue name for asynchronous fiscal invoice issuance. */
export const FISCAL_QUEUE = 'fiscal-invoice';

/** Max attempts for an issuance job before it is escalated as a permanent failure. */
export const FISCAL_MAX_ATTEMPTS = 5;

/** Job payload for the fiscal invoice processor. */
export interface FiscalJobData {
    fiscalInvoiceId: string;
    kind: 'issue' | 'credit_note';
}
