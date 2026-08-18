import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
    parsePaymentReference,
    type TenantPaymentProvider,
    type TenantPaymentStatus,
} from './tenant-payment-reference';

export interface TenantPaymentIntent {
    id: string;
    provider: TenantPaymentProvider;
    idempotencyKey: string;
    canonicalReference: string;
    contactId: string;
    amountCents: number;
    currency: string;
    description: string;
    resourceSnapshot: Record<string, unknown>;
    providerLinkId?: string;
    checkoutUrl?: string;
    providerTransactionId?: string;
    status: TenantPaymentStatus;
    expiresAt?: Date;
    paidAt?: Date;
    lastError?: string;
    /** Lets the operator screen show how long a payment has been parked. */
    createdAt?: Date;
}

interface IntentRow {
    id: string;
    provider: TenantPaymentProvider;
    idempotency_key: string;
    canonical_reference: string;
    contact_id: string;
    amount_cents: bigint | number | string;
    currency: string;
    description: string;
    resource_snapshot: Record<string, unknown> | null;
    provider_link_id: string | null;
    checkout_url: string | null;
    provider_transaction_id: string | null;
    status: TenantPaymentStatus;
    expires_at: Date | string | null;
    paid_at: Date | string | null;
    created_at?: Date | string | null;
    last_error: string | null;
}

export interface CanonicalWompiTransaction {
    id: string;
    status: 'PENDING' | 'APPROVED' | 'DECLINED' | 'VOIDED' | 'ERROR';
    amountCents: number;
    currency: string;
    paymentLinkId?: string;
    environment: 'sandbox' | 'production';
}

export interface WompiSettlementResult {
    intent: TenantPaymentIntent | null;
    status: TenantPaymentStatus;
    transitioned: boolean;
    duplicate: boolean;
    validationError?: string;
    kind?: string;
    entityId?: string;
}

const RUNTIME_DDL = [
    `CREATE TABLE IF NOT EXISTS tenant_payment_intents (
        id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
        provider VARCHAR(30) NOT NULL,
        idempotency_key VARCHAR(180) NOT NULL,
        canonical_reference VARCHAR(180) NOT NULL,
        contact_id UUID NOT NULL,
        amount_cents BIGINT NOT NULL,
        currency CHAR(3) NOT NULL,
        description VARCHAR(250) NOT NULL,
        resource_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
        provider_link_id VARCHAR(255),
        checkout_url TEXT,
        provider_transaction_id VARCHAR(255),
        status VARCHAR(30) NOT NULL DEFAULT 'pending',
        expires_at TIMESTAMPTZ,
        paid_at TIMESTAMPTZ,
        last_error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT tenant_payment_intents_provider_idem_uq UNIQUE (provider, idempotency_key),
        CONSTRAINT tenant_payment_intents_amount_chk CHECK (amount_cents > 0),
        CONSTRAINT tenant_payment_intents_currency_chk CHECK (currency ~ '^[A-Z]{3}$'),
        CONSTRAINT tenant_payment_intents_provider_chk CHECK (provider IN ('mercadopago', 'wompi')),
        CONSTRAINT tenant_payment_intents_status_chk CHECK (status IN ('pending', 'paid', 'failed', 'refunded', 'expired', 'requires_review', 'ambiguous'))
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS uidx_tenant_payment_intents_provider_link
        ON tenant_payment_intents (provider, provider_link_id) WHERE provider_link_id IS NOT NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS uidx_tenant_payment_intents_unresolved_reference
        ON tenant_payment_intents (canonical_reference)
        WHERE status IN ('pending', 'requires_review', 'ambiguous')`,
    `CREATE INDEX IF NOT EXISTS idx_tenant_payment_intents_contact_reference
        ON tenant_payment_intents (contact_id, canonical_reference, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_tenant_payment_intents_transaction
        ON tenant_payment_intents (provider, provider_transaction_id) WHERE provider_transaction_id IS NOT NULL`,
    `CREATE TABLE IF NOT EXISTS tenant_payment_attempts (
        id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
        intent_id UUID REFERENCES tenant_payment_intents(id) ON DELETE RESTRICT,
        provider VARCHAR(30) NOT NULL,
        provider_event_key CHAR(64) NOT NULL,
        provider_link_id VARCHAR(255),
        provider_transaction_id VARCHAR(255),
        provider_status VARCHAR(40),
        normalized_status VARCHAR(30) NOT NULL,
        amount_cents BIGINT,
        currency CHAR(3),
        event_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
        validation_error VARCHAR(120),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT tenant_payment_attempts_event_uq UNIQUE (provider, provider_event_key),
        CONSTRAINT tenant_payment_attempts_provider_chk CHECK (provider IN ('mercadopago', 'wompi')),
        CONSTRAINT tenant_payment_attempts_status_chk CHECK (normalized_status IN ('pending', 'paid', 'failed', 'refunded', 'requires_review', 'ambiguous'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_tenant_payment_attempts_intent
        ON tenant_payment_attempts (intent_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_tenant_payment_attempts_transaction
        ON tenant_payment_attempts (provider, provider_transaction_id, created_at DESC)`,
] as const;

