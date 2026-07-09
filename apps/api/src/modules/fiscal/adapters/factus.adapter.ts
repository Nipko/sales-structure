import { Injectable, Logger } from '@nestjs/common';
import { FiscalConfigService, FiscalConfig } from '../fiscal-config.service';
import {
    CreditNoteData,
    FiscalAcquirer,
    FiscalInvoiceData,
    FiscalIssueResult,
    FiscalStatusResult,
    IFiscalInvoiceProvider,
    IvaTreatment,
} from '../interfaces/fiscal-provider.interface';

/**
 * Factus (Halltec) — DIAN electronic invoicing for Colombia, API v2.
 *
 * Implements IFiscalInvoiceProvider faithfully to the v2 documentation:
 *  - OAuth2 (grant_type=password, form-urlencoded) on POST {BASE}/oauth/token,
 *    refreshed with grant_type=refresh_token. Access token ~1h; we cache it in
 *    memory and refresh proactively.
 *  - Issue: POST /v2/bills/validate (creates + validates against DIAN in one
 *    call). Idempotent on reference_code (= our FiscalInvoice.id). The PDF is
 *    NOT in the response — it is fetched separately via GET
 *    /v2/bills/download-pdf/{number}; we keep the public_url as the link.
 *  - Credit note: POST /v2/credit-notes/validate referencing the original by
 *    bill_id (Factus internal id), correction_concept_code 1–6.
 *
 * Uses the current Factus "codes" payload convention enforced by
 * /bills/validate: top-level payment_details[] (payment_form, payment_method_code,
 * amount), and per item unit_measure_code, standard_code and a taxes[] array
 * ({code, rate}). For maximum compatibility the legacy "internal IDs" fields
 * (unit_measure_id, standard_code_id, tribute_id, tax_rate, is_excluded) are
 * still sent — the current validation ignores unknown keys. Catalog values are
 * read from FiscalConfigService so they can be tuned against the sandbox
 * without code changes.
 *
 * Credentials come from env (secrets), never the DB:
 *   FACTUS_BASE_URL (default sandbox), FACTUS_CLIENT_ID, FACTUS_CLIENT_SECRET,
 *   FACTUS_USERNAME (email), FACTUS_PASSWORD.
 *
 * Doc-faithful but not live-tested in dev (no Factus credentials here) — same
 * convention as the platform's other external adapters.
 */
@Injectable()
export class FactusAdapter implements IFiscalInvoiceProvider {
    readonly name = 'factus';
    private readonly logger = new Logger(FactusAdapter.name);

    // In-memory token cache (per process). The fiscal processor runs in the
    // worker process, so a single cache instance serves all issuances there.
    private accessToken: string | null = null;
    private refreshToken: string | null = null;
    private tokenExpiresAt = 0; // epoch ms

    // DANE/DIVIPOLA code -> Factus municipality_id. Municipios are static, so an
    // in-memory memo per process is enough (no Redis needed).
    private readonly municipalityCache = new Map<string, string>();

    // DIAN payment catalog: 1 = contado, 48 = tarjeta de crédito (subscriptions
    // are card charges). These are not validity-critical and can be revisited.
    private readonly PAYMENT_FORM = '1';
    private readonly PAYMENT_METHOD_CODE = '48';
    private readonly DOCUMENT_TYPE = '01'; // factura electrónica de venta
    private readonly OPERATION_TYPE = '10'; // estándar
    // DIAN tax catalog code for IVA, used in the item-level `taxes` array
    // (current Factus "codes" contract). 01 = IVA.
    private readonly IVA_TAX_CODE = '01';

    constructor(private readonly config: FiscalConfigService) {}

    private get baseUrl(): string {
        return (process.env.FACTUS_BASE_URL || 'https://api-sandbox.factus.com.co').replace(/\/+$/, '');
    }

    // -------------------------------------------------------------------------
    // Auth
    // -------------------------------------------------------------------------

    /** Return a valid access token, refreshing/logging in as needed. */
    private async getToken(): Promise<string> {
        const now = Date.now();
        if (this.accessToken && now < this.tokenExpiresAt - 60_000) {
            return this.accessToken;
        }
        if (this.refreshToken) {
            try {
                await this.requestToken({ grant_type: 'refresh_token', refresh_token: this.refreshToken });
                return this.accessToken as string;
            } catch (err: any) {
                this.logger.warn(`Factus token refresh failed (${err?.message}); falling back to password grant`);
            }
        }
        await this.requestToken({
            grant_type: 'password',
            username: process.env.FACTUS_USERNAME || '',
            password: process.env.FACTUS_PASSWORD || '',
        });
        return this.accessToken as string;
    }

