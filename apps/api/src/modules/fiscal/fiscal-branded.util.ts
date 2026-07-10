import { BrandedInvoiceData } from './fiscal-pdf.service';
import { copAmountInWords } from './number-to-words.util';

/** Factus doc-type catalog code → human label for the graphic representation. */
const ACQUIRER_DOC_LABELS: Record<string, string> = {
    '1': 'RC', '2': 'TI', '3': 'CC', '4': 'TE', '5': 'CE', '6': 'NIT', '7': 'Pasaporte', '8': 'DIE', '10': 'NIT',
};
/** DIAN unit-of-measure code → label. */
const UNIT_MEASURE_LABELS: Record<string, string> = { '94': 'Unidad' };

/**
 * Build the branded-PDF data from a FiscalInvoice row + the fiscal config. Shared
 * by the download endpoints and the invoice-email sender so both render identically.
 * `acquirerFallback` = the tenant's current fiscalData, used when the invoice
 * snapshot is empty. `relatedInvoiceNumber` = affected invoice number for a credit note.
 */
export function buildBrandedInvoiceData(
    inv: any,
    cfg: any,
    acquirerFallback?: any,
    relatedInvoiceNumber?: string | null,
): BrandedInvoiceData {
    const snapRaw = (inv.acquirerSnapshot as any) || null;
    // Prefer the immutable snapshot; if it carries no document (was null at
    // creation, before the tenant had fiscal data), fall back to the tenant's
    // current fiscal data instead of wrongly printing "Consumidor Final".
    const snap = (snapRaw && snapRaw.documentId)
        ? snapRaw
        : (acquirerFallback && acquirerFallback.documentId ? acquirerFallback : (snapRaw || {}));
    const co = cfg.coIssuer || {};
    const us = cfg.usIssuer || {};
    const isCo = cfg.mode !== 'US_REMOTE';

    // Prefijo + consecutivo: el número DIAN viene como '<PREFIJO><consecutivo>'.
    const fullNumber = inv.invoiceNumber || String(inv.id).slice(0, 8).toUpperCase();
    const parts = /^([A-Za-z]+)\s*(\d+)$/.exec(fullNumber);
    const prefix = parts ? parts[1] : null;
    const consecutive = parts ? parts[2] : fullNumber;

    // Resolución/rango/prefijo AUTORITATIVOS desde Factus (metadata al emitir); si
    // no están, se usa la config manual del emisor.
    const nr = (inv.metadata as any)?.numberingRange || null;
    const resolvedPrefix = nr?.prefix || prefix;
    const dianResolution = nr?.resolution ? `Resolución ${nr.resolution}` : (isCo ? co.dianResolution ?? null : null);
    const authRange = (nr?.from != null && nr?.to != null) ? `${nr.from} — ${nr.to}` : (isCo ? co.authRange ?? null : null);
    const resolutionValidUntil = nr?.endDate ? String(nr.endDate) : (isCo ? co.resolutionValidUntil ?? null : null);

    // Documento del adquirente legible: código Factus → NIT/CC/… + DV.
    const docLabel = ACQUIRER_DOC_LABELS[String(snap.documentType ?? '')] || (snap.documentType ? String(snap.documentType) : '');
    const acquirerDoc = snap.documentId
        ? `${docLabel ? docLabel + ' ' : ''}${snap.documentId}${snap.dv ? '-' + snap.dv : ''}`.trim()
        : null;

    // Valor en letras solo en COP (US_REMOTE es recibo USD).
    const amountInWords = (inv.currency || '').toUpperCase() === 'COP' ? copAmountInWords(inv.amountCents) : null;

    return {
        type: inv.type,
        invoiceNumber: fullNumber,
        prefix: resolvedPrefix,
        consecutive,
        cufe: inv.cufe,
        // El QR de la DIAN es determinístico desde el CUFE.
        qrUrl: inv.qrUrl || (inv.cufe
            ? `https://${cfg.factusEnvironment === 'production' ? 'catalogo-vpfe' : 'catalogo-vpfe-hab'}.dian.gov.co/document/searchqr?documentkey=${inv.cufe}`
            : null),
        issuedAt: inv.issuedAt,
        amountCents: inv.amountCents,
        taxCents: inv.taxCents,
        currency: inv.currency,
        amountInWords,
        itemDescription: cfg.itemDescription,
        itemCode: cfg.itemCodeReference || null,
        unitMeasure: UNIT_MEASURE_LABELS[String(cfg.defaultUnitMeasureCode ?? '')] || 'Unidad',
        issuerName: isCo ? co.legalName || 'Parallly' : us.legalName || 'Parallly',
        issuerNit: isCo ? co.nit ?? null : us.taxId ?? null,
        issuerAddress: isCo ? co.address ?? null : us.address ?? null,
        issuerEmail: isCo ? co.email ?? null : us.email ?? null,
        issuerPhone: isCo ? co.phone ?? null : null,
        issuerRegime: isCo ? co.regime || 'Responsable de IVA' : null,
        dianResolution,
        authRange,
        resolutionValidUntil,
        acquirerName: snap.businessName || snap.names || null,
        acquirerDoc,
        acquirerEmail: snap.email || null,
        // Reflejamos lo que declaramos a la DIAN (payment_form 1 / payment_method_code 48).
        paymentMethod: 'Contado',
        paymentMeans: 'Tarjeta de crédito',
        trm: (inv.metadata as any)?.trmApplied ?? null,
        relatedInvoiceNumber: relatedInvoiceNumber ?? null,
    };
}
