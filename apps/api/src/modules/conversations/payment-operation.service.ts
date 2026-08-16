import { Inject, Injectable, Optional } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

export const PAYMENT_OPERATION_PROVIDER = 'PAYMENT_OPERATION_PROVIDER';

export type PaymentOperationKind = 'payment_link' | 'refund' | 'discount';

export interface PaymentLinkProviderRequest {
    tenantId: string;
    contactId: string;
    amountCents: number;
    currency: string;
    description: string;
    externalReference: string;
    idempotencyKey: string;
}

export interface RefundProviderRequest {
    tenantId: string;
    contactId: string;
    paymentReference: string;
    amountCents?: number;
    currency: string;
    reason: string;
    idempotencyKey: string;
}

export interface DiscountProviderRequest {
    tenantId: string;
    contactId: string;
    canonicalReference: string;
    percent: number;
    reason?: string;
    idempotencyKey: string;
}

/** No provider is selected by this contract. An adapter must be bound explicitly. */
export interface PaymentOperationProvider {
    readonly id: string;
    /** A bound adapter may deliberately expose only a subset of money actions. */
    supports?(kind: PaymentOperationKind): boolean;
    /** Mandatory ownership check before any money/provider side effect. */
    resolveOwnership(input: {
        tenantId: string;
        contactId: string;
        kind: PaymentOperationKind;
        reference: string;
    }): Promise<{
        owned: boolean;
        canonicalReference?: string;
        /** When supplied, the caller-provided money values must match exactly. */
        canonicalAmountCents?: number;
        canonicalCurrency?: string;
    }>;
    createPaymentLink(input: PaymentLinkProviderRequest): Promise<{
        providerOperationId: string;
        url: string;
    }>;
    refundPayment(input: RefundProviderRequest): Promise<{ providerOperationId: string }>;
    applyDiscount(input: DiscountProviderRequest): Promise<{
        providerOperationId: string;
        code: string;
    }>;
    reconcile(input: {
        tenantId: string;
        kind: PaymentOperationKind;
        providerOperationId: string;
    }): Promise<{ status: 'confirmed' | 'pending' | 'failed'; details?: Record<string, unknown> }>;
    /** Required for ambiguous network failures after a provider side effect. */
    findByIdempotencyKey(input: {
        tenantId: string;
        kind: PaymentOperationKind;
        idempotencyKey: string;
    }): Promise<{ providerOperationId: string } | null>;
}

interface PaymentLedgerRow {
    id: string;
    operation_kind: PaymentOperationKind;
    status: string;
    provider: string | null;
    provider_operation_id: string | null;
    request_hash: string;
    response_payload: any;
}

function hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

function providerUnavailable(kind: PaymentOperationKind, operationId: string): Record<string, unknown> {
    return {
        error: 'payment_provider_unavailable',
        operationKind: kind,
        operationId,
        shouldHandoff: true,
        message: 'La solicitud quedó registrada, pero no hay un proveedor de pagos aprobado. Escala la gestión a una persona y no prometas que el cobro, reembolso o descuento se completó.',
    };
}

/**
 * Provider-neutral money-operation boundary. It records intent before any
 * external effect and reports success only after the provider reconciles it.
 */
@Injectable()
export class PaymentOperationService {
    private readonly initializedSchemas = new Map<string, Promise<void>>();

    constructor(
        private readonly prisma: PrismaService,
        @Optional() @Inject(PAYMENT_OPERATION_PROVIDER)
        private readonly provider?: PaymentOperationProvider,
    ) {}

    async createPaymentLink(
        schemaName: string,
        tenantId: string,
        contactId: string,
        executionLedgerId: string,
        args: Record<string, unknown>,
    ): Promise<Record<string, unknown>> {
        const amountCents = Number(args.amountCents);
        const currency = this.currency(args.currency);
        const description = this.boundedText(args.description, 250);
        const externalReference = this.exactIdentifier(args.externalReference, 180);
        if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || !currency || !description || !externalReference) {
            return { error: 'invalid_payment_request', message: 'Monto, moneda, descripción o referencia inválidos.' };
        }

