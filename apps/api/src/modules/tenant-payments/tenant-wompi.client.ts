import { Injectable, Logger } from '@nestjs/common';
import type { CanonicalWompiTransaction } from './tenant-payment-store.service';

export type WompiEnvironment = 'sandbox' | 'production';

export interface WompiMerchantIdentity {
    id?: string;
    name?: string;
    legalName?: string;
}

export interface CanonicalWompiPaymentLink {
    id: string;
    url: string;
    amountCents: number;
    currency: 'COP';
    sku: string;
    expiresAt: Date;
    merchantPublicKey: string;
    active: boolean;
}

export class WompiProviderError extends Error {
    constructor(
        public readonly code: string,
        public readonly ambiguous: boolean,
        public readonly providerLinkId?: string,
    ) {
        super(code);
    }
}

const WOMPI_BASE_URLS: Record<WompiEnvironment, string> = {
    sandbox: 'https://sandbox.wompi.co/v1',
    production: 'https://production.wompi.co/v1',
};

@Injectable()
export class TenantWompiClient {
    private readonly logger = new Logger(TenantWompiClient.name);

    environmentForKeys(input: {
        publicKey: string;
        privateKey: string;
        eventsSecret: string;
        environment?: string;
    }): WompiEnvironment | null {
        const publicEnv = this.keyEnvironment(input.publicKey, 'public');
        const privateEnv = this.keyEnvironment(input.privateKey, 'private');
        const eventsEnv = this.keyEnvironment(input.eventsSecret, 'events');
        if (!publicEnv || publicEnv !== privateEnv || publicEnv !== eventsEnv) return null;
        if (input.environment && input.environment !== publicEnv) return null;
        return publicEnv;
    }

    async verifyMerchant(publicKey: string, environment: WompiEnvironment): Promise<WompiMerchantIdentity | null> {
        if (this.keyEnvironment(publicKey, 'public') !== environment) return null;
        try {
            const response = await fetch(
                `${WOMPI_BASE_URLS[environment]}/merchants/${encodeURIComponent(publicKey)}`,
                { signal: AbortSignal.timeout(15_000) },
            );
            if (!response.ok) return null;
            const payload: any = await response.json();
            const merchant = payload?.data;
            if (!merchant || typeof merchant !== 'object') return null;
            return {
                id: this.optionalString(merchant.id),
                name: this.optionalString(merchant.name),
                legalName: this.optionalString(merchant.legal_name),
            };
        } catch {
            return null;
        }
    }

