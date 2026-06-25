import { computeNitDv } from './nit.util';

/** Subset of Tenant.settings.fiscalData the gate cares about. */
export interface TenantFiscalData {
    documentType?: string;
    documentId?: string;
    dv?: string;
    legalOrganizationId?: string;
    businessName?: string;
    names?: string;
    [k: string]: unknown;
}

/**
 * Countries whose tenants must complete a fiscal profile BEFORE being charged
 * (collect tax identity at checkout, like Stripe/Paddle/Chargebee). Colombia
 * today; extend here when more DIAN-style jurisdictions go live.
 */
export function billingCountryRequiresFiscalData(country?: string | null): boolean {
    return (country || '').trim().toUpperCase() === 'CO';
}

/** Read the fiscalData object off Tenant.settings JSON, or null when absent. */
export function readFiscalData(settings: unknown): TenantFiscalData | null {
    const fd = (settings as any)?.fiscalData;
    return fd && typeof fd === 'object' && !Array.isArray(fd) ? (fd as TenantFiscalData) : null;
}

/**
 * Is the tenant's fiscal profile complete + valid enough to issue a DIAN
 * invoice? Mirrors FiscalController.setFiscalData so the gate and the form agree:
 * document type + id + organization type + the matching name field, and a valid
 * verification digit when the document is a NIT ('6').
 */
export function isFiscalDataComplete(settings: unknown): boolean {
    const fd = readFiscalData(settings);
    if (!fd) return false;
    if (!fd.documentType || !fd.documentId || !fd.legalOrganizationId) return false;
    if (fd.legalOrganizationId === '1' && !fd.businessName) return false; // persona jurídica
    if (fd.legalOrganizationId === '2' && !fd.names) return false; // persona natural
    if (fd.documentType === '6') {
        const expected = computeNitDv(String(fd.documentId));
        if (expected == null) return false;
        if (fd.dv != null && String(fd.dv) !== String(expected)) return false;
    }
    return true;
}
