import { Injectable, Logger } from '@nestjs/common';
import { FiscalConfigService } from '../fiscal-config.service';
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
 * Uses the "flat IDs" payload convention (tribute_id, is_excluded, tax_rate,
 * unit_measure_id, standard_code_id; customer.identification_document_id,
 * legal_organization_id, tribute_id, municipality_id) — the one confirmed by
 * the laravel-factus-sdk. Catalog values are read from FiscalConfigService so
 * they can be tuned against the sandbox without code changes.
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

    // DIAN payment catalog: 1 = contado, 48 = tarjeta de crédito (subscriptions
    // are card charges). These are not validity-critical and can be revisited.
    private readonly PAYMENT_FORM = '1';
    private readonly PAYMENT_METHOD_CODE = '48';
    private readonly DOCUMENT_TYPE = '01'; // factura electrónica de venta
    private readonly OPERATION_TYPE = '10'; // estándar
    private readonly ITEM_CODE_REFERENCE = 'PARALLLY-SUB';

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
            send_email: !!data.acquirer.email && cfg.factusEnvironment === 'production',
            customer: this.buildCustomer(data.acquirer, cfg),
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
        cfg: { defaultUnitMeasureId: string; defaultStandardCodeId: string; defaultProductTributeId: string },
    ): { item: Record<string, unknown> } {
        const excluded = iva === 'excluido';
        const netCents = excluded ? grossCents : Math.round(grossCents / 1.19);
        const price = +(netCents / 100).toFixed(2);
        return {
            item: {
                code_reference: this.ITEM_CODE_REFERENCE,
                name: description.slice(0, 200),
                quantity: 1,
                discount_rate: 0,
                price,
                tax_rate: excluded ? '0.00' : '19.00',
                unit_measure_id: Number(cfg.defaultUnitMeasureId),
                standard_code_id: Number(cfg.defaultStandardCodeId),
                is_excluded: excluded ? 1 : 0,
                tribute_id: Number(cfg.defaultProductTributeId),
            },
        };
    }

    private buildCustomer(a: FiscalAcquirer, cfg: { defaultMunicipalityId: string | null }): Record<string, unknown> {
        const customer: Record<string, unknown> = {
            identification: a.documentId,
            legal_organization_id: a.legalOrganizationId,
            tribute_id: a.tributeId || '21', // 21 = no responsable de IVA (default)
            identification_document_id: a.documentType,
            names: a.names || a.businessName || '',
            company: a.businessName || a.names || '',
        };
        if (a.dv) customer.dv = a.dv;
        if (a.address) customer.address = a.address;
        if (a.email) customer.email = a.email;
        if (a.phone) customer.phone = a.phone;
        const municipality = a.municipalityId || cfg.defaultMunicipalityId;
        if (municipality) customer.municipality_id = municipality;
        return customer;
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
            qrUrl: node?.qr ?? undefined,
            pdfUrl: node?.public_url ?? undefined,
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
}