@Injectable()
export class TenantPaymentStoreService {
    private readonly logger = new Logger(TenantPaymentStoreService.name);
    private readonly initializedSchemas = new Set<string>();
    private readonly initializingSchemas = new Map<string, Promise<void>>();

    constructor(private readonly prisma: PrismaService) {}

    async ensureForTenant(tenantId: string): Promise<string> {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        if (!schemaName) throw new ServiceUnavailableException('tenant_schema_unavailable');
        if (this.initializedSchemas.has(schemaName)) return schemaName;

        let pending = this.initializingSchemas.get(schemaName);
        if (!pending) {
            pending = (async () => {
                for (const sql of RUNTIME_DDL) {
                    await this.prisma.executeInTenantSchema(schemaName, sql, []);
                }
                this.initializedSchemas.add(schemaName);
            })().finally(() => this.initializingSchemas.delete(schemaName));
            this.initializingSchemas.set(schemaName, pending);
        }
        await pending;
        return schemaName;
    }

    async isAvailable(tenantId: string): Promise<boolean> {
        try {
            await this.ensureForTenant(tenantId);
            return true;
        } catch (error: any) {
            this.logger.warn(`Payment ledger unavailable for tenant ${tenantId}: ${error.message}`);
            return false;
        }
    }

    async hasUnresolvedForProvider(
        tenantId: string,
        provider: TenantPaymentProvider,
    ): Promise<boolean> {
        const schemaName = await this.ensureForTenant(tenantId);
        const rows = await this.prisma.executeInTenantSchema<Array<{ present: boolean }>>(
            schemaName,
            `SELECT EXISTS (
                SELECT 1
                  FROM tenant_payment_intents
                 WHERE provider = $1
                   AND status IN ('pending', 'requires_review', 'ambiguous')
            ) AS present`,
            [provider],
        );
        return rows[0]?.present === true;
    }

    /**
     * Whether any durable payment evidence is still cryptographically bound
     * to this credential generation. A terminal payment can receive a late
     * refund/void/chargeback event, so paid/refunded rows and any row that
     * reached the provider must keep their original verification credentials.
     * A locally failed intent with no remote identifiers is the only history
     * that is safe to ignore when replacing credentials.
     */
    async hasCredentialBoundHistoryForProvider(
        tenantId: string,
        provider: TenantPaymentProvider,
    ): Promise<boolean> {
        const schemaName = await this.ensureForTenant(tenantId);
        const rows = await this.prisma.executeInTenantSchema<Array<{ present: boolean }>>(
            schemaName,
            `SELECT EXISTS (
                SELECT 1
                  FROM tenant_payment_intents
                 WHERE provider = $1
                   AND (
                       status IN ('pending', 'paid', 'refunded', 'requires_review', 'ambiguous')
                       OR provider_link_id IS NOT NULL
                       OR provider_transaction_id IS NOT NULL
                   )
            ) AS present`,
            [provider],
        );
        return rows[0]?.present === true;
    }

