import {
    BadRequestException,
    Injectable,
    Logger,
    NotImplementedException,
    ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, timingSafeEqual } from 'crypto';
import { IPaymentProvider, WebhookSignatureContext } from './payment-provider.interface';
import { WompiConfigService } from './wompi-config.service';
import { ProviderCapabilities, WOMPI_CAPABILITIES } from './provider-capabilities';
import {
    AcceptanceContracts,
    ChargeInput,
    ChargeStatus,
    CheckoutLinkInput,
    IChargingProvider,
    PaymentSourceAuthorizationContext,
    ProviderCharge,
    ProviderCheckoutLink,
    ProviderPaymentSource,
    StartPaymentSourceInput,
} from './charging-provider.interface';
import { BillingEventType } from '../types/billing-event.enum';
import {
    CancelSubscriptionOptions,
    CreateCustomerInput,
    CreatePlanInput,
    CreateSubscriptionInput,
    NormalizedBillingEvent,
    PaymentProviderName,
    ProviderCustomer,
    ProviderPayment,
    ProviderPlan,
    ProviderSubscription,
} from '../types/provider-types';

/** Wompi transaction states. Everything starts PENDING — nothing settles synchronously. */
type WompiStatus = 'PENDING' | 'APPROVED' | 'DECLINED' | 'VOIDED' | 'ERROR';

const STATUS_MAP: Record<WompiStatus, ChargeStatus> = {
    PENDING: 'pending',
    APPROVED: 'approved',
    DECLINED: 'declined',
    VOIDED: 'voided',
    ERROR: 'error',
};

const SOURCE_TYPE_BY_KIND: Record<string, string> = {
    card: 'CARD',
    nequi: 'NEQUI',
    daviplata: 'DAVIPLATA',
    bancolombia_transfer: 'BANCOLOMBIA_TRANSFER',
};

/**
 * Wompi (Bancolombia) adapter — Colombia, COP only.
 *
 * Wompi has NO subscription objects: no plans, no billing calendar, no retries.
 * What it offers is a reusable payment source plus one-off transactions that the
 * merchant fires. The billing calendar therefore lives in our own recurring
 * engine, and this adapter implements IChargingProvider for it.
 *
 * Three properties of the API that shape everything here:
 *  1. **Nothing is synchronous.** POST /transactions always answers PENDING; the
 *     real outcome arrives by webhook (3 retries over 24h) or by polling. A
 *     resolved promise is not a successful payment.
 *  2. **There is no idempotency header.** Only our `reference` is unique. When a
 *     request times out we cannot retry blindly — getChargeByReference is the
 *     rescue path, and the engine treats an unknown outcome as terminal.
 *  3. **Every transaction is signed** with SHA256(reference + amount + currency
 *     [+ expiration] + integrity secret). The signature travels in the body.
 *
 * The IPaymentProvider methods that assume native subscriptions throw
 * NotImplementedException loudly rather than no-op: a silent success there would
 * mean an unbilled tenant.
 */
@Injectable()
export class WompiAdapter implements IPaymentProvider, IChargingProvider {
    readonly name: PaymentProviderName = 'wompi';
    readonly capabilities: ProviderCapabilities = WOMPI_CAPABILITIES;
    private readonly logger = new Logger(WompiAdapter.name);

    /** Wompi rejects anything below this (aggregator plan). */
    private static readonly MIN_AMOUNT_COP_CENTS = 150_000;

    /**
     * Minimum signed fields per event type. `signature.properties` remains
     * dynamic and is evaluated in the exact order Wompi sends; this allowlist
     * only prevents the sender from shrinking the signed byte range.  Token
     * events legitimately use token paths rather than transaction paths.
     */
    private static readonly REQUIRED_SIGNED_PROPERTIES: Record<string, readonly string[]> = {
        'transaction.updated': [
            'transaction.id',
            'transaction.status',
            'transaction.amount_in_cents',
        ],
        'nequi_token.updated': [
            'nequi_token.id',
            'nequi_token.status',
        ],
        'bancolombia_transfer_token.updated': [
            'bancolombia_transfer_token.id',
            'bancolombia_transfer_token.status',
        ],
    };

    private static readonly TOKEN_PATH_BY_KIND: Partial<Record<string, string>> = {
        nequi: 'nequi',
        bancolombia_transfer: 'bancolombia_transfer',
    };

    private static readonly DEFAULT_PAYMENT_DESCRIPTION = 'Suscripción Parallly';

    constructor(private readonly config: WompiConfigService) {}

    // -------------------------------------------------------------------------
    // HTTP
    // -------------------------------------------------------------------------

