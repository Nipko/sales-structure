import {
    BadRequestException,
    ConflictException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
    normalizeCurrencyCode,
    requireCurrencyMinorUnitExponent,
} from '../../common/utils/commercial-units.util';

export interface FxSnapshotInput {
    baseCurrency: string;
    quoteCurrency: string;
    /** Positive decimal encoded as text. Numbers are deliberately rejected. */
    rate: string;
    source: string;
    observedAt: string;
}

export interface FxSnapshot extends FxSnapshotInput {
    baseCurrency: string;
    quoteCurrency: string;
    baseMinorUnitExponent: number;
    quoteMinorUnitExponent: number;
    capturedAt: string;
}

export interface TransactionalMoneyInput {
    objectType: string;
    objectId: string;
    lineId?: string;
    /** Integer minor units encoded as text to avoid JavaScript precision loss. */
    amountMinor: string;
    currency: string;
    sourceSystem: string;
    idempotencyKey: string;
    fx?: FxSnapshotInput;
}

export interface MoneyLineage {
    id: string;
    objectType: string;
    objectId: string;
    lineId: string | null;
    sourceAmountMinor: string;
    sourceCurrency: string;
    operatingAmountMinor: string;
    operatingCurrency: string;
    sourceSystem: string;
    idempotencyKey: string;
    fxSnapshot: FxSnapshot | null;
}

export interface OperatingCurrencyState {
    tenantId: string;
    operatingCurrency: string | null;
    lockedAt: string | null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INTEGER_PATTERN = /^-?\d+$/;
const DECIMAL_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/;
const SAFE_OBJECT_TYPE = /^[a-z][a-z0-9_]{0,63}$/;
const SAFE_SOURCE = /^[a-z][a-z0-9_.:-]{0,127}$/i;

/**
 * Canonical monetary boundary for vertical operations.
 *
 * Every persisted line keeps its original amount/currency. Cross-currency
 * aggregates are allowed only after a point-in-time FX snapshot converts the
 * line into the tenant's immutable operating currency; changing a currency
 * label without conversion is therefore impossible through this service.
 */
@Injectable()
export class OperatingCurrencyService {
    constructor(private readonly prisma: PrismaService) {}

    async getState(tenantId: string): Promise<OperatingCurrencyState> {
        this.assertUuid(tenantId, 'tenantId');
        const rows: any[] = await this.prisma.$queryRawUnsafe(
            `SELECT id, operating_currency, operating_currency_locked_at
             FROM public.tenants
             WHERE id = $1::uuid`,
            tenantId,
        );
        if (!rows.length) throw new NotFoundException('Tenant not found');
        return this.mapState(rows[0]);
    }