    /**
     * Creating a link is the first authenticated, non-destructive capability
     * Wompi documents for a private key. We validate its prefix on config save;
     * the POST plus merchant_public_key comparison below proves that the private
     * key belongs to the configured public merchant before a URL is shared.
     */
    async createAndVerifyPaymentLink(input: {
        publicKey: string;
        privateKey: string;
        environment: WompiEnvironment;
        intentId: string;
        amountCents: number;
        description: string;
        expiresAt: Date;
    }): Promise<CanonicalWompiPaymentLink> {
        if (this.keyEnvironment(input.publicKey, 'public') !== input.environment
            || this.keyEnvironment(input.privateKey, 'private') !== input.environment) {
            throw new WompiProviderError('wompi_environment_mismatch', false);
        }
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.intentId)) {
            throw new WompiProviderError('invalid_wompi_sku', false);
        }
        const body = {
            name: input.description.slice(0, 120),
            description: input.description.slice(0, 250),
            single_use: true,
            collect_shipping: false,
            currency: 'COP',
            amount_in_cents: input.amountCents,
            sku: input.intentId,
            expires_at: input.expiresAt.toISOString(),
        };

        let response: Response;
        try {
            response = await fetch(`${WOMPI_BASE_URLS[input.environment]}/payment_links`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${input.privateKey}`,
                },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(15_000),
            });
        } catch (error: any) {
            this.logger.warn(`Wompi payment link POST outcome unknown: ${error.message}`);
            throw new WompiProviderError('wompi_link_creation_outcome_unknown', true);
        }
        if (!response.ok) {
            // Provider error bodies can echo request data. Amount/description
            // are not needed to diagnose the stable local error code, so keep
            // credentials and payer/business data out of application logs.
            this.logger.warn(`Wompi payment link POST failed with HTTP ${response.status}`);
            throw new WompiProviderError(
                response.status >= 500 ? 'wompi_link_creation_outcome_unknown' : 'wompi_link_creation_rejected',
                response.status >= 500,
            );
        }
        const payload: any = await response.json().catch(() => null);
        const providerLinkId = this.optionalString(payload?.data?.id);
        if (!providerLinkId) {
            throw new WompiProviderError('invalid_wompi_link_response', true);
        }

        try {
            return await this.getAndValidatePaymentLink({
                providerLinkId,
                environment: input.environment,
                expectedPublicKey: input.publicKey,
                expectedIntentId: input.intentId,
                expectedAmountCents: input.amountCents,
                expectedExpiresAt: input.expiresAt,
            });
        } catch (error: any) {
            if (error instanceof WompiProviderError) {
                throw new WompiProviderError(error.code, true, providerLinkId);
            }
            throw new WompiProviderError('wompi_link_canonical_read_failed', true, providerLinkId);
        }
    }

    async getAndValidatePaymentLink(input: {
        providerLinkId: string;
        environment: WompiEnvironment;
        expectedPublicKey: string;
        expectedIntentId: string;
        expectedAmountCents: number;
        expectedExpiresAt?: Date;
        allowInactive?: boolean;
    }): Promise<CanonicalWompiPaymentLink> {
        let response: Response;
        try {
            response = await fetch(
                `${WOMPI_BASE_URLS[input.environment]}/payment_links/${encodeURIComponent(input.providerLinkId)}`,
                { signal: AbortSignal.timeout(15_000) },
            );
        } catch {
            throw new WompiProviderError('wompi_link_canonical_read_failed', true, input.providerLinkId);
        }
        if (!response.ok) {
            throw new WompiProviderError('wompi_link_canonical_read_failed', true, input.providerLinkId);
        }
        const payload: any = await response.json().catch(() => null);
        const link = payload?.data;
        const id = this.optionalString(link?.id);
        const merchantPublicKey = this.optionalString(link?.merchant_public_key);
        const sku = this.optionalString(link?.sku);
        const currency = this.optionalString(link?.currency)?.toUpperCase();
        const amountCents = Number(link?.amount_in_cents);
        const expiresAt = new Date(String(link?.expires_at || ''));
        const expiryDifference = input.expectedExpiresAt
            ? Math.abs(expiresAt.getTime() - input.expectedExpiresAt.getTime())
            : 0;
        if (id !== input.providerLinkId
            || merchantPublicKey !== input.expectedPublicKey
            || sku !== input.expectedIntentId
            || currency !== 'COP'
            || !Number.isSafeInteger(amountCents)
            || amountCents !== input.expectedAmountCents
            || link?.single_use !== true
            || link?.collect_shipping !== false
            || typeof link?.active !== 'boolean'
            || (!input.allowInactive && link.active !== true)
            || Number.isNaN(expiresAt.getTime())
            || expiryDifference > 60_000) {
            throw new WompiProviderError('wompi_link_canonical_mismatch', true, input.providerLinkId);
        }
        return {
            id,
            url: `https://checkout.wompi.co/l/${encodeURIComponent(id)}`,
            amountCents,
            currency: 'COP',
            sku,
            expiresAt,
            merchantPublicKey,
            active: link.active,
        };
    }

    async getTransaction(input: {
        transactionId: string;
        publicKey: string;
        environment: WompiEnvironment;
    }): Promise<CanonicalWompiTransaction> {
        if (this.keyEnvironment(input.publicKey, 'public') !== input.environment) {
            throw new WompiProviderError('wompi_environment_mismatch', false);
        }
        let response: Response;
        try {
            response = await fetch(
                `${WOMPI_BASE_URLS[input.environment]}/transactions/${encodeURIComponent(input.transactionId)}`,
                {
                    headers: { Authorization: `Bearer ${input.publicKey}` },
                    signal: AbortSignal.timeout(15_000),
                },
            );
        } catch {
            throw new WompiProviderError('wompi_transaction_lookup_failed', true);
        }
        if (!response.ok) {
            throw new WompiProviderError('wompi_transaction_lookup_failed', response.status >= 500);
        }
        const payload: any = await response.json().catch(() => null);
        const transaction = this.toCanonicalTransaction(payload?.data, input.environment);
        if (!transaction || transaction.id !== input.transactionId) {
            throw new WompiProviderError('invalid_wompi_transaction_response', false);
        }
        return transaction;
    }

    /**
     * Recovers the transaction Wompi created for one of our payment links when
     * the commerce event never arrived — a mistyped events secret, an events URL
     * that was never pasted, or retries exhausted during a deploy.
     *
     * This is the only way out of a circular dependency: the settlement path
     * keys off provider_link_id, but provider_transaction_id was previously
     * written ONLY by the webhook, so a lost first event left the customer
     * charged and the order unpaid forever with nothing able to repair it. The
     * payment link id is known at creation time, so it is the identifier that
     * survives a lost event.
     *
     * Returns null when the link has no transaction yet (nobody paid), which is
     * the ordinary case and must NOT be treated as an error.
     */
    async findTransactionByPaymentLink(input: {
        providerLinkId: string;
        publicKey: string;
        privateKey: string;
        environment: WompiEnvironment;
    }): Promise<CanonicalWompiTransaction | null> {
        if (this.keyEnvironment(input.publicKey, 'public') !== input.environment
            || this.keyEnvironment(input.privateKey, 'private') !== input.environment) {
            throw new WompiProviderError('wompi_environment_mismatch', false);
        }

        let response: Response;
        try {
            response = await fetch(
                `${WOMPI_BASE_URLS[input.environment]}/transactions`
                + `?payment_link_id=${encodeURIComponent(input.providerLinkId)}`,
                {
                    headers: { Authorization: `Bearer ${input.privateKey}` },
                    signal: AbortSignal.timeout(15_000),
                },
            );
        } catch {
            throw new WompiProviderError('wompi_transaction_lookup_failed', true);
        }
        if (!response.ok) {
            throw new WompiProviderError('wompi_transaction_lookup_failed', response.status >= 500);
        }
        const payload: any = await response.json().catch(() => null);
        if (!Array.isArray(payload?.data)) {
            throw new WompiProviderError('invalid_wompi_transaction_list', false);
        }

        // Filter by payment_link_id ourselves rather than trusting the query
        // parameter. If the provider ever ignores an unrecognised filter and
        // returns the merchant's whole transaction list, an unfiltered read
        // would settle a DIFFERENT customer's order against this intent.
        const candidates = payload.data
            .filter((raw: any) => this.optionalString(raw?.payment_link_id) === input.providerLinkId)
            .map((raw: any) => this.toCanonicalTransaction(raw, input.environment))
            .filter((transaction: CanonicalWompiTransaction | null): transaction is CanonicalWompiTransaction =>
                transaction !== null);
        if (!candidates.length) return null;

        // Never let an older DECLINED attempt close reconciliation while money
        // actually moved. Approved wins, then in-flight, then newest terminal.
        const priority = (transaction: CanonicalWompiTransaction) => {
            if (transaction.status === 'APPROVED') return 3;
            if (transaction.status === 'PENDING') return 2;
            return 1;
        };
        if (candidates.length > 1) {
            this.logger.warn(
                `[Wompi] Payment link ${input.providerLinkId} resolved to ${candidates.length} transactions;`
                + ' selecting by settlement priority',
            );
        }
        return [...candidates].sort((left, right) => priority(right) - priority(left))[0];
    }

    private toCanonicalTransaction(raw: any, environment: WompiEnvironment): CanonicalWompiTransaction | null {
        const id = this.optionalString(raw?.id);
        const status = this.optionalString(raw?.status)?.toUpperCase();
        const currency = this.optionalString(raw?.currency)?.toUpperCase();
        const paymentLinkId = this.optionalString(raw?.payment_link_id);
        const amountCents = Number(raw?.amount_in_cents);
        if (!id
            || !['PENDING', 'APPROVED', 'DECLINED', 'VOIDED', 'ERROR'].includes(status || '')
            || currency !== 'COP'
            || !Number.isSafeInteger(amountCents)
            || amountCents <= 0) {
            return null;
        }
        return {
            id,
            status: status as CanonicalWompiTransaction['status'],
            amountCents,
            currency,
            paymentLinkId,
            environment,
        };
    }

    private keyEnvironment(value: string, kind: 'public' | 'private' | 'events'): WompiEnvironment | null {
        const key = String(value || '').trim();
        if (kind === 'public') {
            if (/^pub_test_[A-Za-z0-9_-]{12,}$/.test(key)) return 'sandbox';
            if (/^pub_prod_[A-Za-z0-9_-]{12,}$/.test(key)) return 'production';
        } else if (kind === 'private') {
            if (/^prv_test_[A-Za-z0-9_-]{12,}$/.test(key)) return 'sandbox';
            if (/^prv_prod_[A-Za-z0-9_-]{12,}$/.test(key)) return 'production';
        } else {
            if (/^test_events_[A-Za-z0-9_-]{12,}$/.test(key)) return 'sandbox';
            if (/^prod_events_[A-Za-z0-9_-]{12,}$/.test(key)) return 'production';
        }
        return null;
    }

    private optionalString(value: unknown): string | undefined {
        const normalized = typeof value === 'string' ? value.trim() : '';
        return normalized || undefined;
    }
}