    private async request<T>(
        path: string,
        init: { method?: string; body?: unknown; auth: 'public' | 'private' | 'none'; timeoutMs?: number },
    ): Promise<T> {
        const url = `${this.config.baseUrl}${path}`;
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (init.auth === 'private') headers.Authorization = `Bearer ${this.config.privateKey}`;
        if (init.auth === 'public') {
            const key = this.config.publicKey;
            if (!key) throw new Error('Wompi public key is not configured');
            headers.Authorization = `Bearer ${key}`;
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), init.timeoutMs ?? 30_000);
        try {
            const res = await fetch(url, {
                method: init.method ?? 'GET',
                headers,
                body: init.body === undefined ? undefined : JSON.stringify(init.body),
                signal: controller.signal,
            });
            const text = await res.text();
            let json: any = {};
            if (text) {
                try {
                    json = JSON.parse(text);
                } catch {
                    throw new ServiceUnavailableException({
                        error: 'wompi_invalid_response',
                        providerStatus: res.status,
                        message: 'Wompi returned a non-JSON response.',
                    });
                }
            }
            if (!res.ok) {
                const message = json?.error?.reason
                    || json?.error?.messages
                    || json?.error?.type
                    || res.statusText;
                this.logger.error(`[Wompi] ${init.method ?? 'GET'} ${path} → ${res.status}: ${JSON.stringify(message)}`);
                const errorBody = {
                    error: 'wompi_request_failed',
                    providerStatus: res.status,
                    message: typeof message === 'string' ? message : JSON.stringify(message),
                };
                // A provider outage/rate limit is retryable. A provider 4xx is a
                // permanent request refusal and must not be retried blindly — in
                // particular POST /transactions has no idempotency header.
                if (
                    res.status >= 500
                    || res.status === 408
                    || res.status === 429
                    || res.status === 401
                    || res.status === 403
                ) {
                    throw new ServiceUnavailableException(errorBody);
                }
                throw new BadRequestException({ ...errorBody, status: res.status });
            }
            return json as T;
        } finally {
            clearTimeout(timeout);
        }
    }

    /**
     * A resource referenced by a verified Wompi event should exist. Any lookup
     * refusal here (including temporary 404 propagation or rotated credentials)
     * means ingestion is not durable yet, so expose it as retryable rather than
     * letting the webhook controller acknowledge and lose the event.
     */
    private async canonicalEventResource<T>(path: string): Promise<T> {
        try {
            return await this.request<T>(path, { auth: 'public' });
        } catch (err) {
            if (err instanceof BadRequestException) {
                throw new ServiceUnavailableException({
                    error: 'wompi_canonical_lookup_retryable',
                    path,
                });
            }
            throw err;
        }
    }

    // -------------------------------------------------------------------------
    // Acceptance contracts (habeas data — two separate tokens)
    // -------------------------------------------------------------------------

    async getAcceptanceContracts(): Promise<AcceptanceContracts> {
        const key = this.config.publicKey;
        if (!key) throw new Error('Wompi public key is not configured');
        const res = await this.request<any>(`/merchants/${key}`, { auth: 'none' });
        const data = res?.data ?? {};
        const endUser = data.presigned_acceptance;
        if (!endUser?.acceptance_token || !endUser?.permalink) {
            throw new BadRequestException({
                error: 'wompi_acceptance_unavailable',
                message: 'Wompi did not return the end-user policy acceptance token.',
            });
        }
        const personal = data.presigned_personal_data_auth;
        if (!personal?.acceptance_token || !personal?.permalink) {
            throw new BadRequestException({
                error: 'wompi_personal_data_acceptance_unavailable',
                message: 'Wompi did not return the mandatory personal-data authorization token.',
            });
        }
        return {
            endUserPolicy: {
                token: endUser.acceptance_token,
                permalink: endUser.permalink,
                type: endUser.type ?? 'END_USER_POLICY',
            },
            personalDataAuth: {
                token: personal.acceptance_token,
                permalink: personal.permalink,
                type: personal.type ?? 'PERSONAL_DATA_AUTH',
            },
        };
    }

    // -------------------------------------------------------------------------
    // Payment sources
    // -------------------------------------------------------------------------

    async startPaymentSource(input: StartPaymentSourceInput): Promise<ProviderPaymentSource> {
        const type = SOURCE_TYPE_BY_KIND[input.kind];
        if (!type) {
            throw new BadRequestException({
                error: 'unsupported_payment_source',
                message: `Wompi cannot store a reusable '${input.kind}' payment source.`,
            });
        }

        if (!input.acceptance?.endUserPolicy?.token || !input.acceptance?.personalDataAuth?.token) {
            throw new BadRequestException({
                error: 'acceptance_required',
                message: 'Both Wompi acceptance tokens are required to create a payment source.',
            });
        }

        // Nequi and Bancolombia tokens must finish their out-of-band approval
        // BEFORE POST /payment_sources. Persist the token as pending and let the
        // platform status endpoint complete the conversion once it is approved.
        if (WompiAdapter.TOKEN_PATH_BY_KIND[input.kind]) {
            const authorization = await this.getPaymentToken(input.kind, input.token);
            if (authorization.status !== 'available') return authorization;
        }

        return this.createPaymentSource(input, type);
    }

    private async createPaymentSource(
        input: StartPaymentSourceInput,
        type = SOURCE_TYPE_BY_KIND[input.kind],
    ): Promise<ProviderPaymentSource> {
        const body: Record<string, unknown> = {
            type,
            token: input.token,
            customer_email: input.customerEmail,
            acceptance_token: input.acceptance.endUserPolicy.token,
            accept_personal_auth: input.acceptance.personalDataAuth.token,
        };
        if (input.kind === 'bancolombia_transfer') {
            body.payment_description = (input.paymentDescription || WompiAdapter.DEFAULT_PAYMENT_DESCRIPTION)
                .trim()
                .slice(0, 64);
        }

        const res = await this.request<any>('/payment_sources', {
            method: 'POST',
            auth: 'private',
            body,
        });
        return this.mapPaymentSource(res?.data, input.kind);
    }

    async pollPaymentSourceAuth(
        providerSourceId: string,
        authTokenId?: string,
        context?: PaymentSourceAuthorizationContext,
    ): Promise<ProviderPaymentSource> {
        if (authTokenId) {
            if (!context?.kind || !context.customerEmail) {
                throw new BadRequestException({
                    error: 'payment_source_auth_context_missing',
                    message: 'Kind and customer email are required to finish an asynchronous payment source.',
                });
            }
            const authorization = await this.getPaymentToken(context.kind, authTokenId);
            if (authorization.status !== 'available') return authorization;
            const acceptance = context.acceptance ?? await this.getAcceptanceContracts();
            const input: StartPaymentSourceInput = {
                tenantId: '',
                kind: context.kind,
                token: authTokenId,
                customerEmail: context.customerEmail,
                paymentDescription: context.paymentDescription,
                acceptance,
            };
            return this.createPaymentSource(input);
        }

        const encoded = encodeURIComponent(providerSourceId);
        const res = await this.request<any>(`/payment_sources/${encoded}`, { auth: 'private' });
        return this.mapPaymentSource(res?.data);
    }

    async voidPaymentSource(providerSourceId: string): Promise<void> {
        // Wompi's documented revocation endpoint is PUT /payment_sources/:id/void
        // (not DELETE /payment_sources/:id).
        const encoded = encodeURIComponent(providerSourceId);
        await this.request(`/payment_sources/${encoded}/void`, { method: 'PUT', auth: 'private' });
    }

    private async getPaymentToken(kind: string, token: string): Promise<ProviderPaymentSource> {
        const tokenPath = WompiAdapter.TOKEN_PATH_BY_KIND[kind];
        if (!tokenPath) {
            throw new BadRequestException({
                error: 'unsupported_payment_token',
                message: `Wompi has no asynchronous token flow for '${kind}'.`,
            });
        }
        const encoded = encodeURIComponent(token);
        const res = await this.request<any>(`/tokens/${tokenPath}/${encoded}`, { auth: 'public' });
        const data = res?.data ?? {};
        const raw = String(data.status ?? '').toUpperCase();
        const status = raw === 'APPROVED' || raw === 'AVAILABLE'
            ? 'available'
            : raw === 'PENDING'
                ? 'pending_auth'
                : raw === 'DECLINED'
                    ? 'declined'
                    : raw === 'VOIDED'
                        ? 'voided'
                        : 'error';
        const tokenId = String(data.id ?? token);
        return {
            // A real numeric source id does not exist until the token is
            // approved. This names the pending row deterministically and is
            // replaced with the Wompi source id after authorization.
            providerSourceId: `pending:${kind}:${tokenId}`,
            kind: kind as ProviderPaymentSource['kind'],
            status,
            authTokenId: tokenId,
            authorizationUrl: data.authorization_url || undefined,
            phoneMasked: data.phone_number || undefined,
            last4: data.bank_account_last_four || undefined,
            rawStatus: raw || undefined,
        };
    }

    private mapPaymentSource(data: any, kindHint?: string): ProviderPaymentSource {
        const raw = String(data?.status ?? '').toUpperCase();
        const status = raw === 'AVAILABLE'
            ? 'available'
            : raw === 'PENDING'
                ? 'pending_auth'
                : raw === 'DECLINED'
                    ? 'declined'
                    : raw === 'VOIDED'
                        ? 'voided'
                        : 'error';
        const kind = (String(data?.type ?? '').toLowerCase() || kindHint || 'card') as ProviderPaymentSource['kind'];
        const id = data?.id;
        if (id === undefined || id === null || String(id) === '') {
            throw new ServiceUnavailableException({
                error: 'wompi_invalid_payment_source_response',
                message: 'Wompi returned a payment source without an id.',
            });
        }
        return {
            providerSourceId: String(id),
            kind,
            status,
            brand: data?.public_data?.brand ?? undefined,
            last4: data?.public_data?.last_four ?? data?.public_data?.bank_account_last_four ?? undefined,
            expMonth: data?.public_data?.exp_month ? Number(data.public_data.exp_month) : undefined,
            expYear: data?.public_data?.exp_year ? Number(data.public_data.exp_year) : undefined,
            phoneMasked: data?.public_data?.phone_number ?? undefined,
            rawStatus: raw || undefined,
        };
    }

    // -------------------------------------------------------------------------
    // Charges
    // -------------------------------------------------------------------------

    /**
     * SHA256(reference + amount_in_cents + currency [+ expiration_time] + integrity secret).
     * Exposed for the spec: getting the field ORDER wrong is silently rejected by
     * Wompi as an invalid signature, with no hint about which part is off.
     */
    buildIntegritySignature(
        reference: string,
        amountInCents: number,
        currency: string,
        expirationTime?: string,
    ): string {
        const parts = [reference, String(amountInCents), currency];
        if (expirationTime) parts.push(expirationTime);
        parts.push(this.config.integritySecret);
        return createHash('sha256').update(parts.join('')).digest('hex');
    }

    async charge(input: ChargeInput): Promise<ProviderCharge> {
        if (input.currency !== 'COP') {
            throw new BadRequestException({
                error: 'unsupported_currency',
                message: `Wompi only settles COP; got ${input.currency}.`,
            });
        }
        if (input.amountCents < WompiAdapter.MIN_AMOUNT_COP_CENTS) {
            throw new BadRequestException({
                error: 'amount_below_minimum',
                message: `Wompi rejects charges under ${WompiAdapter.MIN_AMOUNT_COP_CENTS} COP cents.`,
            });
        }
        if (!Number.isSafeInteger(input.amountCents)) {
            throw new BadRequestException({
                error: 'invalid_amount',
                message: 'Wompi amount_in_cents must be a safe integer.',
            });
        }
        if (!input.reference || input.reference.length > 255) {
            throw new BadRequestException({
                error: 'invalid_reference',
                message: 'Wompi references are required and may contain at most 255 characters.',
            });
        }
        if (!input.acceptance?.endUserPolicy?.token || !input.acceptance?.personalDataAuth?.token) {
            throw new BadRequestException({
                error: 'acceptance_required',
                message: 'Both Wompi acceptance tokens are required to create a transaction.',
            });
        }

        // Wompi payment source ids are integers; a non-numeric one would be
        // serialized as null and come back as an opaque validation error.
        const sourceId = Number(input.providerSourceId);
        if (!Number.isInteger(sourceId) || sourceId <= 0) {
            throw new BadRequestException({
                error: 'invalid_payment_source',
                message: `Wompi payment source id must be a positive integer; got '${input.providerSourceId}'.`,
            });
        }

        const signature = this.buildIntegritySignature(input.reference, input.amountCents, input.currency);
        const body: Record<string, unknown> = {
            amount_in_cents: input.amountCents,
            currency: input.currency,
            customer_email: input.customerEmail,
            reference: input.reference,
            payment_source_id: sourceId,
            signature,
            acceptance_token: input.acceptance.endUserPolicy.token,
            accept_personal_auth: input.acceptance.personalDataAuth.token,
        };
        // Card charges MUST carry the instalment count even when the amount comes
        // from a stored payment source: Wompi answers 422
        // "No se especificó el número de cuotas" otherwise. The docs describe
        // payment_method as optional when payment_source_id is present, which is
        // only true for the non-card methods — verified against the sandbox.
        const sourceKind = input.sourceKind ?? 'card';
        if (sourceKind === 'card') {
            body.payment_method = { installments: input.installments ?? 1 };
            // `recurrent` is Wompi's card-on-file/COF signal. The documented
            // Nequi/Bancolombia source flows do not send this card-only field.
            body.recurrent = input.recurrent;
        }

        if (input.customerData) {
            body.customer_data = {
                full_name: input.customerData.fullName,
                phone_number: input.customerData.phoneNumber,
                legal_id: input.customerData.legalId,
                legal_id_type: input.customerData.legalIdType,
            };
        }

        // No network-level retry here on purpose: without an idempotency header,
        // a retried POST can create a SECOND charge. A timeout is resolved by
        // getChargeByReference, never by firing again.
        const res = await this.request<any>('/transactions', { method: 'POST', auth: 'private', body });
        return this.mapCharge(res?.data);
    }

    async getCharge(providerChargeId: string): Promise<ProviderCharge> {
        const encoded = encodeURIComponent(providerChargeId);
        const res = await this.request<any>(`/transactions/${encoded}`, { auth: 'public' });
        return this.mapCharge(res?.data);
    }

    async getChargeByReference(reference: string): Promise<ProviderCharge | null> {
        const res = await this.request<any>(
            `/transactions?reference=${encodeURIComponent(reference)}`,
            { auth: 'private' },
        );
        if (!Array.isArray(res?.data)) {
            throw new ServiceUnavailableException({
                error: 'wompi_invalid_transaction_list',
                message: 'Wompi returned an invalid reference lookup response.',
            });
        }
        const list = res.data.filter((transaction: any) => String(transaction?.reference ?? '') === reference);
        if (res.data.length && !list.length) {
            throw new ServiceUnavailableException({
                error: 'wompi_reference_lookup_mismatch',
                message: 'Wompi returned transactions for a different reference.',
            });
        }
        if (!list.length) return null;
        if (list.length > 1) {
            this.logger.warn(
                `[Wompi] Reference '${reference}' resolved to ${list.length} transactions; selecting by settlement priority`,
            );
        }
        // Never let an old DECLINED entry close reconciliation while a newer
        // request is still PENDING. Money moved wins, then in-flight, then the
        // newest terminal result.
        const priority = (transaction: any) => {
            const status = String(transaction?.status ?? '').toUpperCase();
            if (status === 'APPROVED') return 3;
            if (status === 'PENDING') return 2;
            return 1;
        };
        const timestamp = (transaction: any) => {
            const value = transaction?.finalized_at ?? transaction?.updated_at ?? transaction?.created_at;
            const parsed = value ? new Date(value).getTime() : 0;
            return Number.isFinite(parsed) ? parsed : 0;
        };
        const selected = [...list].sort((left, right) =>
            priority(right) - priority(left) || timestamp(right) - timestamp(left),
        )[0];
        return this.mapCharge(selected);
    }

    async voidCharge(providerChargeId: string, amountCents?: number): Promise<void> {
        if (amountCents !== undefined) {
            throw new BadRequestException({
                error: 'partial_void_not_supported',
                message: 'Wompi only documents full pre-settlement card voids; partial voids are not supported.',
            });
        }
        const encoded = encodeURIComponent(providerChargeId);
        try {
            await this.request(`/transactions/${encoded}/void`, {
                method: 'POST',
                auth: 'private',
            });
        } catch (error) {
            // A provider 4xx is a definitive refusal. A timeout/5xx after POST is
            // not: Wompi may have accepted the void before the connection died.
            // Keep the local refund reservation so reconciliation can discover
            // the canonical result instead of authorising a second void.
            if (error instanceof BadRequestException) throw error;
            throw new ServiceUnavailableException({
                error: 'wompi_void_pending_confirmation',
                preserveRefundPending: true,
                providerChargeId,
                message: 'Wompi did not confirm the void response; canonical reconciliation will continue.',
            });
        }

        // A 2xx only acknowledges the command; it is not proof that the
        // transaction is VOIDED. Poll the canonical resource a few times without
        // pretending an APPROVED/PENDING result is a completed refund. The
        // durable sweep owns longer-lived eventual consistency.
        let lastStatus: ChargeStatus | 'lookup_error' = 'lookup_error';
        for (let poll = 0; poll < 3; poll++) {
            try {
                const canonical = await this.getCharge(providerChargeId);
                lastStatus = canonical.status;
                if (canonical.status === 'voided') return;
            } catch {
                lastStatus = 'lookup_error';
            }
        }
        throw new ServiceUnavailableException({
            error: 'wompi_void_pending_confirmation',
            preserveRefundPending: true,
            providerChargeId,
            providerStatus: lastStatus,
            message: 'Wompi accepted the void command but has not reported VOIDED yet; reconciliation will continue.',
        });
    }

    async createCheckoutLink(input: CheckoutLinkInput): Promise<ProviderCheckoutLink> {
        if (input.currency !== 'COP') {
            throw new BadRequestException({ error: 'unsupported_currency', message: 'Wompi payment links settle COP.' });
        }
        if (!Number.isSafeInteger(input.amountCents) || input.amountCents < WompiAdapter.MIN_AMOUNT_COP_CENTS) {
            throw new BadRequestException({
                error: 'invalid_payment_link_amount',
                message: `Wompi payment links require at least ${WompiAdapter.MIN_AMOUNT_COP_CENTS} COP cents.`,
            });
        }
        if (!input.reference) {
            throw new BadRequestException({ error: 'invalid_payment_link_reference' });
        }
        const res = await this.request<any>('/payment_links', {
            method: 'POST',
            auth: 'private',
            body: {
                name: input.description,
                description: input.description,
                single_use: true,
                collect_shipping: false,
                currency: input.currency,
                amount_in_cents: input.amountCents,
                redirect_url: input.redirectUrl,
                expires_at: input.expiresAt?.toISOString(),
                // Payment links do not accept a transaction `reference`; Wompi
                // generates it when the payer checks out. `sku` is the only
                // documented merchant correlation field (max 36 chars), while
                // payment_link_id remains the canonical reconciliation key.
                sku: input.reference.slice(0, 36),
            },
        });
        const id = res?.data?.id;
        if (id === undefined || id === null || String(id) === '') {
            throw new ServiceUnavailableException({
                error: 'wompi_invalid_payment_link_response',
                message: 'Wompi returned a payment link without an id.',
            });
        }
        return {
            url: `https://checkout.wompi.co/l/${id}`,
            providerLinkId: String(id),
            expiresAt: input.expiresAt,
        };
    }

    private mapCharge(data: any): ProviderCharge {
        const raw = String(data?.status ?? '').toUpperCase() as WompiStatus;
        const id = data?.id;
        const reference = data?.reference;
        const amount = Number(data?.amount_in_cents);
        if (
            id === undefined || id === null || String(id) === ''
            || reference === undefined || String(reference) === ''
            || !Number.isSafeInteger(amount) || amount <= 0
        ) {
            throw new ServiceUnavailableException({
                error: 'wompi_invalid_transaction_response',
                message: 'Wompi returned an incomplete transaction resource.',
            });
        }
        const currency = String(data?.currency ?? '');
        if (currency !== 'COP') {
            throw new ServiceUnavailableException({
                error: 'wompi_transaction_currency_mismatch',
                message: `Wompi returned unexpected currency '${currency || '(absent)'}'.`,
            });
        }
        return {
            providerChargeId: String(id),
            status: STATUS_MAP[raw] ?? 'error',
            reference: String(reference),
            amountCents: amount,
            currency,
            rawStatus: raw || undefined,
            statusMessage: data?.status_message ?? undefined,
            settledAt: data?.finalized_at ? new Date(data.finalized_at) : undefined,
        };
    }

    // -------------------------------------------------------------------------
    // Webhooks
    // -------------------------------------------------------------------------

    /**
     * Wompi does not sign with HMAC. The checksum is
     * SHA256(<values of signature.properties, IN ORDER> + timestamp + events secret).
     *
     * `signature.properties` is DYNAMIC: it is a list of dotted paths into the
     * payload. Hardcoding today's three fields would break verification the day
     * Wompi adds a fourth, so the paths are resolved by reflection.
     *
     * Canonical source for the payload shape is the SPANISH documentation — the
     * English page omits `environment` and the top-level `timestamp`, and a
     * checksum built without the timestamp never matches.
     */
    verifyWebhookSignature(
        rawBody: string,
        headers: Record<string, string>,
        _context?: WebhookSignatureContext,
    ): boolean {
        const secret = this.config.eventsSecret;
        if (!secret) {
            this.logger.error('[Wompi] WOMPI_EVENTS_SECRET is not set — rejecting webhook');
            return false;
        }

        let payload: any;
        try {
            payload = JSON.parse(rawBody);
        } catch {
            return false;
        }

        const properties: unknown = payload?.signature?.properties;
        const timestamp = payload?.timestamp;
        if (!Array.isArray(properties) || !properties.length || timestamp === undefined || timestamp === null) {
            return false;
        }

        /**
         * The signed field list travels INSIDE the payload, so an attacker who
         * has seen one legitimate event could otherwise shrink it and re-window
         * the same checksum: `properties: ["transaction.id"]` with the id set to
         * the old concatenation ("<id><status><amount>") hashes identically,
         * leaving every other field — status, email, amount — free to forge.
         *
         * Requiring the fields Wompi actually signs closes that: the attacker
         * can no longer choose which bytes the digest covers. Extra properties
         * are still accepted so the day Wompi signs more fields nothing breaks.
         */
        const eventName = String(payload?.event ?? '');
        const requiredProperties = WompiAdapter.REQUIRED_SIGNED_PROPERTIES[eventName];
        if (!requiredProperties) {
            // The parser has no safe semantic mapping for unknown event types.
            // Returning false prevents an unsigned/new shape from reaching a
            // business handler; support it deliberately when Wompi adds it.
            this.logger.error(`[Wompi] unsupported event type '${eventName || '(absent)'}' — rejected`);
            return false;
        }

        const propertyPaths = properties.map((p) => String(p));
        if (new Set(propertyPaths).size !== propertyPaths.length) return false;
        const missingRequired = requiredProperties
            .filter((required) => !propertyPaths.includes(required));
        if (missingRequired.length) {
            this.logger.error(
                `[Wompi] event signature does not cover ${missingRequired.join(', ')} — rejected`,
            );
            return false;
        }

        // Reject an event from the other environment before it can mutate state:
        // a sandbox APPROVED must never activate a production subscription.
        // A MISSING environment is rejected too — treating it as "not stated,
        // therefore fine" would make the guard opt-out for the sender.
        const expected = this.config.environment();
        if (expected === 'unconfigured') {
            this.logger.error('[Wompi] cannot verify the event environment — keys are not configured');
            return false;
        }
        const environment = String(payload?.environment ?? '').toLowerCase();
        const matches = (expected === 'production' && environment === 'prod')
            || (expected === 'sandbox' && environment === 'test');
        if (!matches) {
            this.logger.error(`[Wompi] event environment '${environment || '(absent)'}' does not match '${expected}' — rejected`);
            return false;
        }

        const values: string[] = [];
        for (const path of propertyPaths) {
            // Only plain dotted object paths are accepted. Prototype keys and
            // missing values must not collapse to an empty string inside a
            // separator-less signature construction.
            if (!/^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/.test(path)) return false;
            if (path.split('.').some((part) => ['__proto__', 'prototype', 'constructor'].includes(part))) return false;
            const value = this.readPath(payload, path);
            if (value === undefined || value === null) return false;
            values.push(String(value));
        }

        const concatenated = values.join('') + String(timestamp) + secret;
        const computed = createHash('sha256').update(concatenated).digest('hex');

        const bodyChecksum = String(payload?.signature?.checksum ?? '').toLowerCase();
        const headerChecksum = String(headers['x-event-checksum'] ?? headers['X-Event-Checksum'] ?? '').toLowerCase();
        if (bodyChecksum && headerChecksum && bodyChecksum !== headerChecksum) return false;
        const provided = bodyChecksum || headerChecksum;
        if (!/^[a-f0-9]{64}$/.test(provided)) return false;
        if (provided.length !== computed.length) return false;

        try {
            return timingSafeEqual(Buffer.from(computed, 'utf8'), Buffer.from(provided, 'utf8'));
        } catch {
            return false;
        }
    }

    /** Resolve a dotted path like `transaction.amount_in_cents` against the event payload. */
    private readPath(payload: any, path: string): unknown {
        return path.split('.').reduce((acc: any, key: string) => (acc == null ? acc : acc[key]), payload?.data);
    }

    async parseWebhookEvent(rawBody: string, _headers: Record<string, string>): Promise<NormalizedBillingEvent> {
        const payload = JSON.parse(rawBody);
        const eventName = String(payload?.event ?? '');
        const sentAt = payload?.sent_at ? new Date(payload.sent_at) : null;
        const occurredAt = sentAt && !Number.isNaN(sentAt.getTime())
            ? sentAt
            : new Date(Number(payload?.timestamp) * 1000);

        if (eventName === 'transaction.updated' && payload?.data?.transaction) {
            const signedTransaction = payload.data.transaction;
            const signedId = String(signedTransaction.id ?? '');
            if (!signedId) {
                throw new BadRequestException({ error: 'wompi_event_without_transaction_id' });
            }

            // Wompi signs id/status/amount, but NOT reference, currency or payer
            // email. Those unsigned fields decide which tenant/attempt receives
            // the money, so never trust them directly from the webhook. Fetch the
            // canonical resource by the signed id before normalizing.
            const resource = await this.canonicalEventResource<any>(
                `/transactions/${encodeURIComponent(signedId)}`,
            );
            const transaction = resource?.data;
            if (!transaction || String(transaction.id ?? '') !== signedId) {
                throw new ServiceUnavailableException({
                    error: 'wompi_transaction_lookup_mismatch',
                    message: 'The canonical Wompi transaction did not match the signed event id.',
                });
            }
            if (Number(transaction.amount_in_cents) !== Number(signedTransaction.amount_in_cents)) {
                throw new ServiceUnavailableException({
                    error: 'wompi_transaction_lookup_amount_mismatch',
                    message: 'The canonical Wompi transaction amount did not match the signed event.',
                });
            }
            const status = String(transaction.status ?? '').toUpperCase() as WompiStatus;
            if (!Object.prototype.hasOwnProperty.call(STATUS_MAP, status)) {
                throw new BadRequestException({
                    error: 'unsupported_wompi_transaction_status',
                    status,
                });
            }
            if (status === 'PENDING') {
                throw new BadRequestException({
                    error: 'wompi_transaction_not_final',
                    message: 'Pending Wompi updates are informational and do not mutate billing state.',
                });
            }
            const type = status === 'APPROVED'
                ? BillingEventType.PAYMENT_SUCCEEDED
                : status === 'VOIDED'
                    ? BillingEventType.PAYMENT_REFUNDED
                    : BillingEventType.PAYMENT_FAILED;

            const payment: ProviderPayment = {
                providerPaymentId: String(transaction.id ?? ''),
                amountCents: Number(transaction.amount_in_cents ?? 0),
                currency: String(transaction.currency ?? 'COP'),
                status: status === 'APPROVED'
                    ? 'succeeded'
                    : status === 'VOIDED'
                        ? 'refunded'
                        : 'failed',
                paidAt: transaction.finalized_at ? new Date(transaction.finalized_at) : undefined,
                failureReason: transaction.status_message ?? undefined,
                rawStatus: status,
            };

            return {
                type,
                provider: this.name,
                // Wompi sends no event id. A deterministic one keeps a redelivery
                // idempotent while still letting PENDING → APPROVED through.
                providerEventId: `${eventName}.${transaction.id}.${status}`,
                occurredAt,
                providerPaymentId: payment.providerPaymentId,
                payerEmail: transaction.customer_email ?? undefined,
                payment,
                // Preserve the signed envelope while replacing business fields
                // with the canonical resource. Downstream matching by reference
                // must never see the unsigned webhook copy.
                rawPayload: {
                    ...payload,
                    data: { ...payload.data, transaction },
                    wompiWebhookData: payload.data,
                },
            };
        }

        // Wallet authorization events (exact names documented by Wompi).
        const tokenKind = eventName === 'nequi_token.updated'
            ? 'nequi'
            : eventName === 'bancolombia_transfer_token.updated'
                ? 'bancolombia_transfer'
                : null;
        const tokenKey = tokenKind === 'nequi' ? 'nequi_token' : 'bancolombia_transfer_token';
        const signedToken = tokenKind ? payload?.data?.[tokenKey] : null;
        if (tokenKind && signedToken) {
            const tokenId = signedToken.id ?? signedToken.token;
            if (!tokenId) {
                throw new BadRequestException({
                    error: 'wompi_event_without_token_id',
                    message: `Wompi ${eventName} event carries no token id — cannot be deduplicated safely.`,
                });
            }
            const tokenResponse = await this.canonicalEventResource<any>(
                `/tokens/${WompiAdapter.TOKEN_PATH_BY_KIND[tokenKind]}/${encodeURIComponent(String(tokenId))}`,
            );
            const token = tokenResponse?.data;
            if (!token || String(token.id ?? token.token ?? '') !== String(tokenId)) {
                throw new ServiceUnavailableException({
                    error: 'wompi_token_lookup_mismatch',
                    message: 'The canonical Wompi token did not match the signed event id.',
                });
            }
            const status = String(token.status ?? '').toUpperCase();
            if (!['APPROVED', 'AVAILABLE', 'DECLINED'].includes(status)) {
                throw new BadRequestException({
                    error: 'unsupported_wompi_token_status',
                    status,
                });
            }
            return {
                type: status === 'APPROVED' || status === 'AVAILABLE'
                    ? BillingEventType.PAYMENT_METHOD_AUTHORIZED
                    : BillingEventType.PAYMENT_METHOD_DECLINED,
                provider: this.name,
                providerEventId: `${eventName}.${tokenId}.${status}`,
                occurredAt,
                payerEmail: token.customer_email ?? undefined,
                rawPayload: {
                    ...payload,
                    data: { ...payload.data, [tokenKey]: token },
                    wompiWebhookData: payload.data,
                },
            };
        }

        throw new BadRequestException({
            error: 'unsupported_wompi_event',
            event: eventName || null,
        });
    }

    // -------------------------------------------------------------------------
    // IPaymentProvider surface Wompi cannot serve
    // -------------------------------------------------------------------------

    /** Wompi has no customer object; the payer is identified per transaction by email. */
    async createCustomer(input: CreateCustomerInput): Promise<ProviderCustomer> {
        return {
            providerCustomerId: `wompi_${input.tenantId}`,
            email: input.email,
            name: input.name,
            country: input.country,
            createdAt: new Date(),
        };
    }

    private unsupported(method: string): never {
        throw new NotImplementedException({
            error: 'provider_capability_unsupported',
            message: `Wompi has no native subscriptions — ${method} is handled by the internal billing engine.`,
            providerName: this.name,
        });
    }

    async updatePaymentMethod(): Promise<void> {
        // Rotating a stored instrument means creating a new payment source and
        // marking it default; the engine owns that, not the adapter.
        this.unsupported('updatePaymentMethod');
    }

    async createPlan(_input: CreatePlanInput): Promise<ProviderPlan> {
        this.unsupported('createPlan');
    }

    async createSubscription(_input: CreateSubscriptionInput): Promise<ProviderSubscription> {
        this.unsupported('createSubscription');
    }

    async cancelSubscription(_id: string, _opts?: CancelSubscriptionOptions): Promise<void> {
        this.unsupported('cancelSubscription');
    }

    async pauseSubscription(): Promise<void> {
        this.unsupported('pauseSubscription');
    }

    async resumeSubscription(): Promise<void> {
        this.unsupported('resumeSubscription');
    }

    async changeSubscriptionPlan(): Promise<ProviderSubscription> {
        this.unsupported('changeSubscriptionPlan');
    }

    /**
     * Wompi exposes no refund endpoint — only pre-settlement card voids. The
     * capability declares 'void_only' so the UI degrades to a manually tracked
     * refund instead of reporting a success that never happened.
     */
    async refundPayment(providerPaymentId: string, amountCents?: number): Promise<void> {
        const charge = await this.getCharge(providerPaymentId);
        // Idempotent recovery when the POST response was lost but the canonical
        // transaction already reached VOIDED.
        if (charge.status === 'voided') return;
        if (charge.status === 'approved') {
            await this.voidCharge(providerPaymentId, amountCents);
            return;
        }
        throw new BadRequestException({
            error: 'refund_not_supported',
            message: 'Wompi has no refund API. Only approved card charges can be voided before settlement; anything else must be refunded manually through Wompi support.',
            providerName: this.name,
        });
    }

    async getSubscription(): Promise<ProviderSubscription> {
        this.unsupported('getSubscription');
    }

    async listCustomerSubscriptions(): Promise<ProviderSubscription[]> {
        this.unsupported('listCustomerSubscriptions');
    }
}
