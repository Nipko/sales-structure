import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import {
    priceDeliveries, resolveWhatsAppRate, unitCeiling,
    wabaCalendarMonth, wabaLocalDate,
} from '../whatsapp-rates';
import {
    adoptReservation, claimReservation, ensureCounters, findReservation, grantFreeDeliveries,
    readExposure, recordAllocation, releaseReservation, reserveAgainstCounter, retainReservation,
    settleReservation, sweepExpiredLeases,
    type ReservationBinding, type ReservationIdentity, type ReservationRow, type SpendExposure,
    type SpendQuery,
} from './spend-ledger';
import { scopeId, scopesFor, type SpendScope } from './spend-scopes';
import { spendBlock, type SpendBlock } from './spend-diagnosis';

/**
 * ═══ THE ONE AUTHORITY THAT LETS A WHATSAPP MESSAGE COST MONEY ═══
 *
 * From 1 October 2026 Meta charges the business's own WhatsApp Business Account
 * per delivered service message. Parallly does not pay — it decides which of the
 * tenant's accounts does, and how much of that account's budget is committed
 * before the request leaves the process.
 *
 * The order is not negotiable and is the whole design:
 *
 *   identity → authorisation/cap → durable outbox → RESERVE → remote POST
 *   → receipt/state → settle or reconcile → history/telemetry
 *
 * Reserving AFTER the POST would mean the money is spent before anything counts
 * it. Reserving without the outbox row would mean a crash loses the record of
 * what was authorised. Both have the same shape of consequence: a bill nobody
 * predicted, discovered a month later.
 *
 * ── WHAT THIS SERVICE REFUSES TO DO ─────────────────────────────────────────
 *
 * It never releases on a timeout. It never guesses a rate, a currency, a payer
 * or a time zone. It never lets a retry resolve the connection again — a retry
 * adopts the reservation, including its uncertainty. And it never reports one
 * number for two currencies.
 */
@Injectable()
export class WhatsappSpendService {
    private readonly logger = new Logger(WhatsappSpendService.name);

    /**
     * How long a reservation may be held without an outcome.
     *
     * Long enough that a slow provider does not lose its own reservation, short
     * enough that a crashed worker's exposure becomes visible the same hour.
     */
    private readonly LEASE_SECONDS = 900;

    constructor(private readonly prisma: PrismaService) {}

    /**
     * The key an effect is claimed under, derived and never generated.
     *
     * A random id minted inside a failed attempt is not recomputable, so a retry
     * would mint a second one and double-spend — the same class of mistake as
     * the outbound `jobId` incident. Everything here comes from the effect
     * itself, so two attempts at the same effect produce the same key.
     *
     * Hex, so it can be reused as a BullMQ `jobId`, which rejects ':'.
     */
    effectKey(input: {
        readonly tenantId: string;
        readonly channelAccountId: string;
        readonly recipientRef: string;
        readonly category: string;
        readonly producer: string;
        readonly ordinal: number;
        readonly contentDigest: string;
    }): string {
        return createHash('sha256').update(joinForHash([
            input.tenantId, input.channelAccountId, input.recipientRef,
            input.category, input.producer, String(input.ordinal), input.contentDigest,
        ])).digest('hex');
    }

    /** A stable digest of what is being sent, without keeping what is being sent. */
    contentDigest(parts: readonly unknown[]): string {
        return createHash('sha256').update(joinForHash(parts.map(part =>
            typeof part === 'string' ? part : JSON.stringify(part ?? null))))
            .digest('hex').slice(0, 32);
    }