    private async requestToken(extra: Record<string, string>): Promise<void> {
        const clientId = process.env.FACTUS_CLIENT_ID;
        const clientSecret = process.env.FACTUS_CLIENT_SECRET;
        if (!clientId || !clientSecret) {
            throw new Error('Factus credentials missing (FACTUS_CLIENT_ID / FACTUS_CLIENT_SECRET)');
        }
        const body = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...extra });

        const res = await fetch(`${this.baseUrl}/oauth/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
            body: body.toString(),
        });
        const json: any = await res.json().catch(() => ({}));
        if (!res.ok || !json?.access_token) {
            throw new Error(`Factus auth failed (${res.status}): ${json?.message || JSON.stringify(json).slice(0, 200)}`);
        }
        this.accessToken = json.access_token;
        this.refreshToken = json.refresh_token ?? this.refreshToken;
        const expiresIn = Number(json.expires_in) > 0 ? Number(json.expires_in) : 3600;
        this.tokenExpiresAt = Date.now() + expiresIn * 1000;
    }

    /** Authenticated JSON request with one automatic retry on 401. */
    private async authedFetch(path: string, init: { method: string; body?: unknown }): Promise<Response> {
        const doFetch = async () => {
            const token = await this.getToken();
            return fetch(`${this.baseUrl}${path}`, {
                method: init.method,
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                },
                body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
            });
        };
        let res = await doFetch();
        if (res.status === 401) {
            // Token may have been revoked early — force a re-login and retry once.
            this.accessToken = null;
            this.tokenExpiresAt = 0;
            res = await doFetch();
        }
        return res;
    }

    // -------------------------------------------------------------------------
    // Issue invoice
    // -------------------------------------------------------------------------

    async issue(data: FiscalInvoiceData): Promise<FiscalIssueResult> {
        const cfg = await this.config.getConfig();
        if (!cfg.factusNumberingRangeId) {
            throw new Error('Factus numbering_range_id not configured (fiscal.factus_numbering_range_id)');
        }

        const baseCents = data.copAmountCents ?? data.amountCents;
        const line = this.buildLine(data.description, baseCents, data.ivaTreatment, cfg);

        const payload: Record<string, unknown> = {
            numbering_range_id: Number(cfg.factusNumberingRangeId),
            document: this.DOCUMENT_TYPE,
            reference_code: data.referenceCode,
            observation: data.description,
            payment_form: this.PAYMENT_FORM,
            payment_method_code: this.PAYMENT_METHOD_CODE,
            operation_type: this.OPERATION_TYPE,
            // Current Factus contract requires payment_details (array); the sum of
            // amounts must equal the invoice total incl. taxes (= the gross charge).
            payment_details: this.buildPaymentDetails(baseCents),
            send_email: !!data.acquirer.email && cfg.factusEnvironment === 'production',
            customer: await this.buildCustomer(data.acquirer, cfg),
            items: [line.item],
        };

        const res = await this.authedFetch('/v2/bills/validate', { method: 'POST', body: payload });
        return this.parseIssueResponse(res, 'bill');
    }

    // -------------------------------------------------------------------------
    // Credit note
    // -------------------------------------------------------------------------

    async issueCreditNote(data: CreditNoteData): Promise<FiscalIssueResult> {
        const cfg = await this.config.getConfig();
        const baseCents = data.amountCents;
        const line = this.buildLine(data.description, baseCents, data.ivaTreatment, cfg);

        const payload: Record<string, unknown> = {
            reference_code: data.referenceCode,
            correction_concept_code: data.correctionConceptCode || '2', // 2 = anulación
            customization_id: '20',
            bill_id: Number(data.originalProviderRef),
            observation: (data.reason || 'Reembolso').slice(0, 250),
            payment_method_code: this.PAYMENT_METHOD_CODE,
            payment_details: this.buildPaymentDetails(baseCents),
            items: [line.item],
        };
        if (cfg.factusCreditNumberingRangeId) {
            payload.numbering_range_id = Number(cfg.factusCreditNumberingRangeId);
        }

        const res = await this.authedFetch('/v2/credit-notes/validate', { method: 'POST', body: payload });
        return this.parseIssueResponse(res, 'credit_note');
    }

    // -------------------------------------------------------------------------
    // Status
    // -------------------------------------------------------------------------

    async getStatus(providerRef: string): Promise<FiscalStatusResult> {
        // providerRef may be the bill number; show endpoint takes the number.
        const res = await this.authedFetch(`/v2/bills/show/${encodeURIComponent(providerRef)}`, { method: 'GET' });
        const json: any = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(`Factus getStatus failed (${res.status}): ${json?.message || ''}`);
        }
        const bill = json?.data?.bill ?? json?.data ?? {};
        return { status: String(bill?.status ?? json?.status ?? 'unknown'), raw: json };
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    /**
     * Build the single subscription line. The charged amount is treated as
     * IVA-INCLUSIVE: for 'gravado_19' the unit price is the net (amount / 1.19)
     * so Factus recomputes a tax that totals the charge; for 'excluido' the
     * price IS the amount and no IVA is added (is_excluded=1).
     */
    private buildLine(
        description: string,
        grossCents: number,
        iva: IvaTreatment,
        cfg: FiscalConfig,
    ): { item: Record<string, unknown> } {
        const excluded = iva === 'excluido';
        const netCents = excluded ? grossCents : Math.round(grossCents / 1.19);
        const price = +(netCents / 100).toFixed(2);
        return {
            item: {
                code_reference: cfg.itemCodeReference,
                name: description.slice(0, 200),
                quantity: 1,
                discount_rate: 0,
                price,
                // Current Factus "codes" contract (the one bills/validate enforces):
                unit_measure_code: cfg.defaultUnitMeasureCode,
                standard_code: cfg.defaultStandardCode,
                // For 'gravado_19' Factus recomputes IVA from this rate on the net
                // price. For 'excluido' there is no IVA: we send a 0.00 IVA line and
                // keep is_excluded=1 so the document is classified as excluded.
                // NOTE: confirm against the Factus docs whether an excluded line
                // should instead carry taxes:[] or a distinct tribute code.
                taxes: [{ code: this.IVA_TAX_CODE, rate: excluded ? '0.00' : '19.00' }],
                // Legacy "internal IDs" contract — accepted/ignored by the current
                // validation; kept for backward compatibility across Factus versions.
                tax_rate: excluded ? '0.00' : '19.00',
                unit_measure_id: Number(cfg.defaultUnitMeasureId),
                standard_code_id: Number(cfg.defaultStandardCodeId),
                is_excluded: excluded ? 1 : 0,
                tribute_id: Number(cfg.defaultProductTributeId),
            },
        };
    }

    /**
     * Build the payment_details array required by the current Factus contract.
     * One entry is enough for our single-charge subscriptions; the amount must
     * equal the invoice total including taxes (= the gross charge in COP).
     */
    private buildPaymentDetails(grossCents: number): Array<Record<string, unknown>> {
        return [
            {
                payment_form: this.PAYMENT_FORM,
                payment_method_code: this.PAYMENT_METHOD_CODE,
                amount: (grossCents / 100).toFixed(2),
            },
        ];
    }

    private async buildCustomer(a: FiscalAcquirer, cfg: { defaultMunicipalityId: string | null }): Promise<Record<string, unknown>> {
        const tributeId = a.tributeId || '21'; // 21 = no responsable de IVA (default)
        const customer: Record<string, unknown> = {
            identification: a.documentId,
            names: a.names || a.businessName || '',
            company: a.businessName || a.names || '',
            // Current Factus "codes" contract. identification_document_code is the
            // DIAN document-type code (NOT our Factus catalog id): cédula=13, NIT=31.
            // tribute_code is the DIAN tribute code (01 IVA, ZZ no aplica) — also
            // distinct from our internal tribute_id (18/21). legal_organization
            // (1/2) happens to coincide.
            identification_document_code: this.dianDocTypeCode(a.documentType),
            legal_organization_code: a.legalOrganizationId,
            tribute_code: this.dianTributeCode(tributeId),
            // Legacy "internal IDs" contract — kept for compatibility; ignored by
            // the current validation.
            legal_organization_id: a.legalOrganizationId,
            tribute_id: tributeId,
            identification_document_id: a.documentType,
        };
        if (a.dv) customer.dv = a.dv;
        if (a.address) customer.address = a.address;
        if (a.email) customer.email = a.email;
        if (a.phone) customer.phone = a.phone;
        // municipality_code (codes contract) is the DANE/DIVIPOLA code directly.
        if (a.daneCode) customer.municipality_code = a.daneCode;
        // Legacy municipality_id: an explicit Factus id wins; otherwise resolve it
        // from the DANE/DIVIPOLA code; otherwise the configured default.
        const municipality =
            a.municipalityId ||
            (a.daneCode ? await this.resolveMunicipalityId(a.daneCode) : null) ||
            cfg.defaultMunicipalityId;
        if (municipality) customer.municipality_id = municipality;
        return customer;
    }

    /**
     * Map our Factus identification_document catalog id to the DIAN
     * identification_document_code the current Factus "codes" contract expects
     * (Factus id → DIAN code: 3→13 cédula, 6→31 NIT, 5→22 céd. extranjería,
     * 7→41 pasaporte, …). Falls back to the input value if unmapped.
     */
    private dianDocTypeCode(factusDocType: string | undefined): string {
        const map: Record<string, string> = {
            '1': '11', // Registro civil
            '2': '12', // Tarjeta de identidad
            '3': '13', // Cédula de ciudadanía
            '4': '21', // Tarjeta de extranjería
            '5': '22', // Cédula de extranjería
            '6': '31', // NIT
            '7': '41', // Pasaporte
            '8': '42', // Documento de identificación de extranjero
            '10': '50', // NIT de otro país
        };
        return map[String(factusDocType ?? '')] ?? String(factusDocType ?? '');
    }

    /**
     * Map our internal customer tribute_id to the DIAN tribute_code the current
     * Factus "codes" contract expects. DIAN customer tributos: '01' IVA, '04' INC,
     * 'ZA' IVA e INC, 'ZZ' No aplica. Our catalog uses '18' (responsable de IVA)
     * and '21' (no responsable) — the latter maps to 'ZZ', which also covers
     * "consumidor final". Defaults to 'ZZ' (no aplica) for any unmapped value.
     */
    private dianTributeCode(factusTributeId: string | undefined): string {
        const map: Record<string, string> = {
            '18': '01', // Responsable de IVA
            '21': 'ZZ', // No responsable / No aplica (consumidor final)
        };
        return map[String(factusTributeId ?? '')] ?? 'ZZ';
    }

    /** Resolve the Factus internal municipality_id from a 5-digit DANE/DIVIPOLA code (cached in-memory). */
    private async resolveMunicipalityId(daneCode: string): Promise<string | null> {
        const code = (daneCode || '').trim();
        if (!code) return null;
        const cached = this.municipalityCache.get(code);
        if (cached) return cached;
        try {
            const res = await this.authedFetch(`/v2/municipalities?filter[code]=${encodeURIComponent(code)}`, { method: 'GET' });
            const json: any = await res.json().catch(() => ({}));
            const list: any[] = Array.isArray(json?.data) ? json.data : Array.isArray(json?.data?.data) ? json.data.data : [];
            const match = list.find((m) => String(m.code) === code) || list[0];
            const id = match?.id != null ? String(match.id) : null;
            if (id) this.municipalityCache.set(code, id);
            return id;
        } catch (err: any) {
            this.logger.warn(`Factus municipality resolve failed for ${code}: ${err?.message}`);
            return null;
        }
    }

    /**
     * Parse a bills/credit-notes validate response into a normalized result.
     * Distinguishes non-retryable validation rejections (400/422 → returns
     * {status:'failed'}) from transient/server errors (throws → BullMQ retry).
     */
    private async parseIssueResponse(res: Response, kind: 'bill' | 'credit_note'): Promise<FiscalIssueResult> {
        const json: any = await res.json().catch(() => ({}));

        if (!res.ok) {
            // DIAN/validation rejections won't pass on retry — surface as failed.
            if (res.status === 400 || res.status === 422) {
                return { status: 'failed', failureReason: this.formatErrors(json), raw: json };
            }
            // 401/403/409/429/5xx and anything else → retryable.
            throw new Error(`Factus ${kind} HTTP ${res.status}: ${this.formatErrors(json)}`);
        }

        const node = json?.data?.[kind] ?? json?.data?.bill ?? json?.data ?? {};
        const errors = node?.errors;
        if (Array.isArray(errors) && errors.length > 0) {
            return { status: 'failed', failureReason: this.formatErrors(json), raw: json };
        }

        const total = node?.total != null ? Math.round(parseFloat(String(node.total)) * 100) : undefined;
        const tax = node?.tax_amount != null ? Math.round(parseFloat(String(node.tax_amount)) * 100) : undefined;
        const providerRef =
            node?.id != null ? String(node.id) : node?.number != null ? String(node.number) : undefined;

        return {
            status: 'issued',
            providerRef,
            invoiceNumber: node?.number != null ? String(node.number) : undefined,
            cufe: node?.cufe ?? node?.cude ?? undefined,
            // Factus returns `qr` (DIAN catalog URL) inside data.bill; be robust if
            // it ever sits at the data level. This is the string we render into a
            // QR image on the branded PDF. Present in sandbox too (DIAN habilitación).
            qrUrl: node?.qr ?? json?.data?.qr ?? undefined,
            pdfUrl: node?.public_url ?? json?.data?.public_url ?? undefined,
            taxCents: tax,
            raw: { status: json?.status, total, node },
        };
    }

    /** Flatten Factus error shapes (data.errors object|array, message) into one string. */
    private formatErrors(json: any): string {
        if (!json) return 'unknown error';
        const errs = json?.data?.errors ?? json?.errors;
        if (Array.isArray(errs)) {
            return errs.map((e: any) => (typeof e === 'string' ? e : e?.message || JSON.stringify(e))).join('; ').slice(0, 500);
        }
        if (errs && typeof errs === 'object') {
            return Object.entries(errs).map(([k, v]) => `${k}: ${v}`).join('; ').slice(0, 500);
        }
        return (json?.message || json?.data?.message || 'unknown error').toString().slice(0, 500);
    }

    // -------------------------------------------------------------------------
    // Document download (PDF/XML) — base64 from Factus, decoded to Buffer
    // -------------------------------------------------------------------------

    /** Download the official Factus PDF (graphic representation) for an invoice number. */
    async downloadPdf(number: string): Promise<Buffer | null> {
        return this.downloadDocument(`/v2/bills/download-pdf/${encodeURIComponent(number)}`);
    }

    /** Download the DIAN-signed XML for an invoice number. */
    async downloadXml(number: string): Promise<Buffer | null> {
        return this.downloadDocument(`/v2/bills/download-xml/${encodeURIComponent(number)}`);
    }

    private async downloadDocument(apiPath: string): Promise<Buffer | null> {
        const res = await this.authedFetch(apiPath, { method: 'GET' });
        if (!res.ok) {
            this.logger.warn(`Factus download ${apiPath} failed (${res.status})`);
            return null;
        }
        const json: any = await res.json().catch(() => ({}));
        const b64 =
            json?.data?.pdf_base64_encoded ??
            json?.data?.xml_base64_encoded ??
            json?.data?.file ??
            json?.data?.content;
        if (!b64 || typeof b64 !== 'string') {
            this.logger.warn(`Factus download ${apiPath} returned no base64 payload`);
            return null;
        }
        try {
            return Buffer.from(b64, 'base64');
        } catch {
            return null;
        }
    }

    // -------------------------------------------------------------------------
    // Admin helpers — connection test + numbering ranges
    // -------------------------------------------------------------------------

    /** Verify Factus credentials by requesting a token. */
    async testConnection(): Promise<{ ok: boolean; message: string }> {
        try {
            await this.getToken();
            return { ok: true, message: `Conectado a ${this.baseUrl}` };
        } catch (err: any) {
            return { ok: false, message: err?.message || 'auth_failed' };
        }
    }

    /** List the issuer's numbering ranges so the admin can pick numbering_range_id. */
    async listNumberingRanges(): Promise<any[]> {
        const res = await this.authedFetch('/v2/numbering-ranges', { method: 'GET' });
        const json: any = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(`Factus numbering-ranges failed (${res.status}): ${this.formatErrors(json)}`);
        }
        const data = json?.data;
        return Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
    }
}