    async createOrGetIntent(input: {
        tenantId: string;
        provider: TenantPaymentProvider;
        idempotencyKey: string;
        canonicalReference: string;
        contactId: string;
        amountCents: number;
        currency: string;
        description: string;
        resourceSnapshot: Record<string, unknown>;
        expiresAt?: Date;
    }): Promise<{ intent: TenantPaymentIntent; created: boolean }> {
        const schemaName = await this.ensureForTenant(input.tenantId);
        return this.prisma.transactionInTenantSchema(schemaName, async query => {
            const inserted = await query<IntentRow[]>(
                `INSERT INTO tenant_payment_intents
                    (provider, idempotency_key, canonical_reference, contact_id,
                     amount_cents, currency, description, resource_snapshot, expires_at)
                 VALUES ($1, $2, $3, $4::uuid, $5::bigint, $6, $7, $8::jsonb, $9::timestamptz)
                 ON CONFLICT DO NOTHING
                 RETURNING *`,
                [
                    input.provider,
                    input.idempotencyKey,
                    input.canonicalReference,
                    input.contactId,
                    input.amountCents,
                    input.currency,
                    input.description.slice(0, 250),
                    JSON.stringify(input.resourceSnapshot),
                    input.expiresAt?.toISOString() ?? null,
                ],
            );
            if (inserted[0]) return { intent: this.mapIntent(inserted[0]), created: true };

            const existing = await query<IntentRow[]>(
                `SELECT *
                   FROM tenant_payment_intents
                  WHERE (provider = $1 AND idempotency_key = $2)
                     OR (canonical_reference = $3 AND status IN ('pending', 'requires_review', 'ambiguous'))
                  ORDER BY (provider = $1 AND idempotency_key = $2) DESC, created_at DESC
                  LIMIT 1
                  FOR UPDATE`,
                [input.provider, input.idempotencyKey, input.canonicalReference],
            );
            const row = existing[0];
            if (!row) throw new ServiceUnavailableException('tenant_payment_intent_conflict');
            const intent = this.mapIntent(row);
            if (intent.provider !== input.provider
                || intent.contactId !== input.contactId
                || intent.canonicalReference !== input.canonicalReference
                || intent.amountCents !== input.amountCents
                || intent.currency !== input.currency) {
                throw new ServiceUnavailableException('tenant_payment_idempotency_mismatch');
            }
            // `failed` is reserved for outcomes proven to be before any
            // provider side effect (lock/config/preflight/known 4xx). Re-open
            // that same durable operation on retry so a stable idempotency key
            // does not strand the customer. Ambiguous/review states and any
            // row carrying a provider id remain permanently fail-closed.
            if (intent.status === 'failed'
                && !intent.providerLinkId
                && !intent.providerTransactionId) {
                const reopened = await query<IntentRow[]>(
                    `UPDATE tenant_payment_intents
                        SET status = 'pending',
                            resource_snapshot = $2::jsonb,
                            expires_at = $3::timestamptz,
                            last_error = NULL,
                            updated_at = NOW()
                      WHERE id = $1::uuid
                        AND status = 'failed'
                        AND provider_link_id IS NULL
                        AND provider_transaction_id IS NULL
                      RETURNING *`,
                    [
                        intent.id,
                        JSON.stringify(input.resourceSnapshot),
                        input.expiresAt?.toISOString() ?? null,
                    ],
                );
                if (reopened[0]) {
                    return { intent: this.mapIntent(reopened[0]), created: true };
                }
                throw new ServiceUnavailableException('tenant_payment_intent_retry_conflict');
            }
            return { intent, created: false };
        });
    }

    async attachProviderLink(input: {
        tenantId: string;
        intentId: string;
        providerLinkId: string;
        checkoutUrl: string;
        expiresAt?: Date;
    }): Promise<TenantPaymentIntent> {
        const schemaName = await this.ensureForTenant(input.tenantId);
        const rows = await this.prisma.executeInTenantSchema<IntentRow[]>(
            schemaName,
            `UPDATE tenant_payment_intents
                SET provider_link_id = COALESCE(provider_link_id, $2),
                    checkout_url = $3,
                    status = 'pending',
                    expires_at = COALESCE($4::timestamptz, expires_at),
                    last_error = NULL,
                    updated_at = NOW()
              WHERE id = $1::uuid
                AND status IN ('pending', 'requires_review')
                AND (provider_link_id IS NULL OR provider_link_id = $2)
              RETURNING *`,
            [input.intentId, input.providerLinkId, input.checkoutUrl, input.expiresAt?.toISOString() ?? null],
        );
        if (!rows[0]) throw new ServiceUnavailableException('tenant_payment_link_attach_failed');
        return this.mapIntent(rows[0]);
    }

    /**
     * `expired` is only reachable with positive provider evidence that no
     * transaction was ever started on the link. It is deliberately terminal and
     * — unlike pending/requires_review/ambiguous — sits OUTSIDE the unresolved
     * reference unique index, which is precisely what frees the order to be
     * charged again with a fresh link.
     *
     * Guarded by `status = 'pending'`, so a settled payment can never be walked
     * backwards into an expiry by a late sweep.
     */
    async markCreationState(
        tenantId: string,
        intentId: string,
        status: 'failed' | 'requires_review' | 'ambiguous' | 'expired',
        error: string,
        providerLinkId?: string,
    ): Promise<void> {
        const schemaName = await this.ensureForTenant(tenantId);
        await this.prisma.executeInTenantSchema(
            schemaName,
            `UPDATE tenant_payment_intents
                SET status = $2,
                    last_error = $3,
                    provider_link_id = COALESCE(provider_link_id, $4),
                    updated_at = NOW()
              WHERE id = $1::uuid AND status = 'pending'`,
            [intentId, status, error.slice(0, 500), providerLinkId ?? null],
        );
    }

    async findByIdempotencyKey(
        tenantId: string,
        key: string,
        provider?: TenantPaymentProvider,
    ): Promise<TenantPaymentIntent | null> {
        const schemaName = await this.ensureForTenant(tenantId);
        const rows = await this.prisma.executeInTenantSchema<IntentRow[]>(
            schemaName,
            `SELECT * FROM tenant_payment_intents
              WHERE idempotency_key = $1
                AND ($2::text IS NULL OR provider = $2)
              ORDER BY created_at DESC
              LIMIT 1`,
            [key, provider ?? null],
        );
        return rows[0] ? this.mapIntent(rows[0]) : null;
    }

