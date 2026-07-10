/**
 * Provider-agnostic contract for fiscal (tax) invoicing.
 *
 * This is the fiscal twin of IPaymentProvider: it abstracts the issuance of a
 * legally-valid invoice (Colombian FEV via DIAN today, US commercial receipt
 * tomorrow) away from BOTH the payment provider (MercadoPago/Stripe) and the
 * rest of the platform. Adapters (FactusAdapter, UsRemoteAdapter, …) implement
 * this; FiscalProviderFactory picks one per request based on the global fiscal
 * mode + the tenant's billing country.
 *
 * Design notes
 * ------------
 * - All methods are async and throw on provider errors. The processor owns
 *   retries (BullMQ) and escalation; adapters just surface the failure.
 * - issue() must be idempotent on `referenceCode` (we pass FiscalInvoice.id):
 *   re-issuing the same reference must not create a duplicate fiscal document.
 *   Factus enforces this natively via reference_code.
 * - getStatus() lets the reconciliation/retry path check a document already
 *   created on the provider side without re-issuing.
 */

export type FiscalMode = 'CO_LOCAL' | 'US_REMOTE';
export type IvaTreatment = 'excluido' | 'gravado_19';

/** Acquirer (the customer being invoiced) — resolved from Tenant.settings.fiscalData. */
export interface FiscalAcquirer {
    /** Factus identification_document_id (e.g. '6' NIT, '3' cédula). */
    documentType: string;
    /** Identification number WITHOUT the verification digit. */
    documentId: string;
    /** Verification digit (DV) — required for NIT. */
    dv?: string;
    /** Factus legal_organization_id: '1' persona jurídica, '2' persona natural. */
    legalOrganizationId: string;
    /** Razón social (persona jurídica). */
    businessName?: string;
    /** Nombres (persona natural). */
    names?: string;
    /** Factus customer tribute_id (e.g. '18' responsable IVA, '21' no responsable). */
    tributeId?: string;
    address?: string;
    /** Factus municipality_id (internal id, NOT the raw DANE/DIVIPOLA code). */
    municipalityId?: string;
    /** DIVIPOLA / DANE code — kept for UI/reference. */
    daneCode?: string;
    email?: string;
    phone?: string;
}

/** Everything an adapter needs to issue one fiscal invoice for a charge. */
export interface FiscalInvoiceData {
    /** Our FiscalInvoice.id — used as the provider reference_code (idempotency). */
    referenceCode: string;
    tenantId: string;
    /** Total charged, in cents, in `currency`. The adapter converts to COP if needed. */
    amountCents: number;
    currency: string;
    /** Human description shown on the invoice line (e.g. "Suscripción Parallly Pro"). */
    description: string;
    acquirer: FiscalAcquirer;
    /** How the IVA line should be expressed (driven by the global coIvaTreatment setting). */
    ivaTreatment: IvaTreatment;
    paidAt?: Date;
    /** Optional override of the line amount already converted to COP (set by processor for FX). */
    copAmountCents?: number;
}

/** Issue a credit note (nota crédito) against a previously-issued invoice. */
export interface CreditNoteData {
    /** Our new FiscalInvoice.id for the credit note — provider reference_code. */
    referenceCode: string;
    tenantId: string;
    /** Provider's internal id of the original invoice (Factus bill_id). */
    originalProviderRef: string;
    /** DIAN number of the original invoice (Factus bill_number) — required by the credit note. */
    originalInvoiceNumber?: string;
    amountCents: number;
    currency: string;
    description: string;
    acquirer: FiscalAcquirer;
    ivaTreatment: IvaTreatment;
    /** DIAN correction concept code (Factus correction_concept_code, 1–6). Default '2' (anulación). */
    correctionConceptCode?: string;
    reason?: string;
}

/** Normalized result of an issuance (invoice or credit note). */
export interface FiscalIssueResult {
    /**
     * 'issued' = DIAN-validated (CUFE present). 'pending' = accepted by the
     * provider but not yet validated by the DIAN (no CUFE) — must be polled, NOT
     * treated as done. 'failed' = non-retryable rejection.
     */
    status: 'issued' | 'failed' | 'pending';
    /** Provider internal id (Factus bill_id) — persisted so credit notes can reference it. */
    providerRef?: string;
    /** DIAN number/consecutive (prefix + number, e.g. SETP990000001). */
    invoiceNumber?: string;
    cufe?: string;
    qrUrl?: string;
    pdfUrl?: string;
    xmlUrl?: string;
    taxCents?: number;
    failureReason?: string;
    /** Raw provider payload for audit/metadata. */
    raw?: unknown;
}

export interface FiscalStatusResult {
    status: string;
    raw?: unknown;
}

export interface IFiscalInvoiceProvider {
    /** Adapter id stored on FiscalInvoice.provider and used by the factory. */
    readonly name: string;

    /** Issue (create + validate) a fiscal invoice. Idempotent on data.referenceCode. */
    issue(data: FiscalInvoiceData): Promise<FiscalIssueResult>;

    /** Issue a credit note against an already-issued invoice. */
    issueCreditNote(data: CreditNoteData): Promise<FiscalIssueResult>;

    /** Fetch the current status of a previously created document. */
    getStatus(providerRef: string): Promise<FiscalStatusResult>;
}
