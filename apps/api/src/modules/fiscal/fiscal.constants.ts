import { FiscalAcquirer } from './interfaces/fiscal-provider.interface';

/** BullMQ queue name for asynchronous fiscal invoice issuance. */
export const FISCAL_QUEUE = 'fiscal-invoice';

/** Max attempts for an issuance job before it is escalated as a permanent failure. */
export const FISCAL_MAX_ATTEMPTS = 5;

/**
 * DIAN "consumidor final" (adquirente no identificado, 222222222222) — the
 * legally-valid B2C fallback. Colombia requires a fiscal document for EVERY
 * sale, so when a tenant is charged before completing its fiscal profile the
 * processor issues to this acquirer instead of failing (exactly what a POS
 * does). Mirrors the canonical values FiscalController writes for the opt-in
 * "consumidor final" toggle, so the two paths are indistinguishable downstream.
 */
export const CONSUMIDOR_FINAL_ACQUIRER: FiscalAcquirer = {
    documentType: '3', // cédula de ciudadanía
    documentId: '222222222222',
    legalOrganizationId: '2', // persona natural
    names: 'Consumidor Final',
    tributeId: '21', // no responsable de IVA
};

/** Job payload for the fiscal invoice processor. */
export interface FiscalJobData {
    fiscalInvoiceId: string;
    kind: 'issue' | 'credit_note';
}