    async findByProviderLink(
        tenantId: string,
        provider: TenantPaymentProvider,
        providerLinkId: string,
    ): Promise<TenantPaymentIntent | null> {
        const schemaName = await this.ensureForTenant(tenantId);
        const rows = await this.prisma.executeInTenantSchema<IntentRow[]>(
            schemaName,
            `SELECT * FROM tenant_payment_intents
              WHERE provider = $1 AND provider_link_id = $2
              LIMIT 1`,
            [provider, providerLinkId],
        );
        return rows[0] ? this.mapIntent(rows[0]) : null;
    }

    /**
     * Wompi intents that were handed to a customer but for which no commerce
     * event ever arrived: a link exists, yet no provider transaction id was
     * ever written. Each one is a customer who may have paid while the order
     * still reads unpaid, so they are the reconciliation sweep's work list.
     *
     * `olderThanMinutes` keeps the sweep away from links a customer is paying
     * right now — the webhook is still the fast path and should win.
     */
    async findWompiIntentsAwaitingProviderEvidence(
        tenantId: string,
        olderThanMinutes: number,
        limit = 50,
    ): Promise<TenantPaymentIntent[]> {
        const schemaName = await this.ensureForTenant(tenantId);
        const rows = await this.prisma.executeInTenantSchema<IntentRow[]>(
            schemaName,
            `SELECT * FROM tenant_payment_intents
              WHERE provider = 'wompi'
                AND status IN ('pending', 'requires_review')
                AND provider_link_id IS NOT NULL
                AND provider_transaction_id IS NULL
                AND created_at < NOW() - ($1 || ' minutes')::interval
              ORDER BY created_at ASC
              LIMIT $2`,
            [String(Math.max(1, Math.floor(olderThanMinutes))), limit],
        );
        return (rows || []).map((row) => this.mapIntent(row));
    }

    /**
     * Intents parked in a review state. These are the ones the ledger refused to
     * settle automatically (amount changed between link and payment, a second
     * distinct charge, provider evidence unavailable at expiry). They were
     * previously invisible AND unresolvable: no endpoint, no screen, no cron —
     * the only way out was hand-written SQL in production.
     */
    async listUnresolvedIntents(tenantId: string, limit = 100): Promise<TenantPaymentIntent[]> {
        const schemaName = await this.ensureForTenant(tenantId);
        const rows = await this.prisma.executeInTenantSchema<IntentRow[]>(
            schemaName,
            `SELECT * FROM tenant_payment_intents
              WHERE status IN ('requires_review', 'ambiguous')
              ORDER BY created_at DESC
              LIMIT $1`,
            [limit],
        );
        return (rows || []).map((row) => this.mapIntent(row));
    }

    async findById(tenantId: string, intentId: string): Promise<TenantPaymentIntent | null> {
        const schemaName = await this.ensureForTenant(tenantId);
        const rows = await this.prisma.executeInTenantSchema<IntentRow[]>(
            schemaName,
            `SELECT * FROM tenant_payment_intents WHERE id = $1::uuid LIMIT 1`,
            [intentId],
        );
        return rows[0] ? this.mapIntent(rows[0]) : null;
    }

    /**
     * Operator-driven close of a review state, restricted to `expired`.
     *
     * Deliberately NOT a free-form status write: an operator must never be able
     * to type "paid" and manufacture money that the provider never confirmed.
     * Settling as paid stays exclusively with provider evidence, through
     * settleWompiTransaction. This only releases a reference that provably has
     * no payment, so the customer can be charged again.
     *
     * Guarded on the review states, so a settlement that lands between the
     * operator's read and this write always wins.
     */
    async discardUnresolvedIntent(
        tenantId: string,
        intentId: string,
        reason: string,
    ): Promise<TenantPaymentIntent | null> {
        const schemaName = await this.ensureForTenant(tenantId);
        const rows = await this.prisma.executeInTenantSchema<IntentRow[]>(
            schemaName,
            `UPDATE tenant_payment_intents
                SET status = 'expired',
                    last_error = $2,
                    updated_at = NOW()
              WHERE id = $1::uuid
                AND status IN ('requires_review', 'ambiguous')
              RETURNING *`,
            [intentId, reason.slice(0, 500)],
        );
        return rows[0] ? this.mapIntent(rows[0]) : null;
    }

    async findUnresolvedByReference(
        tenantId: string,
        provider: TenantPaymentProvider,
        canonicalReference: string,
    ): Promise<TenantPaymentIntent | null> {
        const schemaName = await this.ensureForTenant(tenantId);
        const rows = await this.prisma.executeInTenantSchema<IntentRow[]>(
            schemaName,
            `SELECT * FROM tenant_payment_intents
              WHERE provider = $1
                AND canonical_reference = $2
                AND status IN ('pending', 'requires_review', 'ambiguous')
              ORDER BY created_at DESC
              LIMIT 1`,
            [provider, canonicalReference],
        );
        return rows[0] ? this.mapIntent(rows[0]) : null;
    }