    /** Configure once, or change only while no transactional line has locked it. */
    async configure(tenantId: string, requestedCurrency: string): Promise<OperatingCurrencyState> {
        this.assertUuid(tenantId, 'tenantId');
        const currency = normalizeCurrencyCode(requestedCurrency, '');
        requireCurrencyMinorUnitExponent(currency);

        return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            const rows: any[] = await tx.$queryRawUnsafe(
                `SELECT id, operating_currency, operating_currency_locked_at
                 FROM public.tenants
                 WHERE id = $1::uuid
                 FOR UPDATE`,
                tenantId,
            );
            if (!rows.length) throw new NotFoundException('Tenant not found');
            const current = rows[0];
            if (current.operating_currency === currency) return this.mapState(current);
            if (current.operating_currency_locked_at) {
                throw new ConflictException({
                    error: 'operating_currency_locked',
                    message: 'Operating currency cannot change after the first transactional amount.',
                    operatingCurrency: current.operating_currency,
                    lockedAt: current.operating_currency_locked_at,
                });
            }

            const updated: any[] = await tx.$queryRawUnsafe(
                `UPDATE public.tenants
                 SET operating_currency = $2, updated_at = NOW()
                 WHERE id = $1::uuid
                 RETURNING id, operating_currency, operating_currency_locked_at`,
                tenantId,
                currency,
            );
            return this.mapState(updated[0]);
        });
    }

    /**
     * Persist original and normalized amounts atomically and lock the operating
     * currency on the first successful business transaction.
     */
    async recordTransactionalAmount(
        tenantId: string,
        input: TransactionalMoneyInput,
    ): Promise<MoneyLineage> {
        this.assertUuid(tenantId, 'tenantId');
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { schemaName: true },
        });
        if (!tenant) throw new NotFoundException('Tenant not found');

        const normalized = this.normalizeTransactionalInput(input);
        return this.prisma.transactionInTenantSchema(tenant.schemaName, async (query) => {
            const tenantRows = await query<any[]>(
                `SELECT id, operating_currency, operating_currency_locked_at
                 FROM public.tenants
                 WHERE id = $1::uuid
                 FOR UPDATE`,
                [tenantId],
            );
            const tenantRow = tenantRows?.[0];
            if (!tenantRow?.operating_currency) {
                throw new ConflictException({
                    error: 'operating_currency_required',
                    message: 'Configure an explicit operating currency before recording money.',
                });
            }

            const operatingCurrency = normalizeCurrencyCode(tenantRow.operating_currency, '');
            const lineage = this.buildLineage(normalized, operatingCurrency);
            const payloadHash = this.lineageHash(lineage);

            const existing = await query<any[]>(
                `SELECT id, object_type, object_id, line_id, source_amount_minor,
                        source_currency, operating_amount_minor, operating_currency,
                        source_system, idempotency_key, fx_snapshot, payload_hash
                 FROM money_lineage
                 WHERE idempotency_key = $1
                 FOR UPDATE`,
                [lineage.idempotencyKey],
            );
            if (existing?.length) {
                if (existing[0].payload_hash !== payloadHash) {
                    throw new ConflictException({
                        error: 'money_idempotency_conflict',
                        message: 'The idempotency key was already used for a different monetary payload.',
                    });
                }
                return this.mapLineage(existing[0]);
            }

            const rows = await query<any[]>(
                `INSERT INTO money_lineage
                    (id, object_type, object_id, line_id, source_amount_minor,
                     source_currency, operating_amount_minor, operating_currency,
                     source_system, idempotency_key, fx_snapshot, payload_hash)
                 VALUES
                    ($1::uuid, $2, $3, $4, $5::numeric, $6, $7::numeric, $8,
                     $9, $10, $11::jsonb, $12)
                 RETURNING id, object_type, object_id, line_id, source_amount_minor,
                           source_currency, operating_amount_minor, operating_currency,
                           source_system, idempotency_key, fx_snapshot`,
                [
                    lineage.id,
                    lineage.objectType,
                    lineage.objectId,
                    lineage.lineId,
                    lineage.sourceAmountMinor,
                    lineage.sourceCurrency,
                    lineage.operatingAmountMinor,
                    lineage.operatingCurrency,
                    lineage.sourceSystem,
                    lineage.idempotencyKey,
                    JSON.stringify(lineage.fxSnapshot),
                    payloadHash,
                ],
            );

            await query(
                `UPDATE public.tenants
                 SET operating_currency_locked_at = COALESCE(operating_currency_locked_at, NOW()),
                     updated_at = NOW()
                 WHERE id = $1::uuid`,
                [tenantId],
            );
            return this.mapLineage(rows[0]);
        });
    }

    async aggregateOperatingAmount(
        tenantId: string,
        filters: { objectType?: string; from?: string; to?: string } = {},
    ): Promise<{ amountMinor: string; currency: string; lineCount: number }> {
        this.assertUuid(tenantId, 'tenantId');
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { schemaName: true },
        });
        if (!tenant) throw new NotFoundException('Tenant not found');

        const conditions: string[] = [];
        const params: unknown[] = [];
        if (filters.objectType) {
            if (!SAFE_OBJECT_TYPE.test(filters.objectType)) {
                throw new BadRequestException('objectType is invalid');
            }
            params.push(filters.objectType);
            conditions.push(`object_type = $${params.length}`);
        }
        for (const [field, value, operator] of [
            ['from', filters.from, '>='],
            ['to', filters.to, '<'],
        ] as const) {
            if (!value) continue;
            this.assertIsoInstant(value, field);
            params.push(value);
            conditions.push(`created_at ${operator} $${params.length}::timestamptz`);
        }
        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        const rows: any[] = await this.prisma.executeInTenantSchema(
            tenant.schemaName,
            `SELECT COALESCE(SUM(operating_amount_minor), 0)::text AS amount_minor,
                    MIN(operating_currency) AS currency_min,
                    MAX(operating_currency) AS currency_max,
                    COUNT(*)::int AS line_count
             FROM money_lineage
             ${where}`,
            params as any[],
        );
        const row = rows[0];
        if (row.currency_min && row.currency_min !== row.currency_max) {
            throw new ConflictException({
                error: 'mixed_operating_currency',
                message: 'Aggregate contains more than one operating currency and cannot be summed.',
            });
        }
        const state = await this.getState(tenantId);
        if (!state.operatingCurrency) {
            throw new ConflictException({ error: 'operating_currency_required' });
        }
        return {
            amountMinor: String(row.amount_minor ?? '0'),
            currency: row.currency_min || state.operatingCurrency,
            lineCount: Number(row.line_count || 0),
        };
    }

    /** Pure conversion helper, exposed for importers and deterministic tests. */
    buildLineage(
        input: TransactionalMoneyInput,
        operatingCurrencyInput: string,
        now = new Date(),
    ): MoneyLineage {
        const normalized = this.normalizeTransactionalInput(input);
        const operatingCurrency = normalizeCurrencyCode(operatingCurrencyInput, '');
        const sourceAmount = BigInt(normalized.amountMinor);
        const sourceExponent = requireCurrencyMinorUnitExponent(normalized.currency);
        const operatingExponent = requireCurrencyMinorUnitExponent(operatingCurrency);
        let operatingAmount = sourceAmount;
        let fxSnapshot: FxSnapshot | null = null;

        if (normalized.currency !== operatingCurrency) {
            if (!normalized.fx) {
                throw new BadRequestException({
                    error: 'fx_snapshot_required',
                    message: `A ${normalized.currency}/${operatingCurrency} FX snapshot is required.`,
                });
            }
            if (
                normalized.fx.baseCurrency !== normalized.currency
                || normalized.fx.quoteCurrency !== operatingCurrency
            ) {
                throw new BadRequestException({
                    error: 'fx_pair_mismatch',
                    expected: `${normalized.currency}/${operatingCurrency}`,
                });
            }
            operatingAmount = this.multiplyDecimal(
                sourceAmount,
                normalized.fx.rate,
                sourceExponent,
                operatingExponent,
            );
            fxSnapshot = {
                ...normalized.fx,
                baseMinorUnitExponent: sourceExponent,
                quoteMinorUnitExponent: operatingExponent,
                capturedAt: now.toISOString(),
            };
        } else if (normalized.fx) {
            throw new BadRequestException({
                error: 'unnecessary_fx_snapshot',
                message: 'Do not attach an FX snapshot when no conversion occurred.',
            });
        }

        return {
            id: randomUUID(),
            objectType: normalized.objectType,
            objectId: normalized.objectId,
            lineId: normalized.lineId || null,
            sourceAmountMinor: sourceAmount.toString(),
            sourceCurrency: normalized.currency,
            operatingAmountMinor: operatingAmount.toString(),
            operatingCurrency,
            sourceSystem: normalized.sourceSystem,
            idempotencyKey: normalized.idempotencyKey,
            fxSnapshot,
        };
    }

    private normalizeTransactionalInput(input: TransactionalMoneyInput): TransactionalMoneyInput {
        if (!input || !SAFE_OBJECT_TYPE.test(input.objectType || '')) {
            throw new BadRequestException('objectType is invalid');
        }
        if (!input.objectId?.trim() || input.objectId.length > 200) {
            throw new BadRequestException('objectId is required and must be at most 200 characters');
        }
        if (input.lineId !== undefined && (!input.lineId.trim() || input.lineId.length > 200)) {
            throw new BadRequestException('lineId must be at most 200 characters');
        }
        if (!INTEGER_PATTERN.test(String(input.amountMinor))) {
            throw new BadRequestException('amountMinor must be an integer encoded as text');
        }
        if (!SAFE_SOURCE.test(input.sourceSystem || '')) {
            throw new BadRequestException('sourceSystem is invalid');
        }
        if (!input.idempotencyKey?.trim() || input.idempotencyKey.length > 200) {
            throw new BadRequestException('idempotencyKey is required and must be at most 200 characters');
        }

        const currency = normalizeCurrencyCode(input.currency, '');
        const fx = input.fx ? this.normalizeFx(input.fx) : undefined;
        return {
            ...input,
            objectId: input.objectId.trim(),
            lineId: input.lineId?.trim(),
            amountMinor: BigInt(input.amountMinor).toString(),
            currency,
            sourceSystem: input.sourceSystem.trim(),
            idempotencyKey: input.idempotencyKey.trim(),
            fx,
        };
    }

    private normalizeFx(input: FxSnapshotInput): FxSnapshotInput {
        const baseCurrency = normalizeCurrencyCode(input.baseCurrency, '');
        const quoteCurrency = normalizeCurrencyCode(input.quoteCurrency, '');
        if (baseCurrency === quoteCurrency) {
            throw new BadRequestException('FX base and quote currencies must differ');
        }
        if (typeof input.rate !== 'string' || !DECIMAL_PATTERN.test(input.rate) || BigInt(input.rate.replace('.', '')) <= 0n) {
            throw new BadRequestException('FX rate must be a positive decimal encoded as text');
        }
        if (!SAFE_SOURCE.test(input.source || '')) {
            throw new BadRequestException('FX source is invalid');
        }
        this.assertIsoInstant(input.observedAt, 'fx.observedAt');
        return {
            baseCurrency,
            quoteCurrency,
            rate: input.rate,
            source: input.source.trim(),
            observedAt: new Date(input.observedAt).toISOString(),
        };
    }

    /** Multiply integer minor units by a decimal with deterministic half-up rounding. */
    private multiplyDecimal(
        amount: bigint,
        rate: string,
        baseMinorUnitExponent: number,
        quoteMinorUnitExponent: number,
    ): bigint {
        const [whole, fraction = ''] = rate.split('.');
        const denominator = (10n ** BigInt(fraction.length))
            * (10n ** BigInt(baseMinorUnitExponent));
        const numerator = BigInt(`${whole}${fraction}`);
        const product = amount * numerator * (10n ** BigInt(quoteMinorUnitExponent));
        const sign = product < 0n ? -1n : 1n;
        const absolute = product < 0n ? -product : product;
        return sign * ((absolute + denominator / 2n) / denominator);
    }

    private lineageHash(lineage: MoneyLineage): string {
        const canonical = JSON.stringify({
            objectType: lineage.objectType,
            objectId: lineage.objectId,
            lineId: lineage.lineId,
            sourceAmountMinor: lineage.sourceAmountMinor,
            sourceCurrency: lineage.sourceCurrency,
            operatingAmountMinor: lineage.operatingAmountMinor,
            operatingCurrency: lineage.operatingCurrency,
            sourceSystem: lineage.sourceSystem,
            // capturedAt is an audit timestamp assigned by this service, not a
            // semantic part of the caller payload. Including it would make a
            // legitimate retry with the same idempotency key conflict merely
            // because it arrived a few milliseconds later.
            fxSnapshot: lineage.fxSnapshot ? {
                baseCurrency: lineage.fxSnapshot.baseCurrency,
                quoteCurrency: lineage.fxSnapshot.quoteCurrency,
                rate: lineage.fxSnapshot.rate,
                source: lineage.fxSnapshot.source,
                observedAt: lineage.fxSnapshot.observedAt,
                baseMinorUnitExponent: lineage.fxSnapshot.baseMinorUnitExponent,
                quoteMinorUnitExponent: lineage.fxSnapshot.quoteMinorUnitExponent,
            } : null,
        });
        return createHash('sha256').update(canonical).digest('hex');
    }

    private mapState(row: any): OperatingCurrencyState {
        return {
            tenantId: row.id,
            operatingCurrency: row.operating_currency || null,
            lockedAt: row.operating_currency_locked_at
                ? new Date(row.operating_currency_locked_at).toISOString()
                : null,
        };
    }

    private mapLineage(row: any): MoneyLineage {
        return {
            id: row.id,
            objectType: row.object_type,
            objectId: row.object_id,
            lineId: row.line_id || null,
            sourceAmountMinor: String(row.source_amount_minor),
            sourceCurrency: row.source_currency,
            operatingAmountMinor: String(row.operating_amount_minor),
            operatingCurrency: row.operating_currency,
            sourceSystem: row.source_system,
            idempotencyKey: row.idempotency_key,
            fxSnapshot: row.fx_snapshot || null,
        };
    }

    private assertUuid(value: string, field: string): void {
        if (!UUID_PATTERN.test(value || '')) throw new BadRequestException(`${field} must be a UUID`);
    }

    private assertIsoInstant(value: string, field: string): void {
        if (
            typeof value !== 'string'
            || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
            || Number.isNaN(Date.parse(value))
        ) {
            throw new BadRequestException(`${field} must be an ISO-8601 instant with Z or offset`);
        }
    }
}