    /**
     * Everything the caller knows before a price exists.
     *
     * `deliveries` is how many chargeable messages this ONE effect is: normally
     * one, and more only where a provider counts a single call as several.
     */
    async authorize(schema: string, input: {
        readonly effectKey: string;
        readonly identity: Omit<ReservationIdentity, 'market' | 'currency' | 'rateVersion'
            | 'appliedLocalDate' | 'admissionReason'> & {
                readonly market?: string | null;
                readonly currency?: string | null;
            };
        readonly binding?: ReservationBinding;
        readonly contactId?: string | null;
        readonly taskId?: string | null;
        readonly deliveries: number;
        readonly wabaTimeZone?: string | null;
        readonly at?: Date;
        readonly admissionReason: string;
        /** Send at the declared ceiling when no rate can be resolved. */
        readonly allowUnknownCost?: boolean;
    }): Promise<SpendAuthorizeResult> {
        const at = input.at ?? new Date();

        // ── 1. Identity. Anything missing here is a refusal with a name. ─────
        const zone = String(input.wabaTimeZone ?? '').trim();
        if (!zone) {
            return blocked(spendBlock('timezone_missing',
                `account=${input.identity.channelAccountId}`));
        }
        const localDate = wabaLocalDate(at, zone);
        const allowanceMonth = wabaCalendarMonth(at, zone);
        if (!localDate || !allowanceMonth) {
            return blocked(spendBlock('timezone_missing', `zone=${zone}`));
        }
        if (input.identity.payerKind === 'unknown' || !input.identity.payerWabaId) {
            return blocked(spendBlock('payer_unknown',
                `account=${input.identity.channelAccountId}`));
        }
        const currency = String(input.identity.currency ?? '').trim().toUpperCase();
        if (!currency) {
            return blocked(spendBlock('currency_unknown',
                `account=${input.identity.channelAccountId}`));
        }

        // ── 2. Price. `unknown` is an outcome, not an error. ─────────────────
        const rate = resolveWhatsAppRate({
            category: input.identity.category as any,
            recipient: input.identity.market
                ? { kind: 'iso_alpha2', value: input.identity.market }
                : { kind: 'market_name', value: '' },
            currency, at, wabaTimeZone: zone,
        });
        if (rate.basis === 'unknown' && !input.allowUnknownCost) {
            return blocked(spendBlock('rate_unknown', `${rate.reason}:${rate.detail}`,
                { currency }));
        }

        const scopes = scopesFor({
            channelAccountId: input.identity.channelAccountId,
            payerWabaId: input.identity.payerWabaId,
            payerBusinessId: input.identity.payerBusinessId,
            contactId: input.contactId,
            taskId: input.taskId,
            allowanceMonth,
            spendPeriod: allowanceMonth,
        });

        return this.prisma.transactionInTenantSchema(schema, async query => {
            // ── 3. Adopt, never re-resolve. ─────────────────────────────────
            const existing = await findReservation(query as SpendQuery, schema, input.effectKey);
            if (existing) {
                const adopted = await adoptReservation(query as SpendQuery, schema,
                    input.effectKey, this.LEASE_SECONDS);
                this.logger.log(`[Spend] adopting ${input.effectKey.slice(0, 12)} in state `
                    + `${adopted?.state ?? existing.state}; not reserving twice`);
                return { outcome: 'adopted' as const, reservation: adopted ?? existing };
            }

            await ensureCounters(query as SpendQuery, schema, scopes, currency);

            // ── 4. The free split, decided inside the statement. ────────────
            const allowanceScope = scopes.find(scope => scope.kind === 'number_month');
            const freeGranted = allowanceScope
                ? await grantFreeDeliveries(query as SpendQuery, schema, allowanceScope, input.deliveries)
                : 0;
            const chargeable = Math.max(0, input.deliveries - freeGranted);

            // ── 5. What the chargeable half costs. ──────────────────────────
            const priced = rate.basis === 'priced'
                ? priceDeliveries(rate.rate, chargeable) : null;
            const ceiling = rate.basis === 'priced' ? unitCeiling(rate.rate) : null;
            const reservedMinor = priced?.kind === 'priced' ? priced.money.minor : 0;
            const unitCeilingMinor = ceiling?.minor ?? 0;
            const exactMicros = priced?.kind === 'priced' ? priced.exactMicros : 0;

            const identity: ReservationIdentity = {
                ...input.identity,
                market: rate.basis === 'priced' ? rate.market : (input.identity.market ?? null),
                currency,
                rateVersion: rate.basis === 'priced' ? rate.rateVersion : rate.rateVersion,
                appliedLocalDate: localDate,
                admissionReason: input.admissionReason,
            } as ReservationIdentity;

            // ── 6. Reserve against every ceiling, in the one lock order. ────
            const allocations: { scope: SpendScope; amountMinor: number; deliveries: number }[] = [];
            for (const scope of scopes) {
                if (scope.kind === 'number_month') continue; // already granted above
                const entry = { scope, amountMinor: reservedMinor, deliveries: chargeable };
                const allowed = await reserveAgainstCounter(query as SpendQuery, schema, entry);
                if (!allowed) {
                    // Rolled back by the caller's transaction. Nothing was sent
                    // and nothing was charged; the operator gets the scope that
                    // said no rather than a generic failure.
                    const code = scope.kind === 'task' ? 'task_budget_exhausted' : 'cap_exhausted';
                    throw new SpendRefused(spendBlock(code, scopeId(scope),
                        { avoidedMinor: reservedMinor, currency }));
                }
                allocations.push(entry);
            }

            const reservation = await claimReservation(query as SpendQuery, schema, {
                effectKey: input.effectKey,
                identity,
                money: {
                    basis: rate.basis === 'priced'
                        ? (chargeable === 0 ? 'free_allowance' : 'priced')
                        : 'unknown',
                    decision: rate.basis === 'priced' ? 'accepted' : 'unknown',
                    reservedMinor, unitCeilingMinor, exactMicros,
                    freeDeliveries: freeGranted, chargedDeliveries: chargeable,
                },
                binding: input.binding,
                leaseSeconds: this.LEASE_SECONDS,
            });
            if (!reservation) {
                // Somebody claimed it between our read and our insert. Adopt.
                const adopted = await adoptReservation(query as SpendQuery, schema,
                    input.effectKey, this.LEASE_SECONDS);
                return { outcome: 'adopted' as const, reservation: adopted! };
            }
            for (const entry of allocations) {
                await recordAllocation(query as SpendQuery, schema, reservation.id, entry, currency);
            }
            return { outcome: 'reserved' as const, reservation };
        }).catch((error: unknown) => {
            if (error instanceof SpendRefused) return blocked(error.block);
            throw error;
        });
    }