    async findLatestOwned(
        tenantId: string,
        contactId: string,
        canonicalReference: string,
    ): Promise<TenantPaymentIntent | null> {
        const schemaName = await this.ensureForTenant(tenantId);
        // Never release the reference on wall-clock expiry alone. A customer
        // can start a bank redirect before expires_at and Wompi may approve it
        // later. Expiration must be established through canonical provider
        // reconciliation (or an explicit operator resolution), not local time.
        const selected = await this.prisma.executeInTenantSchema<IntentRow[]>(
            schemaName,
            `SELECT * FROM tenant_payment_intents
              WHERE contact_id = $1::uuid AND canonical_reference = $2
              ORDER BY created_at DESC LIMIT 1`,
            [contactId, canonicalReference],
        );
        return selected[0] ? this.mapIntent(selected[0]) : null;
    }

    async settleWompiTransaction(input: {
        tenantId: string;
        transaction: CanonicalWompiTransaction;
        eventKey: string;
        source: 'webhook' | 'poll';
    }): Promise<WompiSettlementResult> {
        if (!/^[a-f0-9]{64}$/i.test(input.eventKey)) {
            throw new ServiceUnavailableException('invalid_payment_event_key');
        }
        if (!input.transaction.paymentLinkId) {
            throw new ServiceUnavailableException('wompi_transaction_has_no_payment_link');
        }
        const schemaName = await this.ensureForTenant(input.tenantId);
        const transaction = input.transaction;
        return this.prisma.transactionInTenantSchema(schemaName, async query => {
            const intents = await query<IntentRow[]>(
                `SELECT * FROM tenant_payment_intents
                  WHERE provider = 'wompi' AND provider_link_id = $1
                  LIMIT 2
                  FOR UPDATE`,
                [transaction.paymentLinkId],
            );
            if (intents.length !== 1) {
                const inserted = await this.insertAttempt(query, {
                    intentId: null,
                    eventKey: input.eventKey,
                    transaction,
                    normalizedStatus: 'ambiguous',
                    source: input.source,
                    validationError: intents.length > 1 ? 'multiple_link_matches' : 'unknown_payment_link',
                });
                return {
                    intent: null,
                    status: 'ambiguous',
                    transitioned: false,
                    duplicate: !inserted,
                    validationError: intents.length > 1 ? 'multiple_link_matches' : 'unknown_payment_link',
                };
            }

            const intent = this.mapIntent(intents[0]);
            const parsed = parsePaymentReference(intent.canonicalReference);
            let validationError: string | undefined;
            let current: any;
            if (!parsed) {
                validationError = 'invalid_canonical_reference';
            } else {
                const live = await query<any[]>(
                    `SELECT ${parsed.target.amountExpression} AS amount,
                            ${parsed.target.currencyExpression} AS currency,
                            target.contact_id,
                            target.payment_status,
                            target.status
                       FROM ${parsed.target.table} target
                       ${parsed.target.join ?? ''}
                      WHERE target.id = $1::uuid
                      LIMIT 1
                      FOR UPDATE OF target`,
                    [parsed.entityId],
                );
                current = live[0];
                const currentAmount = Math.round(Number(current?.amount) * 100);
                const currentCurrency = String(current?.currency || '').trim().toUpperCase();
                const currentStatus = String(current?.status || '').trim().toLowerCase();
                const currentPaymentStatus = String(current?.payment_status || 'pending').trim().toLowerCase();
                if (!current) validationError = 'payable_not_found';
                else if (String(current.contact_id || '').toLowerCase() !== intent.contactId.toLowerCase()) {
                    validationError = 'payable_owner_changed';
                } else if (parsed.target.rejectedStatuses.includes(currentStatus)) {
                    validationError = 'payable_not_chargeable';
                } else if (currentPaymentStatus === 'partial') {
                    validationError = 'payable_partial_payment_changed';
                } else if (['paid', 'refunded'].includes(currentPaymentStatus)
                    && !(intent.status === currentPaymentStatus
                        && intent.providerTransactionId === transaction.id)) {
                    validationError = 'payable_already_settled_elsewhere';
                } else if (currentAmount !== intent.amountCents || currentCurrency !== intent.currency) {
                    validationError = 'payable_snapshot_changed';
                }
            }
            if (!validationError && (
                transaction.amountCents !== intent.amountCents
                || transaction.currency !== intent.currency
            )) validationError = 'amount_or_currency_mismatch';

            if (!validationError
                && transaction.status === 'APPROVED'
                && intent.status === 'paid'
                && intent.providerTransactionId
                && intent.providerTransactionId !== transaction.id) {
                validationError = 'multiple_approved_transactions';
            }
            const normalizedStatus = validationError
                ? 'requires_review'
                : this.mapWompiStatus(transaction.status);
            const inserted = await this.insertAttempt(query, {
                intentId: intent.id,
                eventKey: input.eventKey,
                transaction,
                normalizedStatus,
                source: input.source,
                validationError,
            });
            if (!inserted) {
                return {
                    intent,
                    status: intent.status,
                    transitioned: false,
                    duplicate: true,
                    validationError,
                    kind: parsed?.kind,
                    entityId: parsed?.entityId,
                };
            }

            if (validationError) {
                const reviewed = await query<IntentRow[]>(
                    `UPDATE tenant_payment_intents
                        SET status = CASE WHEN status = 'refunded' THEN status ELSE 'requires_review' END,
                            provider_transaction_id = $2,
                            last_error = $3,
                            updated_at = NOW()
                      WHERE id = $1::uuid
                      RETURNING *`,
                    [intent.id, transaction.id, validationError],
                );
                return {
                    intent: this.mapIntent(reviewed[0]),
                    status: reviewed[0].status,
                    transitioned: intent.status !== reviewed[0].status,
                    duplicate: false,
                    validationError,
                    kind: parsed?.kind,
                    entityId: parsed?.entityId,
                };
            }

            if (normalizedStatus === 'pending') {
                const pending = await query<IntentRow[]>(
                    `UPDATE tenant_payment_intents
                        SET provider_transaction_id = $2, updated_at = NOW()
                      WHERE id = $1::uuid AND status = 'pending'
                      RETURNING *`,
                    [intent.id, transaction.id],
                );
                return {
                    intent: pending[0] ? this.mapIntent(pending[0]) : intent,
                    status: pending[0]?.status ?? intent.status,
                    transitioned: false,
                    duplicate: false,
                    kind: parsed?.kind,
                    entityId: parsed?.entityId,
                };
            }

            if (normalizedStatus === 'failed') {
                // A DECLINED/ERROR transaction does not deactivate a Wompi
                // payment link. The customer may retry on that same single-use
                // link, so keep the intent/reference pending and record only
                // this failed attempt. Releasing it would allow two live links.
                return {
                    intent,
                    status: intent.status,
                    transitioned: false,
                    duplicate: false,
                    kind: parsed?.kind,
                    entityId: parsed?.entityId,
                };
            }

            if (!parsed) throw new ServiceUnavailableException('tenant_payment_reference_unavailable');
            const domainStatus = normalizedStatus;
            await query(
                `UPDATE ${parsed.target.table}
                    SET payment_status = $2, updated_at = NOW()
                  WHERE id = $1::uuid
                    AND (
                        $2 = 'refunded'
                        OR ($2 = 'paid' AND COALESCE(payment_status, 'pending') <> 'refunded')
                        OR ($2 = 'failed' AND COALESCE(payment_status, 'pending') NOT IN ('paid', 'refunded'))
                    )`,
                [parsed.entityId, domainStatus],
            );
            const transitioned = await query<IntentRow[]>(
                `UPDATE tenant_payment_intents
                    SET status = $2,
                        provider_transaction_id = $3,
                        paid_at = CASE WHEN $2 = 'paid' THEN COALESCE(paid_at, NOW()) ELSE paid_at END,
                        last_error = NULL,
                        updated_at = NOW()
                  WHERE id = $1::uuid
                    AND status IS DISTINCT FROM $2
                    AND (
                        $2 = 'refunded'
                        OR ($2 = 'paid' AND status NOT IN ('paid', 'refunded', 'requires_review', 'ambiguous'))
                        OR ($2 = 'failed' AND status = 'pending')
                    )
                  RETURNING *`,
                [intent.id, normalizedStatus, transaction.id],
            );
            const finalIntent = transitioned[0] ? this.mapIntent(transitioned[0]) : intent;
            return {
                intent: finalIntent,
                status: finalIntent.status,
                transitioned: !!transitioned[0],
                duplicate: false,
                kind: parsed.kind,
                entityId: parsed.entityId,
            };
        }, { timeout: 20_000 });
    }