        const intent = await this.createIntent(schemaName, executionLedgerId, 'payment_link', {
            amountCents,
            currency,
            description,
            externalReference,
        });
        const terminal = this.terminalResult(intent);
        if (terminal) return terminal;
        if (!this.provider || !this.supports('payment_link')) {
            return this.handoffUnavailable(schemaName, intent, 'payment_link');
        }
        const canonicalReference = await this.resolveCanonicalOwnership(
            tenantId,
            contactId,
            'payment_link',
            externalReference,
            { amountCents, currency },
        );
        if (!canonicalReference || !await this.bindCanonicalReference(schemaName, intent.id, canonicalReference)) {
            return this.markOwnershipFailure(schemaName, intent.id);
        }

        let providerOperationId: string | undefined;
        try {
            if (!await this.markProcessing(schemaName, intent.id, this.provider.id)) {
                return this.processingConflict(schemaName, intent.id);
            }
            const created = await this.provider.createPaymentLink({
                tenantId,
                contactId,
                amountCents,
                currency,
                description,
                externalReference: canonicalReference,
                idempotencyKey: intent.id,
            });
            providerOperationId = created?.providerOperationId;
            if (!created?.providerOperationId || !this.isHttpsUrl(created.url)) {
                return this.markReconciliationRequired(schemaName, intent.id, 'invalid_provider_response', providerOperationId);
            }
            if (!await this.markProviderSubmitted(schemaName, intent.id, created.providerOperationId, {
                paymentLink: created.url,
            })) {
                return this.markReconciliationRequired(schemaName, intent.id, 'provider_submission_commit_failed', created.providerOperationId);
            }
            const reconciliation = await this.provider.reconcile({
                tenantId,
                kind: 'payment_link',
                providerOperationId: created.providerOperationId,
            });
            if (reconciliation.status !== 'confirmed') {
                return this.markReconciliationRequired(schemaName, intent.id, reconciliation.status, created.providerOperationId);
            }
            const result = {
                success: true,
                operationId: intent.id,
                paymentLink: created.url,
                amountCents,
                currency,
                reconciled: true,
            };
            if (!await this.markSucceeded(schemaName, intent.id, created.providerOperationId, result)) {
                return this.markReconciliationRequired(schemaName, intent.id, 'ledger_commit_failed', created.providerOperationId);
            }
            return result;
        } catch {
            providerOperationId ||= await this.recoverProviderOperationId(tenantId, 'payment_link', intent.id);
            return this.markReconciliationRequired(schemaName, intent.id, 'provider_call_failed', providerOperationId);
        }
    }

    async refundPayment(
        schemaName: string,
        tenantId: string,
        contactId: string,
        executionLedgerId: string,
        args: Record<string, unknown>,
    ): Promise<Record<string, unknown>> {
        const paymentReference = this.exactIdentifier(args.paymentReference, 180);
        const currency = this.currency(args.currency);
        const reason = this.boundedText(args.reason, 500);
        const amount = args.amountCents == null ? undefined : Number(args.amountCents);
        if (!paymentReference || !currency || !reason
            || (amount !== undefined && (!Number.isSafeInteger(amount) || amount <= 0))) {
            return { error: 'invalid_refund_request', message: 'Referencia, monto, moneda o motivo inválidos.' };
        }

        const intent = await this.createIntent(schemaName, executionLedgerId, 'refund', {
            paymentReference,
            amountCents: amount ?? null,
            currency,
            reason,
        });
        const terminal = this.terminalResult(intent);
        if (terminal) return terminal;
        if (!this.provider || !this.supports('refund')) {
            return this.handoffUnavailable(schemaName, intent, 'refund');
        }
        const canonicalReference = await this.resolveCanonicalOwnership(
            tenantId,
            contactId,
            'refund',
            paymentReference,
        );
        if (!canonicalReference || !await this.bindCanonicalReference(schemaName, intent.id, canonicalReference)) {
            return this.markOwnershipFailure(schemaName, intent.id);
        }

        let providerOperationId: string | undefined;
        try {
            if (!await this.markProcessing(schemaName, intent.id, this.provider.id)) {
                return this.processingConflict(schemaName, intent.id);
            }
            const submitted = await this.provider.refundPayment({
                tenantId,
                contactId,
                paymentReference: canonicalReference,
                amountCents: amount,
                currency,
                reason,
                idempotencyKey: intent.id,
            });
            providerOperationId = submitted?.providerOperationId;
            if (!submitted?.providerOperationId) {
                return this.markReconciliationRequired(schemaName, intent.id, 'invalid_provider_response');
            }
            if (!await this.markProviderSubmitted(schemaName, intent.id, submitted.providerOperationId, {})) {
                return this.markReconciliationRequired(schemaName, intent.id, 'provider_submission_commit_failed', submitted.providerOperationId);
            }
            const reconciliation = await this.provider.reconcile({
                tenantId,
                kind: 'refund',
                providerOperationId: submitted.providerOperationId,
            });
            if (reconciliation.status !== 'confirmed') {
                return this.markReconciliationRequired(schemaName, intent.id, reconciliation.status, submitted.providerOperationId);
            }
            const result = {
                success: true,
                operationId: intent.id,
                providerOperationId: submitted.providerOperationId,
                reconciled: true,
            };
            if (!await this.markSucceeded(schemaName, intent.id, submitted.providerOperationId, result)) {
                return this.markReconciliationRequired(schemaName, intent.id, 'ledger_commit_failed', submitted.providerOperationId);
            }
            return result;
        } catch {
            providerOperationId ||= await this.recoverProviderOperationId(tenantId, 'refund', intent.id);
            return this.markReconciliationRequired(schemaName, intent.id, 'provider_call_failed', providerOperationId);
        }
    }

    async applyDiscount(
        schemaName: string,
        tenantId: string,
        contactId: string,
        executionLedgerId: string,
        args: Record<string, unknown>,
    ): Promise<Record<string, unknown>> {
        const percent = Math.round(Number(args.percent));
        const reason = this.boundedText(args.reason, 500);
        if (!Number.isSafeInteger(percent) || percent <= 0 || percent > 30) {
            return { error: 'invalid_discount', message: 'El descuento debe ser un entero entre 1 y 30.' };
        }
        const intent = await this.createIntent(schemaName, executionLedgerId, 'discount', {
            percent,
            reason: reason || null,
        });
        const terminal = this.terminalResult(intent);
        if (terminal) return terminal;
        if (!this.provider || !this.supports('discount')) {
            return this.handoffUnavailable(schemaName, intent, 'discount');
        }
        const canonicalReference = await this.resolveCanonicalOwnership(
            tenantId,
            contactId,
            'discount',
            `contact:${contactId}`,
        );
        if (!canonicalReference || !await this.bindCanonicalReference(schemaName, intent.id, canonicalReference)) {
            return this.markOwnershipFailure(schemaName, intent.id);
        }

        let providerOperationId: string | undefined;
        try {
            if (!await this.markProcessing(schemaName, intent.id, this.provider.id)) {
                return this.processingConflict(schemaName, intent.id);
            }
            const applied = await this.provider.applyDiscount({
                tenantId,
                contactId,
                canonicalReference,
                percent,
                reason: reason || undefined,
                idempotencyKey: intent.id,
            });
            providerOperationId = applied?.providerOperationId;
            if (!applied?.providerOperationId || !applied.code) {
                return this.markReconciliationRequired(schemaName, intent.id, 'invalid_provider_response', providerOperationId);
            }
            if (!await this.markProviderSubmitted(schemaName, intent.id, applied.providerOperationId, {
                code: applied.code,
                percent,
            })) {
                return this.markReconciliationRequired(schemaName, intent.id, 'provider_submission_commit_failed', applied.providerOperationId);
            }
            const reconciliation = await this.provider.reconcile({
                tenantId,
                kind: 'discount',
                providerOperationId: applied.providerOperationId,
            });
            if (reconciliation.status !== 'confirmed') {
                return this.markReconciliationRequired(schemaName, intent.id, reconciliation.status, applied.providerOperationId);
            }
            const result = {
                success: true,
                operationId: intent.id,
                code: applied.code,
                percent,
                reconciled: true,
            };
            if (!await this.markSucceeded(schemaName, intent.id, applied.providerOperationId, result)) {
                return this.markReconciliationRequired(schemaName, intent.id, 'ledger_commit_failed', applied.providerOperationId);
            }
            return result;
        } catch {
            providerOperationId ||= await this.recoverProviderOperationId(tenantId, 'discount', intent.id);
            return this.markReconciliationRequired(schemaName, intent.id, 'provider_call_failed', providerOperationId);
        }
    }

    private async createIntent(
        schemaName: string,
        executionLedgerId: string,
        kind: PaymentOperationKind,
        safeRequest: Record<string, unknown>,
    ): Promise<PaymentLedgerRow> {
        await this.ensureTable(schemaName);
        const requestHash = hash(JSON.stringify(safeRequest));
        const rows = await this.query<PaymentLedgerRow[]>(
            schemaName,
            `INSERT INTO payment_operation_ledger
                (execution_ledger_id, operation_kind, status, request_hash, request_payload,
                 reconciliation_status)
             VALUES ($1::uuid, $2, 'requested', $3, $4::jsonb, 'not_started')
             ON CONFLICT (execution_ledger_id) DO NOTHING
             RETURNING *`,
            [executionLedgerId, kind, requestHash, JSON.stringify(safeRequest)],
        );
        const existing = rows[0] ? rows : await this.query<PaymentLedgerRow[]>(
            schemaName,
            `SELECT * FROM payment_operation_ledger
              WHERE execution_ledger_id = $1::uuid
              LIMIT 1`,
            [executionLedgerId],
        );
        const row = existing[0];
        if (!row || row.operation_kind !== kind || row.request_hash !== requestHash) {
            throw new Error('payment_operation_idempotency_conflict');
        }
        return row;
    }

    private terminalResult(row: PaymentLedgerRow): Record<string, unknown> | null {
        if (!['succeeded', 'handoff_required', 'reconciliation_required', 'failed'].includes(row.status)) return null;
        if (row.response_payload && typeof row.response_payload === 'object') {
            return { ...row.response_payload, idempotentReplay: true };
        }
        return {
            error: row.status,
            operationId: row.id,
            shouldHandoff: row.status !== 'succeeded',
            idempotentReplay: true,
        };
    }

    private async handoffUnavailable(
        schemaName: string,
        row: PaymentLedgerRow,
        kind: PaymentOperationKind,
    ): Promise<Record<string, unknown>> {
        const result = providerUnavailable(kind, row.id);
        await this.query(
            schemaName,
            `UPDATE payment_operation_ledger
                SET status = 'handoff_required', reconciliation_status = 'provider_unavailable',
                    response_payload = $2::jsonb, updated_at = NOW()
              WHERE id = $1::uuid AND status = 'requested'`,
            [row.id, JSON.stringify(result)],
        );
        return result;
    }

    private async resolveCanonicalOwnership(
        tenantId: string,
        contactId: string,
        kind: PaymentOperationKind,
        reference: string,
        expectedMoney?: { amountCents: number; currency: string },
    ): Promise<string | null> {
        if (!this.provider) return null;
        try {
            const result = await this.provider.resolveOwnership({ tenantId, contactId, kind, reference });
            if (result?.owned !== true) return null;
            if (expectedMoney && result.canonicalAmountCents !== undefined
                && result.canonicalAmountCents !== expectedMoney.amountCents) return null;
            if (expectedMoney && result.canonicalCurrency !== undefined
                && result.canonicalCurrency.toUpperCase() !== expectedMoney.currency) return null;
            if (typeof result.canonicalReference !== 'string') return null;
            const canonical = result.canonicalReference.trim();
            return canonical.length > 0 && canonical.length <= 180 ? canonical : null;
        } catch {
            return null;
        }
    }

    private supports(kind: PaymentOperationKind): boolean {
        if (!this.provider) return false;
        return this.provider.supports?.(kind) !== false;
    }

    private async bindCanonicalReference(
        schemaName: string,
        id: string,
        canonicalReference: string,
    ): Promise<boolean> {
        const rows = await this.query<Array<{ id: string }>>(
            schemaName,
            `UPDATE payment_operation_ledger
                SET canonical_reference = $2, updated_at = NOW()
              WHERE id = $1::uuid AND status = 'requested'
                AND (canonical_reference IS NULL OR canonical_reference = $2)
              RETURNING id`,
            [id, canonicalReference],
        );
        return Boolean(rows[0]);
    }

    private async recoverProviderOperationId(
        tenantId: string,
        kind: PaymentOperationKind,
        idempotencyKey: string,
    ): Promise<string | undefined> {
        if (!this.provider) return undefined;
        try {
            const recovered = await this.provider.findByIdempotencyKey({
                tenantId,
                kind,
                idempotencyKey,
            });
            return recovered?.providerOperationId || undefined;
        } catch {
            return undefined;
        }
    }

    private async markOwnershipFailure(schemaName: string, id: string): Promise<Record<string, unknown>> {
        const result = {
            error: 'payment_ownership_unverified',
            operationId: id,
            shouldHandoff: true,
            message: 'No se pudo demostrar que el pago pertenece a este contacto. No ejecutes la operación.',
        };
        await this.query(
            schemaName,
            `UPDATE payment_operation_ledger
                SET status = 'handoff_required', reconciliation_status = 'ownership_unverified',
                    response_payload = $2::jsonb, updated_at = NOW()
              WHERE id = $1::uuid AND status = 'requested'`,
            [id, JSON.stringify(result)],
        );
        return result;
    }

    private async markProcessing(schemaName: string, id: string, provider: string): Promise<boolean> {
        const rows = await this.query<PaymentLedgerRow[]>(
            schemaName,
            `UPDATE payment_operation_ledger
                SET status = 'processing', provider = $2, updated_at = NOW()
              WHERE id = $1::uuid AND status = 'requested'
              RETURNING *`,
            [id, provider],
        );
        return Boolean(rows[0]);
    }

    private async processingConflict(schemaName: string, id: string): Promise<Record<string, unknown>> {
        const rows = await this.query<PaymentLedgerRow[]>(
            schemaName,
            `SELECT * FROM payment_operation_ledger WHERE id = $1::uuid LIMIT 1`,
            [id],
        );
        const terminal = this.terminalResult(rows[0]);
        if (terminal) return terminal;
        return {
            error: rows[0]?.status === 'processing'
                ? 'payment_operation_in_progress'
                : 'payment_ledger_acquire_failed',
            operationId: id,
            shouldHandoff: rows[0]?.status !== 'processing',
            message: rows[0]?.status === 'processing'
                ? 'La operación ya está en curso y no se repetirá.'
                : 'No se pudo adquirir el control exclusivo de la operación. No la ejecutes.',
        };
    }

    private async markSucceeded(
        schemaName: string,
        id: string,
        providerOperationId: string,
        result: Record<string, unknown>,
    ): Promise<boolean> {
        const rows = await this.query<Array<{ id: string }>>(
            schemaName,
            `UPDATE payment_operation_ledger
                SET status = 'succeeded', provider_operation_id = $2,
                    reconciliation_status = 'confirmed', reconciled_at = NOW(),
                    response_payload = $3::jsonb, updated_at = NOW()
              WHERE id = $1::uuid AND status = 'processing'
              RETURNING id`,
            [id, providerOperationId, JSON.stringify(result)],
        );
        return Boolean(rows[0]);
    }

    /** Persist the provider receipt before reconciliation or any later throw. */
    private async markProviderSubmitted(
        schemaName: string,
        id: string,
        providerOperationId: string,
        safeProviderPayload: Record<string, unknown>,
    ): Promise<boolean> {
        const rows = await this.query<Array<{ id: string }>>(
            schemaName,
            `UPDATE payment_operation_ledger
                SET provider_operation_id = $2,
                    reconciliation_status = 'submitted',
                    response_payload = $3::jsonb,
                    updated_at = NOW()
              WHERE id = $1::uuid AND status = 'processing'
                AND (provider_operation_id IS NULL OR provider_operation_id = $2)
              RETURNING id`,
            [id, providerOperationId, JSON.stringify(safeProviderPayload)],
        );
        return Boolean(rows[0]);
    }

    private async markReconciliationRequired(
        schemaName: string,
        id: string,
        reason: string,
        providerOperationId?: string,
    ): Promise<Record<string, unknown>> {
        const result = {
            error: 'payment_reconciliation_required',
            operationId: id,
            shouldHandoff: true,
            message: 'El proveedor no confirmó el resultado. No repitas ni anuncies éxito; una persona debe reconciliar la operación.',
        };
        await this.query(
            schemaName,
            `UPDATE payment_operation_ledger
                SET status = 'reconciliation_required', reconciliation_status = $2,
                    response_payload = $3::jsonb,
                    provider_operation_id = COALESCE(provider_operation_id, $4),
                    updated_at = NOW()
              WHERE id = $1::uuid`,
            [id, reason.slice(0, 80), JSON.stringify(result), providerOperationId || null],
        );
        return result;
    }

    private ensureTable(schemaName: string): Promise<void> {
        const pending = this.initializedSchemas.get(schemaName);
        if (pending) return pending;
        const initialization = (async () => {
            await this.query(
                schemaName,
                `CREATE TABLE IF NOT EXISTS payment_operation_ledger (
                    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
                    execution_ledger_id UUID NOT NULL UNIQUE REFERENCES tool_execution_ledger(id) ON DELETE RESTRICT,
                    operation_kind VARCHAR(30) NOT NULL
                        CONSTRAINT payment_operation_ledger_kind_chk
                        CHECK (operation_kind IN ('payment_link', 'refund', 'discount')),
                    status VARCHAR(40) NOT NULL
                        CONSTRAINT payment_operation_ledger_status_chk
                        CHECK (status IN ('requested', 'processing', 'succeeded', 'handoff_required', 'reconciliation_required', 'failed')),
                    provider VARCHAR(80),
                    provider_operation_id VARCHAR(255),
                    canonical_reference VARCHAR(180),
                    request_hash CHAR(64) NOT NULL,
                    request_payload JSONB NOT NULL DEFAULT '{}',
                    response_payload JSONB,
                    reconciliation_status VARCHAR(80) NOT NULL,
                    reconciled_at TIMESTAMPTZ,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )`,
            );
            await this.query(
                schemaName,
                `ALTER TABLE payment_operation_ledger
                    ADD COLUMN IF NOT EXISTS canonical_reference VARCHAR(180)`,
            );
            await this.query(
                schemaName,
                `CREATE INDEX IF NOT EXISTS idx_payment_operation_ledger_status
                    ON payment_operation_ledger (status, updated_at)`,
            );
            for (const ddl of [
                `DO $ddl$ BEGIN
                    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_operation_ledger_kind_chk' AND conrelid = 'payment_operation_ledger'::regclass) THEN
                        ALTER TABLE payment_operation_ledger ADD CONSTRAINT payment_operation_ledger_kind_chk CHECK (operation_kind IN ('payment_link', 'refund', 'discount')) NOT VALID;
                    END IF;
                 END $ddl$`,
                `DO $ddl$ BEGIN
                    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_operation_ledger_status_chk' AND conrelid = 'payment_operation_ledger'::regclass) THEN
                        ALTER TABLE payment_operation_ledger ADD CONSTRAINT payment_operation_ledger_status_chk CHECK (status IN ('requested', 'processing', 'succeeded', 'handoff_required', 'reconciliation_required', 'failed')) NOT VALID;
                    END IF;
                 END $ddl$`,
            ]) {
                await this.query(schemaName, ddl);
            }
        })().catch(error => {
            this.initializedSchemas.delete(schemaName);
            throw error;
        });
        this.initializedSchemas.set(schemaName, initialization);
        return initialization;
    }

    private currency(value: unknown): string | null {
        const currency = String(value || '').trim().toUpperCase();
        return /^[A-Z]{3}$/.test(currency) ? currency : null;
    }

    private boundedText(value: unknown, max: number): string {
        return typeof value === 'string' ? value.trim().slice(0, max) : '';
    }

    private exactIdentifier(value: unknown, max: number): string {
        if (typeof value !== 'string') return '';
        const identifier = value.trim();
        return identifier.length > 0 && identifier.length <= max ? identifier : '';
    }

    private isHttpsUrl(value: unknown): value is string {
        if (typeof value !== 'string') return false;
        try { return new URL(value).protocol === 'https:'; } catch { return false; }
    }

    private query<T = any[]>(schemaName: string, sql: string, params: any[] = []): Promise<T> {
        return this.prisma.executeInTenantSchema<T>(schemaName, sql, params);
    }
}
