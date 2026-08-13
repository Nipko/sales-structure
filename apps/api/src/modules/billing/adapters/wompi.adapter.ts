import { BadRequestException, Injectable, Logger, NotImplementedException } from '@nestjs/common';
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
     * Fields the event checksum MUST cover. Wompi signs exactly these today; the
     * verifier refuses anything narrower so the signed byte range cannot be
     * chosen by whoever sends the request.
     */
    private static readonly REQUIRED_SIGNED_PROPERTIES = [
        'transaction.id',
        'transaction.status',
        'transaction.amount_in_cents',
    ] as const;

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
            const json = text ? JSON.parse(text) : {};
            if (!res.ok) {
                const message = json?.error?.reason
                    || json?.error?.messages
                    || json?.error?.type
                    || res.statusText;
                this.logger.error(`[Wompi] ${init.method ?? 'GET'} ${path} → ${res.status}: ${JSON.stringify(message)}`);
                throw new BadRequestException({
                    error: 'wompi_request_failed',
                    status: res.status,
                    message: typeof message === 'string' ? message : JSON.stringify(message),
                });
            }
            return json as T;
        } finally {
            clearTimeout(timeout);
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
        if (!endUser?.acceptance_token) {
            throw new BadRequestException({
                error: 'wompi_acceptance_unavailable',
                message: 'Wompi did not return the end-user policy acceptance token.',
            });
        }
        const personal = data.presigned_personal_data_auth;
        return {
            endUserPolicy: {
                token: endUser.acceptance_token,
                permalink: endUser.permalink,
                type: endUser.type ?? 'END_USER_POLICY',
            },
            personalDataAuth: personal?.acceptance_token
                ? {
                      token: personal.acceptance_token,
                      permalink: personal.permalink,
                      type: personal.type ?? 'PERSONAL_DATA_AUTH',
                  }
                : undefined,
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

        const res = await this.request<any>('/payment_sources', {
            method: 'POST',
            auth: 'private',
            body: {
                type,
                token: input.token,
                customer_email: input.customerEmail,
                acceptance_token: input.acceptance.endUserPolicy.token,
                accept_personal_auth: input.acceptance.personalDataAuth?.token,
            },
        });
        return this.mapPaymentSource(res?.data, input.kind);
    }

    async pollPaymentSourceAuth(providerSourceId: string, _authTokenId?: string): Promise<ProviderPaymentSource> {
        const res = await this.request<any>(`/payment_sources/${providerSourceId}`, { auth: 'private' });
        return this.mapPaymentSource(res?.data);
    }

    async voidPaymentSource(providerSourceId: string): Promise<void> {
        await this.request(`/payment_sources/${providerSourceId}`, { method: 'DELETE', auth: 'private' });
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
        return {
            providerSourceId: String(data?.id ?? ''),
            kind,
            status,
            brand: data?.public_data?.brand ?? undefined,
            last4: data?.public_data?.last_four ?? undefined,
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
            recurrent: input.recurrent,
        };
        // The docs disagree on whether this is required when charging a stored
        // source; the engine fetches fresh tokens anyway, so we send them.
        if (input.acceptance?.endUserPolicy?.token) {
            body.acceptance_token = input.acceptance.endUserPolicy.token;
        }
        if (input.acceptance?.personalDataAuth?.token) {
            body.accept_personal_auth = input.acceptance.personalDataAuth.token;
        }
        // Card charges MUST carry the instalment count even when the amount comes
        // from a stored payment source: Wompi answers 422
        // "No se especificó el número de cuotas" otherwise. The docs describe
        // payment_method as optional when payment_source_id is present, which is
        // only true for the non-card methods — verified against the sandbox.
        const sourceKind = input.sourceKind ?? 'card';
        if (sourceKind === 'card') {
            body.payment_method = { installments: input.installments ?? 1 };
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
        const res = await this.request<any>(`/transactions/${providerChargeId}`, { auth: 'public' });
        return this.mapCharge(res?.data);
    }

    async getChargeByReference(reference: string): Promise<ProviderCharge | null> {
        const res = await this.request<any>(
            `/transactions?reference=${encodeURIComponent(reference)}`,
            { auth: 'private' },
        );
        const list = Array.isArray(res?.data) ? res.data : [];
        if (!list.length) return null;
        // A retried reference can produce more than one transaction; an approved
        // one is the answer that matters — it means the money already moved.
        const approved = list.find((t: any) => String(t?.status).toUpperCase() === 'APPROVED');
        return this.mapCharge(approved ?? list[0]);
    }

    async voidCharge(providerChargeId: string, amountCents?: number): Promise<void> {
        await this.request(`/transactions/${providerChargeId}/void`, {
            method: 'POST',
            auth: 'private',
            body: amountCents ? { amount_in_cents: amountCents } : {},
        });
    }

    async createCheckoutLink(input: CheckoutLinkInput): Promise<ProviderCheckoutLink> {
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
                // Our reference is the idempotency anchor: without echoing it,
                // a payment made through the link cannot be tied back to the
                // charge attempt that created it.
                reference: input.reference,
                customer_email: input.customerEmail,
            },
        });
        const id = res?.data?.id;
        return {
            url: `https://checkout.wompi.co/l/${id}`,
            providerLinkId: id ? String(id) : undefined,
            expiresAt: input.expiresAt,
        };
    }

    private mapCharge(data: any): ProviderCharge {
        const raw = String(data?.status ?? '').toUpperCase() as WompiStatus;
        return {
            providerChargeId: String(data?.id ?? ''),
            status: STATUS_MAP[raw] ?? 'error',
            reference: String(data?.reference ?? ''),
            amountCents: Number(data?.amount_in_cents ?? 0),
            currency: String(data?.currency ?? 'COP'),
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
        const propertyPaths = properties.map((p) => String(p));
        const missingRequired = WompiAdapter.REQUIRED_SIGNED_PROPERTIES
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

        const concatenated = properties
            .map((path) => this.readPath(payload, String(path)))
            .join('') + String(timestamp) + secret;
        const computed = createHash('sha256').update(concatenated).digest('hex');

        const provided = String(
            payload?.signature?.checksum
            ?? headers['x-event-checksum']
            ?? headers['X-Event-Checksum']
            ?? '',
        ).toLowerCase();
        if (provided.length !== computed.length) return false;

        try {
            return timingSafeEqual(Buffer.from(computed, 'utf8'), Buffer.from(provided, 'utf8'));
        } catch {
            return false;
        }
    }

    /** Resolve a dotted path like `transaction.amount_in_cents` against the event payload. */
    private readPath(payload: any, path: string): string {
        const value = path.split('.').reduce((acc: any, key: string) => (acc == null ? acc : acc[key]), payload?.data);
        return value === undefined || value === null ? '' : String(value);
    }

    async parseWebhookEvent(rawBody: string, _headers: Record<string, string>): Promise<NormalizedBillingEvent> {
        const payload = JSON.parse(rawBody);
        const eventName = String(payload?.event ?? '');
        const transaction = payload?.data?.transaction;
        const occurredAt = payload?.sent_at ? new Date(payload.sent_at) : new Date();

        if (eventName === 'transaction.updated' && transaction) {
            const status = String(transaction.status ?? '').toUpperCase() as WompiStatus;
            const type = status === 'APPROVED'
                ? BillingEventType.PAYMENT_SUCCEEDED
                : status === 'VOIDED'
                    ? BillingEventType.PAYMENT_REFUNDED
                    : status === 'DECLINED' || status === 'ERROR'
                        ? BillingEventType.PAYMENT_FAILED
                        : BillingEventType.SUBSCRIPTION_CREATED; // PENDING — informational only

            const payment: ProviderPayment = {
                providerPaymentId: String(transaction.id ?? ''),
                amountCents: Number(transaction.amount_in_cents ?? 0),
                currency: String(transaction.currency ?? 'COP'),
                status: status === 'APPROVED'
                    ? 'succeeded'
                    : status === 'VOIDED'
                        ? 'refunded'
                        : status === 'PENDING'
                            ? 'pending'
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
                rawPayload: payload,
            };
        }

        // Wallet authorization events (Nequi / Bancolombia transfer tokens).
        const token = payload?.data?.nequi_token ?? payload?.data?.bancolombia_transfer_token;
        if (token) {
            const status = String(token.status ?? '').toUpperCase();
            // A token with no identifier cannot produce a stable event id. Using
            // a shared constant would make the FIRST such event win and every
            // later one — from any tenant — be discarded as a duplicate, leaving
            // payment methods unactivated with no error anywhere.
            const tokenId = token.id ?? token.token;
            if (!tokenId) {
                throw new BadRequestException({
                    error: 'wompi_event_without_token_id',
                    message: `Wompi ${eventName} event carries no token id — cannot be deduplicated safely.`,
                });
            }
            return {
                type: status === 'APPROVED'
                    ? BillingEventType.PAYMENT_METHOD_AUTHORIZED
                    : BillingEventType.PAYMENT_METHOD_DECLINED,
                provider: this.name,
                providerEventId: `${eventName}.${tokenId}.${status}`,
                occurredAt,
                payerEmail: token.customer_email ?? undefined,
                rawPayload: payload,
            };
        }

        return {
            type: BillingEventType.SUBSCRIPTION_CREATED,
            provider: this.name,
            providerEventId: `${eventName}.${occurredAt.getTime()}`,
            occurredAt,
            rawPayload: payload,
        };
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