    async settleMercadoPagoPayment(input: {
        tenantId: string;
        providerLinkId: string;
        providerPaymentId: string;
        canonicalReference: string;
        status: 'pending' | 'paid' | 'failed' | 'refunded';
        amountCents: number;
        currency: string;
        eventKey: string;
    }): Promise<WompiSettlementResult | null> {
        if (!/^[a-f0-9]{64}$/i.test(input.eventKey)) {
            throw new ServiceUnavailableException('invalid_payment_event_key');
        }
        const schemaName = await this.ensureForTenant(input.tenantId);
        return this.prisma.transactionInTenantSchema(schemaName, async query => {
            const rows = await query<IntentRow[]>(
                `SELECT * FROM tenant_payment_intents
                  WHERE provider = 'mercadopago'
                    AND provider_link_id = $1
                    AND canonical_reference = $2
                  LIMIT 1
                  FOR UPDATE`,
                [input.providerLinkId, input.canonicalReference],
            );
            if (!rows[0]) return null;
            const intent = this.mapIntent(rows[0]);
            const parsed = parsePaymentReference(intent.canonicalReference);
            let validationError: string | undefined;
            let current: any;
            if (!parsed) {
                validationError = 'invalid_canonical_reference';
            } else {
                const live = await query<any[]>(
                    `SELECT ${parsed.target.amountExpression} AS amount,
                            ${parsed.target.currencyExpression} AS currency,
                            target.contact_id,
                            target.payment_status,
                            target.status
                       FROM ${parsed.target.table} target
                       ${parsed.target.join ?? ''}
                      WHERE target.id = $1::uuid
                      LIMIT 1
                      FOR UPDATE OF target`,
                    [parsed.entityId],
                );
                current = live[0];
                const currentAmount = Math.round(Number(current?.amount) * 100);
                const currentCurrency = String(current?.currency || '').trim().toUpperCase();
                const currentStatus = String(current?.status || '').trim().toLowerCase();
                const currentPaymentStatus = String(current?.payment_status || 'pending').trim().toLowerCase();
                if (!current) validationError = 'payable_not_found';
                else if (String(current.contact_id || '').toLowerCase() !== intent.contactId.toLowerCase()) {
                    validationError = 'payable_owner_changed';
                } else if (parsed.target.rejectedStatuses.includes(currentStatus)) {
                    validationError = 'payable_not_chargeable';
                } else if (currentPaymentStatus === 'partial') {
                    validationError = 'payable_partial_payment_changed';
                } else if (['paid', 'refunded'].includes(currentPaymentStatus)
                    && !(intent.status === currentPaymentStatus
                        && intent.providerTransactionId === input.providerPaymentId)) {
                    validationError = 'payable_already_settled_elsewhere';
                } else if (currentAmount !== intent.amountCents || currentCurrency !== intent.currency) {
                    validationError = 'payable_snapshot_changed';
                }
            }
            if (!validationError && (
                input.amountCents !== intent.amountCents
                || input.currency !== intent.currency
            )) validationError = 'amount_or_currency_mismatch';
            if (!validationError
                && input.status === 'paid'
                && intent.status === 'paid'
                && intent.providerTransactionId
                && intent.providerTransactionId !== input.providerPaymentId) {
                validationError = 'multiple_approved_transactions';
            }

            const normalized = validationError ? 'requires_review' : input.status;
            const attempts = await query<Array<{ id: string }>>(
                `INSERT INTO tenant_payment_attempts
                    (intent_id, provider, provider_event_key, provider_link_id,
                     provider_transaction_id, provider_status, normalized_status,
                     amount_cents, currency, event_snapshot, validation_error)
                 VALUES ($1::uuid, 'mercadopago', $2, $3, $4, $5, $6,
                         $7::bigint, $8, $9::jsonb, $10)
                 ON CONFLICT (provider, provider_event_key) DO NOTHING
                 RETURNING id`,
                [
                    intent.id,
                    input.eventKey,
                    input.providerLinkId,
                    input.providerPaymentId,
                    input.status,
                    normalized,
                    input.amountCents,
                    input.currency,
                    JSON.stringify({
                        providerPaymentId: input.providerPaymentId,
                        providerLinkId: input.providerLinkId,
                        status: input.status,
                        amountCents: input.amountCents,
                        currency: input.currency,
                    }),
                    validationError ?? null,
                ],
            );
            if (!attempts[0]) {
                return {
                    intent,
                    status: intent.status,
                    transitioned: false,
                    duplicate: true,
                    kind: parsed?.kind,
                    entityId: parsed?.entityId,
                };
            }
            if (validationError) {
                const reviewed = await query<IntentRow[]>(
                    `UPDATE tenant_payment_intents
                        SET status = CASE WHEN status = 'refunded' THEN status ELSE 'requires_review' END,
                            provider_transaction_id = $2,
                            last_error = $3,
                            updated_at = NOW()
                      WHERE id = $1::uuid
                      RETURNING *`,
                    [intent.id, input.providerPaymentId, validationError],
                );
                return {
                    intent: this.mapIntent(reviewed[0]),
                    status: reviewed[0].status,
                    transitioned: reviewed[0].status !== intent.status,
                    duplicate: false,
                    validationError,
                    kind: parsed?.kind,
                    entityId: parsed?.entityId,
                };
            }
            if (!parsed) throw new ServiceUnavailableException('tenant_payment_reference_unavailable');
            if (input.status === 'pending') {
                const pending = await query<IntentRow[]>(
                    `UPDATE tenant_payment_intents
                        SET provider_transaction_id = $2, updated_at = NOW()
                      WHERE id = $1::uuid AND status = 'pending'
                      RETURNING *`,
                    [intent.id, input.providerPaymentId],
                );
                return {
                    intent: pending[0] ? this.mapIntent(pending[0]) : intent,
                    status: pending[0]?.status ?? intent.status,
                    transitioned: false,
                    duplicate: false,
                    kind: parsed.kind,
                    entityId: parsed.entityId,
                };
            }
            if (input.status === 'failed') {
                // A rejected payment does not deactivate its Checkout Pro
                // preference. Record the attempt but retain the unresolved
                // intent/reference so another live link cannot be issued.
                await query(
                    `UPDATE ${parsed.target.table}
                        SET payment_status = 'failed', updated_at = NOW()
                      WHERE id = $1::uuid
                        AND COALESCE(payment_status, 'pending') NOT IN ('paid', 'refunded')`,
                    [parsed.entityId],
                );
                return {
                    intent,
                    status: intent.status,
                    transitioned: false,
                    duplicate: false,
                    kind: parsed.kind,
                    entityId: parsed.entityId,
                };
            }
            await query(
                `UPDATE ${parsed.target.table}
                    SET payment_status = $2, updated_at = NOW()
                  WHERE id = $1::uuid
                    AND (
                        $2 = 'refunded'
                        OR ($2 = 'paid' AND COALESCE(payment_status, 'pending') <> 'refunded')
                    )`,
                [parsed.entityId, input.status],
            );
            const transitioned = await query<IntentRow[]>(
                `UPDATE tenant_payment_intents
                    SET status = $2,
                        provider_transaction_id = $3,
                        paid_at = CASE WHEN $2 = 'paid' THEN COALESCE(paid_at, NOW()) ELSE paid_at END,
                        last_error = NULL,
                        updated_at = NOW()
                  WHERE id = $1::uuid
                    AND status IS DISTINCT FROM $2
                    AND (
                        $2 = 'refunded'
                        OR ($2 = 'paid' AND status NOT IN ('paid', 'refunded', 'requires_review', 'ambiguous'))
                    )
                  RETURNING *`,
                [intent.id, input.status, input.providerPaymentId],
            );
            const finalIntent = transitioned[0] ? this.mapIntent(transitioned[0]) : intent;
            return {
                intent: finalIntent,
                status: finalIntent.status,
                transitioned: !!transitioned[0],
                duplicate: false,
                kind: parsed.kind,
                entityId: parsed.entityId,
            };
        }, { timeout: 20_000 });
    }