    /**
     * What the provider said, turned into the only state it justifies.
     *
     * The mapping is the table from `RESERVATION-DESIGN.md` §4, and the one rule
     * it exists to enforce is that a timeout NEVER releases.
     */
    async recordOutcome(schema: string, effectKey: string, outcome: {
        readonly kind: 'delivered_priced' | 'delivered_unpriced' | 'rejected' | 'timeout';
        readonly providerMessageId?: string | null;
        readonly chargedMinor?: number | null;
        readonly errorCode?: string | null;
    }): Promise<ReservationRow | null> {
        return this.prisma.transactionInTenantSchema(schema, async query => {
            switch (outcome.kind) {
                case 'delivered_priced':
                    return settleReservation(query as SpendQuery, schema, {
                        effectKey, chargedMinor: outcome.chargedMinor ?? 0,
                        evidence: 'provider_reported_price',
                        providerMessageId: outcome.providerMessageId, remoteState: 'delivered',
                    });
                case 'delivered_unpriced':
                    // It arrived and we do not know what it cost. The whole
                    // amount stays counted until a reconciliation says otherwise.
                    return retainReservation(query as SpendQuery, schema, {
                        effectKey, state: 'pending_reconciliation',
                        reason: 'delivered_without_price',
                        providerMessageId: outcome.providerMessageId, remoteState: 'delivered',
                    });
                case 'rejected':
                    // The only positive negative: an explicit refusal with no
                    // message id. Nothing left, so nothing is owed.
                    return releaseReservation(query as SpendQuery, schema, {
                        effectKey, evidence: 'provider_rejected_without_message_id',
                        reason: outcome.errorCode ?? null, remoteState: 'rejected',
                    });
                case 'timeout':
                default:
                    // A timeout with a message id in hand is "it arrived, price
                    // unknown"; without one it is "we cannot say whether it
                    // arrived". Neither releases.
                    return retainReservation(query as SpendQuery, schema, {
                        effectKey,
                        state: outcome.providerMessageId ? 'pending_reconciliation' : 'indeterminate',
                        reason: outcome.providerMessageId
                            ? 'timeout_with_message_id' : 'timeout_without_message_id',
                        providerMessageId: outcome.providerMessageId, remoteState: 'unknown',
                    });
            }
        });
    }

    /** Expired leases become visible exposure, never a quiet release. */
    async sweep(schema: string, limit = 200): Promise<readonly string[]> {
        const swept = await this.prisma.transactionInTenantSchema(schema,
            query => sweepExpiredLeases(query as SpendQuery, schema, limit));
        if (swept.length) {
            this.logger.warn(`[Spend] ${swept.length} reservation(s) in ${schema} outlived their lease `
                + 'and are now indeterminate: the money stays counted until somebody reconciles it.');
        }
        return swept;
    }

    /** Reserved, settled, retained, released and free — per currency, never summed. */
    async exposure(schema: string, input: {
        channelAccountId?: string | null; payerWabaId?: string | null; since: Date;
    }): Promise<readonly SpendExposure[]> {
        return this.prisma.transactionInTenantSchema(schema,
            query => readExposure(query as SpendQuery, schema, input));
    }
}

/**
 * Join parts for hashing so no separator can ever be ambiguous — or invisible.
 *
 * Each part is length-prefixed, which is why there is no separator character at
 * all. Two reasons, and the second is not hypothetical:
 *
 *   · A delimiter that can appear inside a part makes two different effects
 *     collide: `("ab","c")` and `("a","bc")` hash the same under any plain join,
 *     and colliding effect keys mean one message adopting another's reservation.
 *   · A delimiter is one character in a source file, and this codebase has
 *     already shipped a hash whose separator was silently a NUL byte instead of
 *     a space — nineteen tests passed and an independent recomputation is what
 *     found it. A length prefix cannot be corrupted invisibly: change it and the
 *     numbers stop matching.
 */
export function joinForHash(parts: readonly string[]): string {
    return parts.map(part => `${part.length}#${part}`).join('');
}

/** A cap said no. Carried as a throw so the transaction rolls back with it. */
class SpendRefused extends Error {
    constructor(readonly block: SpendBlock) { super(block.code); }
}

export type SpendAuthorizeResult =
    | { readonly outcome: 'reserved'; readonly reservation: ReservationRow }
    | { readonly outcome: 'adopted'; readonly reservation: ReservationRow }
    | { readonly outcome: 'blocked'; readonly block: SpendBlock };

const blocked = (block: SpendBlock): SpendAuthorizeResult =>
    Object.freeze({ outcome: 'blocked' as const, block });

/** Did this authorisation permit a remote call? */
export function mayTransmit(result: SpendAuthorizeResult): boolean {
    return result.outcome !== 'blocked' && result.reservation.state === 'held';
}