    private async insertAttempt(
        query: <R = any[]>(sql: string, params?: any[]) => Promise<R>,
        input: {
            intentId: string | null;
            eventKey: string;
            transaction: CanonicalWompiTransaction;
            normalizedStatus: Exclude<TenantPaymentStatus, 'expired'>;
            source: 'webhook' | 'poll';
            validationError?: string;
        },
    ): Promise<boolean> {
        const rows = await query<Array<{ id: string }>>(
            `INSERT INTO tenant_payment_attempts
                (intent_id, provider, provider_event_key, provider_link_id,
                 provider_transaction_id, provider_status, normalized_status,
                 amount_cents, currency, event_snapshot, validation_error)
             VALUES ($1::uuid, 'wompi', $2, $3, $4, $5, $6, $7::bigint, $8, $9::jsonb, $10)
             ON CONFLICT (provider, provider_event_key) DO NOTHING
             RETURNING id`,
            [
                input.intentId,
                input.eventKey.toLowerCase(),
                input.transaction.paymentLinkId,
                input.transaction.id,
                input.transaction.status,
                input.normalizedStatus,
                input.transaction.amountCents,
                input.transaction.currency,
                JSON.stringify({
                    source: input.source,
                    environment: input.transaction.environment,
                    transactionId: input.transaction.id,
                    paymentLinkId: input.transaction.paymentLinkId,
                    status: input.transaction.status,
                    amountCents: input.transaction.amountCents,
                    currency: input.transaction.currency,
                }),
                input.validationError ?? null,
            ],
        );
        return !!rows[0];
    }

    private mapWompiStatus(status: CanonicalWompiTransaction['status']): Exclude<TenantPaymentStatus, 'expired' | 'requires_review' | 'ambiguous'> {
        switch (status) {
            case 'APPROVED': return 'paid';
            case 'VOIDED': return 'refunded';
            case 'DECLINED':
            case 'ERROR': return 'failed';
            default: return 'pending';
        }
    }

    private mapIntent(row: IntentRow): TenantPaymentIntent {
        const amountCents = Number(row.amount_cents);
        if (!Number.isSafeInteger(amountCents)) {
            throw new ServiceUnavailableException('tenant_payment_amount_out_of_range');
        }
        return {
            id: row.id,
            provider: row.provider,
            idempotencyKey: row.idempotency_key,
            canonicalReference: row.canonical_reference,
            contactId: row.contact_id,
            amountCents,
            currency: String(row.currency).trim().toUpperCase(),
            description: row.description,
            resourceSnapshot: row.resource_snapshot || {},
            providerLinkId: row.provider_link_id || undefined,
            checkoutUrl: row.checkout_url || undefined,
            providerTransactionId: row.provider_transaction_id || undefined,
            status: row.status,
            expiresAt: row.expires_at ? new Date(row.expires_at) : undefined,
            paidAt: row.paid_at ? new Date(row.paid_at) : undefined,
            lastError: row.last_error || undefined,
            createdAt: row.created_at ? new Date(row.created_at) : undefined,
        };
    }
}
