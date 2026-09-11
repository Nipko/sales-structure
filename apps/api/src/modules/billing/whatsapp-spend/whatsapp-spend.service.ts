import { Injectable, Logger, Optional } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import {
    highestRatePerMessage, priceDeliveries, resolveWhatsAppRate, unitCeiling,
    wabaCalendarMonth, wabaLocalDate, WHATSAPP_RATE_TABLE_VERSION,
} from '../whatsapp-rates';
import {
    abandonExhaustedReceipts, adoptReservation, claimReservation, claimTransmission,
    declareTaskBudget, ensureCounters,
    holdUnassociatedReceipt,
    markReceiptApplied, noteReceiptFailure, pendingReceipts, rememberReceipt,
    findReservation, findReservationByProviderMessage, grantFreeDeliveries,
    estimateDeliveredEffects,
    markTransmissionInFlight, ownEffect, RESOLVABLE_STATES,
    settleFromProviderEvidence, staleAcceptedEffects, staleIndeterminateEffects,
    recentIdenticalDeliveries, releaseTransmission, sweepTransmissionLeases,
    readExposure, readPressure, readSpendSignals, recordAllocation, releaseReservation,
    reserveAgainstCounter, retainReservation, returnFreeDeliveries,
    settleReservation, sweepExpiredLeases,
    worstPressure,
    type DurableReceipt, type ProviderInvoiceLine, type ReceiptInboxStatus,
    type ReservationBinding, type ReservationIdentity, type ReservationRow, type SpendExposure,
    type SpendDisposition, type SpendPressure, type SpendQuery, type TaskBudget,
    type TransmissionClaim, type TransmissionGrant,
} from './spend-ledger';
import { scopeId, scopesFor, type SpendScope } from './spend-scopes';
import { consumesFreeAllowance, freeAllowanceFor } from './free-allowance';
import { spendBlock, type SpendBlock } from './spend-diagnosis';
import { AccountPauseStore } from '../../channels/account-pause-store';
import { fundingSignalFrom } from '../../channels/meta-funding-signals';
import {
    DEFAULT_REPETITION_POLICY, describeRepetition, judgeRepetition,
    type RepetitionPolicy,
} from './spend-repetition';

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

    constructor(
        private readonly prisma: PrismaService,
        /**
         * The OTHER economic consequence of a receipt.
         *
         * `131042` arriving on a status webhook means the business account
         * cannot be billed, and the correct answer is to stop sending from that
         * number rather than retry it forever. It is optional only so the
         * PostgreSQL suites can build this service without the channel graph;
         * in the running application it is always injected, and a receipt whose
         * pause could not be written stays in the inbox instead of being
         * marked applied.
         */
        @Optional() private readonly pauses?: AccountPauseStore,
    ) {}

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
        /**
         * The durable identity of the LOGICAL effect, when one exists.
         *
         * Without it the key is a hash of who, what and how — and two different
         * campaigns sending the same approved template to the same customer
         * from the same number produce the SAME key. The second one then adopts
         * the first one's reservation and sends on a permission that was never
         * granted to it; and if the first one settled, the second carries a
         * charge that belongs to a different campaign.
         *
         * A dispatch item, a batch position, a campaign-and-recipient pair or
         * the inbound message being answered: any of them is durable, survives
         * a restart, and is recomputable by a retry — which is what makes a
         * retry find its OWN row instead of minting a second one.
         */
        readonly logicalEffectId?: string | null;
    }): string {
        return createHash('sha256').update(joinForHash([
            input.tenantId, input.channelAccountId, input.recipientRef,
            input.category, input.producer, String(input.ordinal), input.contentDigest,
            // Empty when there is none, which keeps every existing effect's key
            // exactly where it was: a deploy must not orphan the reservations
            // in flight when it lands.
            String(input.logicalEffectId ?? ''),
        ])).digest('hex');
    }

    /**
     * The durable identity of an effect, from whatever the producer has.
     *
     * Ordered by how specific each one is. A dispatch item names one row in the
     * outbox; a batch and an index name one position in one batch; a task and a
     * recipient name one intended message in one campaign; an inbound message
     * and an ordinal name the nth reply to one customer message.
     *
     * Returns null when the producer has nothing durable at all, and that is
     * not a failure: the key then falls back to the content, which is what a
     * one-off proactive message actually is.
     */
    static logicalEffectId(binding: {
        dispatchItemId?: string | null; batchId?: string | null; itemIndex?: number | null;
        inboundMessageId?: string | null; taskId?: string | null; recipientRef?: string | null;
        ordinal?: number | null; messageId?: string | null; jobId?: string | null;
        requestId?: string | null;
    } | null | undefined): string | null {
        if (!binding) return null;
        if (binding.dispatchItemId) return `dispatch:${binding.dispatchItemId}`;
        if (binding.batchId && binding.itemIndex !== null && binding.itemIndex !== undefined) {
            return `batch:${binding.batchId}:${binding.itemIndex}`;
        }
        // A persisted outbound message row. Written BEFORE the send, so a
        // retry reads the same id even when the body was re-rendered in
        // between — which a content digest could not survive.
        if (binding.messageId) return `message:${binding.messageId}`;
        if (binding.taskId && binding.recipientRef) {
            return `task:${binding.taskId}:${binding.recipientRef}:${binding.ordinal ?? 0}`;
        }
        if (binding.inboundMessageId) {
            return `inbound:${binding.inboundMessageId}:${binding.ordinal ?? 0}`;
        }
        // A durable queue job. Its id is assigned once and every attempt of
        // that job sees the same one, which is exactly the property a retry
        // needs; it is weaker than a row only because a queue can be flushed.
        if (binding.jobId) return `job:${binding.jobId}`;
        // A synchronous one-off: an operator pressing send. It has no earlier
        // row to point at, so the call mints its own id and the reservation is
        // where it becomes durable. Deliberately NOT content-derived — two
        // deliberate presses are two messages, not one repeated.
        if (binding.requestId) return `request:${binding.requestId}`;
        return null;
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
        /**
         * Did WE start this exchange, or did the customer?
         *
         * Only the producer knows, and only the producer may say: inferring it
         * from the content would be deciding that a person asking for help is a
         * marketing blast. Defaults to `proactive` — the reading that spends
         * less — precisely because a caller that has not thought about it should
         * not be handed the permissive answer.
         */
        readonly disposition?: SpendDisposition;
        /**
         * What is being said, as a digest — the same value that went into the
         * effect key. Kept separately because the effect key also hashes the
         * producer and the ordinal, so it can recognise a RETRY of one effect
         * and cannot recognise the same sentence arriving by another road.
         */
        readonly contentDigest?: string | null;
        /** How often an identical message may be repeated. */
        readonly repetition?: RepetitionPolicy;
        /** Send at the declared ceiling when no rate can be resolved. */
        readonly allowUnknownCost?: boolean;
        /**
         * Refuse to price at all, whatever the rate card would say.
         *
         * Not the same as `allowUnknownCost`, and conflating them was a defect:
         * that flag permits an unknown rate, it does not PRODUCE one. With a
         * substituted currency and a real market and category, the resolver
         * found a genuine row and returned `basis: 'priced'` — an exact amount,
         * in money nobody established, reading as authoritative.
         *
         * This is structural. When the currency or the category could not be
         * established, there is no price to be had and the reservation carries
         * `basis: 'unknown'` with the ceiling as its exposure.
         */
        readonly costUnknowable?: { readonly reason: string } | null;
        /**
         * This number's own free monthly allowance, when Meta gave the business
         * a figure other than the published one. Absent means the published
         * one, never zero — a default of zero would charge from the first
         * message and look exactly like working correctly.
         */
        readonly freeAllowance?: number | null;
        /**
         * May this effect draw on the free allowance at all?
         *
         * Asked of the caller rather than read off `identity.category`, because
         * that field carries `service` for a message NOBODY could classify —
         * the ledger column is constrained and `service` is what fits. Reading
         * the allowance off it would hand out a free message on a guess, and
         * the guess is wrong precisely when a utility template went out.
         */
        readonly freeAllowanceEligible?: boolean;
        /**
         * Whether a CEILING may stop this effect.
         *
         * `observe` does not mean "do less bookkeeping". It means the tenant
         * has not turned enforcement on, so a ceiling that would have refused
         * records what it would have stopped and lets the message go. The
         * reservation, the identity, the allocation and the transmission right
         * all still happen — without them a chargeable POST has no exposure and
         * nothing for a receipt to resolve, which is the one state nobody can
         * recover from.
         *
         * Defaults to `enforce`: a caller that has not thought about it gets
         * the answer that spends less.
         */
        readonly caps?: SpendEnforcementMode;
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
        //
        // And sometimes it is the ONLY honest outcome. A currency or a category
        // that could not be established makes the rate card inapplicable, not
        // merely hard to read: asking it anyway returns a real row for the money
        // we substituted, which is a confident wrong answer.
        const rate = input.costUnknowable ? unpriceable(input.costUnknowable.reason, at, zone)
            : resolveWhatsAppRate({
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
            // ── 3. Own the effect BEFORE any money moves. ───────────────────
            //
            // The read and the lock are one act. Previously this path granted
            // the free allowance and incremented every ceiling first and claimed
            // the unique row last, so two authorisations of the SAME effect
            // could both move money and only one could hold allocations to give
            // it back. The loser committed increments nothing could reverse.
            //
            // Now the loser blocks until the winner commits, then SEES the row,
            // and adopts without reaching a counter at all.
            const ownership = await ownEffect(query as SpendQuery, schema, input.effectKey);
            const existing = ownership.existing;
            if (existing) {
                const adopted = await adoptReservation(query as SpendQuery, schema,
                    input.effectKey, this.LEASE_SECONDS);
                this.logger.log(`[Spend] adopting ${input.effectKey.slice(0, 12)} in state `
                    + `${adopted?.state ?? existing.state}; not reserving twice`);
                // Nothing is added here — the amount was counted by the attempt
                // being adopted — but the caller is still owed an honest reading
                // of how full the ceiling is. Answering `clear` because this
                // path reserved nothing would report a full account as empty on
                // every single retry.
                return {
                    outcome: 'adopted' as const, reservation: adopted ?? existing,
                    pressure: await readPressure(query as SpendQuery, schema, scopes),
                };
            }

            // ── 3b. Are we about to say the same thing to the same person? ──
            //
            // AFTER adoption and BEFORE reserving. After, because a retry of one
            // effect must find its own reservation rather than be refused as its
            // own duplicate. Before, because the whole point is to spend nothing.
            //
            // What is compared is a digest of what is being sent — never the
            // customer's words. A complaint, a person insisting, somebody asking
            // for a human: all indistinguishable from any other message here, so
            // none of them can become a reason to stop answering.
            const repetition = input.repetition ?? DEFAULT_REPETITION_POLICY;
            if (input.contentDigest) {
                const identical = await recentIdenticalDeliveries(query as SpendQuery, schema, {
                    channelAccountId: input.identity.channelAccountId,
                    recipientRef: input.identity.recipientRef,
                    contentDigest: input.contentDigest,
                    since: new Date(at.getTime() - repetition.windowMs),
                });
                const verdict = judgeRepetition(identical, repetition, at);
                if (!verdict.allowed) {
                    throw new SpendRefused(spendBlock('duplicate_recent_send',
                        describeRepetition(verdict), { currency }));
                }
            }

            // ── 4. The free allowance, seeded and then spent. ───────────────
            //
            // Only a SERVICE message draws on it. Utility templates inside the
            // 24-hour window became chargeable in the same Meta update and
            // explicitly do not consume this quota; marketing and
            // authentication never did. Letting a utility template eat a free
            // service message makes the business pay twice — once for the
            // template, and once for the service reply that no longer had a
            // free slot. A category nobody could classify is NOT eligible:
            // handing out an allowance on a guess is the same mistake.
            const eligible = input.freeAllowanceEligible
                ?? consumesFreeAllowance(input.identity.category);
            await ensureCounters(query as SpendQuery, schema, scopes, currency,
                freeAllowanceFor(input.freeAllowance));

            const allowanceScope = scopes.find(scope => scope.kind === 'number_month');
            const freeGranted = allowanceScope && eligible
                ? await grantFreeDeliveries(query as SpendQuery, schema, allowanceScope, input.deliveries)
                : 0;
            const chargeable = Math.max(0, input.deliveries - freeGranted);

            // ── 5. What the chargeable half costs. ──────────────────────────
            const priced = rate.basis === 'priced'
                ? priceDeliveries(rate.rate, chargeable) : null;
            const ceiling = rate.basis === 'priced' ? unitCeiling(rate.rate) : null;

            // ── WHAT AN UNPRICEABLE EFFECT STILL RESERVES ───────────────────
            //
            // Not zero. Zero is the one answer that is certainly wrong — the
            // message WILL be billed — and it made the exposure report show an
            // empty month for an account that was spending.
            //
            // The highest price the current card prints for this currency is a
            // DERIVED upper bound, not an invented estimate: the card itself
            // says nothing in it costs more. The reservation still carries
            // `basis: 'unknown'`, so nothing reads it as a price, and
            // reconciliation settles it against what Meta actually billed.
            //
            // Deliberately pessimistic. Under a ceiling, stopping too early is
            // recoverable by raising the ceiling; overspending is not.
            const unknownBound = rate.basis === 'priced'
                ? null : highestRatePerMessage(currency);
            const reservedMinor = priced?.kind === 'priced'
                ? priced.money.minor
                : (unknownBound ? unknownBound.minor * chargeable : 0);
            const unitCeilingMinor = ceiling?.minor ?? unknownBound?.minor ?? 0;
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
            const disposition = input.disposition ?? 'proactive';
            const allocations: {
                scope: SpendScope; amountMinor: number; deliveries: number; currency: string;
            }[] = [];
            const pressures: SpendPressure[] = [];
            /** Ceilings that refused while nobody was enforcing them. */
            const observed: SpendBlock[] = [];
            // ── THE ALLOWANCE IS A PROVISIONAL ALLOCATION, NOT A SPEND ──────
            //
            // Its slots were taken above, before the POST. They have to be able
            // to come back — Meta charges the allowance on DELIVERY, so a
            // thousand failures must not exhaust a thousand free messages — and
            // the only road back is an allocation row saying what this
            // reservation is holding on that counter. Without one the grant was
            // a one-way door: the `number_month` scope skipped this loop, so
            // `applyToCounters` had nothing to give back.
            //
            // No money on it: the free half costs nothing by definition.
            if (allowanceScope && freeGranted > 0) {
                allocations.push({
                    scope: allowanceScope, amountMinor: 0,
                    deliveries: freeGranted, currency,
                });
            }
            for (const scope of scopes) {
                if (scope.kind === 'number_month') continue; // already granted above
                const entry = {
                    scope, amountMinor: reservedMinor, deliveries: chargeable, currency,
                };
                const observing = (input.caps ?? 'enforce') === 'observe';
                const outcome = await reserveAgainstCounter(query as SpendQuery, schema,
                    { ...entry, disposition, overCap: observing });
                if (outcome.overCap) {
                    // Counted over the ceiling, and named. The caller reports
                    // it as what enforcement WOULD have stopped, which is the
                    // entire product of an observation.
                    observed.push(spendBlock(
                        scope.kind === 'task' ? 'task_budget_exhausted' : 'cap_exhausted',
                        scopeId(scope), { avoidedMinor: reservedMinor, currency }));
                }
                if (!outcome.ok) {
                    if (outcome.refusal === 'currency') {
                        // NOT a ceiling. The counter is keeping its numbers in
                        // one currency and this reservation is denominated in
                        // another, so adding them would be arithmetic on two
                        // different things — off by a factor of four thousand
                        // between COP centavos and US cents, in the direction
                        // that makes a ceiling look full. No budget fixes it and
                        // no retry gets past it: somebody has to decide which
                        // currency the period is in.
                        throw new SpendRefused(spendBlock('counter_currency_mismatch',
                            `${scopeId(scope)} keeps ${outcome.counterCurrency}, `
                            + `this effect is ${currency}`,
                            { avoidedMinor: reservedMinor, currency }));
                    }
                    // Rolled back by the caller's transaction. Nothing was sent
                    // and nothing was charged; the operator gets the scope that
                    // said no, at the height that said it, rather than a generic
                    // failure. `soft_stop` and `hard_stop` are different human
                    // tasks: one is "your campaign is paused, the replies still
                    // work", the other is "nothing is going out".
                    const code = outcome.pressure === 'soft_stop'
                        ? 'cap_soft_stop'
                        : (scope.kind === 'task' ? 'task_budget_exhausted' : 'cap_exhausted');
                    throw new SpendRefused(spendBlock(code, scopeId(scope),
                        { avoidedMinor: reservedMinor, currency }));
                }
                pressures.push(outcome.pressure);
                allocations.push(entry);
            }
            // One number for the whole effect: the fullest scope decides, because
            // a tenant with room on the account and none on the contact is not
            // "mostly fine".
            const pressure = worstPressure(pressures);

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
                contentDigest: input.contentDigest ?? null,
                disposition,
                leaseSeconds: this.LEASE_SECONDS,
            });
            if (!reservation) {
                // Somebody claimed it between our read and our insert. Adopt —
                // and give back the free slots this attempt took, because the
                // reservation being adopted already holds its own. Without this
                // a retry storm on one effect eats the month's allowance a
                // slot at a time while every attempt reports "adopted".
                if (allowanceScope && freeGranted > 0) {
                    await returnFreeDeliveries(query as SpendQuery, schema,
                        allowanceScope, freeGranted);
                }
                const adopted = await adoptReservation(query as SpendQuery, schema,
                    input.effectKey, this.LEASE_SECONDS);
                return { outcome: 'adopted' as const, reservation: adopted!, pressure };
            }
            for (const entry of allocations) {
                await recordAllocation(query as SpendQuery, schema, reservation.id, entry, currency);
            }
            return {
                outcome: 'reserved' as const, reservation, pressure,
                // Present only when a ceiling was crossed with enforcement off.
                // The effect is fully accounted for; this says what would have
                // stopped it.
                observedBlock: observed[0] ?? null,
            };
        }).catch((error: unknown) => {
            if (error instanceof SpendRefused) return blocked(error.block);
            throw error;
        });
    }

    /**
     * Declare a proactive batch's ceiling before a single job is enqueued.
     *
     * Order matters and is the whole point: the budget is COMMITTED before the
     * fanout, so by the time ten workers are running there is already a row for
     * them to contend on. Declaring it afterwards — or checking it in
     * application code — leaves a window in which the batch is unbounded, and a
     * window in a spending limit is the same as no limit.
     *
     * Returns the ceiling that now stands, so the caller can say what it is.
     */
    async budgetTask(schema: string, input: {
        readonly taskId: string;
        readonly period: string;
        readonly deliveries?: number;
        readonly capMinor?: number | null;
        readonly currency?: string | null;
        readonly warnPermille?: number;
        readonly softPermille?: number;
    }): Promise<TaskBudget> {
        return this.prisma.transactionInTenantSchema(schema, async query =>
            declareTaskBudget(query as SpendQuery, schema, {
                ...input,
                // The currency is only meaningful on a money ceiling; a delivery
                // ceiling counts messages, which no currency changes.
                currency: String(input.currency ?? 'USD').toUpperCase(),
            }));
    }

    /**
     * Where this month's money went, as facts about what the platform did.
     *
     * Reads only. Nothing here blocks anything and nothing here is a judgement
     * about a person: "twenty messages to somebody who never wrote back" is a
     * count of OUR sends, and the platform is deliberately incapable of turning
     * it into a statement about that customer.
     */
    /**
     * Is there already a reservation under this key? A plain read, no lock.
     *
     * Used for exactly one thing: recognising an effect that was authorised
     * before durable identities became mandatory, so a deploy does not orphan
     * the reservations in flight when it lands. It is not an ownership test —
     * `authorize` still takes the advisory lock — and nothing may send on the
     * strength of what it returns.
     */
    async reservationFor(schema: string, effectKey: string) {
        return this.prisma.transactionInTenantSchema(schema, async query =>
            findReservation(query as SpendQuery, schema, effectKey));
    }

    async signals(schema: string, input: {
        readonly since: Date;
        readonly channelAccountId?: string | null;
        readonly limit?: number;
    }) {
        return this.prisma.transactionInTenantSchema(schema, async query =>
            readSpendSignals(query as SpendQuery, schema, input));
    }

    /**
     * Take the exclusive right to POST an effect that is already reserved.
     *
     * Separate from `authorize()` on purpose. Authorising is about money and
     * happens once per effect; transmitting is about who sends it and happens
     * once per ATTEMPT. Folding them together is what let two concurrent
     * authorisations of one effect both be told to send.
     */
    async claimTransmission(schema: string, effectKey: string,
        leaseSeconds = this.LEASE_SECONDS): Promise<TransmissionClaim> {
        return this.prisma.transactionInTenantSchema(schema, async query =>
            claimTransmission(query as SpendQuery, schema, { effectKey, leaseSeconds }));
    }

    /**
     * Say, durably, that the request is about to begin.
     *
     * The one line that separates "provably sent nothing" from "nobody knows".
     * A false return means the right was taken away — send nothing.
     */
    async markInFlight(schema: string, grant: TransmissionGrant): Promise<boolean> {
        return this.prisma.transactionInTenantSchema(schema, async query =>
            markTransmissionInFlight(query as SpendQuery, schema, grant));
    }

    /** Hand the right back without sending. Only possible before the request begins. */
    async abandonTransmission(schema: string, grant: TransmissionGrant): Promise<boolean> {
        return this.prisma.transactionInTenantSchema(schema, async query =>
            releaseTransmission(query as SpendQuery, schema, grant));
    }

    /**
     * Expired transmission rights, resolved by what they can prove.
     *
     * `claimed` returns to `idle` — provably nothing went out, and the customer
     * is still owed a message. `in_flight` becomes `indeterminate` — the request
     * had begun, and a blind retry is the duplicate.
     */
    async sweepTransmissions(schema: string, limit = 200) {
        return this.prisma.transactionInTenantSchema(schema, async query =>
            // The reservation lease is renewed with the transmission right. A
            // worker that died holding one almost certainly died holding both,
            // and recovering only the first meant the NEXT step of the same
            // maintenance pass expired the reservation and undid the recovery.
            sweepTransmissionLeases(query as SpendQuery, schema, limit, this.LEASE_SECONDS));
    }

    /**
     * What the provider said, turned into the only state it justifies.
     *
     * The mapping is the table from `RESERVATION-DESIGN.md` §4, and the one rule
     * it exists to enforce is that a timeout NEVER releases.
     */
    async recordOutcome(schema: string, effectKey: string, outcome: {
        readonly kind: 'delivered_priced' | 'accepted' | 'rejected' | 'timeout';
        readonly providerMessageId?: string | null;
        readonly chargedMinor?: number | null;
        readonly errorCode?: string | null;
        /**
         * The transmission right the caller held.
         *
         * Required of anything that actually sent, so a worker whose lease
         * expired cannot overwrite the result of the attempt that replaced it.
         * Omitted by writers that did not transmit at all — a status webhook
         * arriving later, or the reconciler.
         */
        readonly transmitToken?: string | null;
    }): Promise<ReservationRow | null> {
        const transmitToken = outcome.transmitToken ?? null;
        return this.prisma.transactionInTenantSchema(schema, async query => {
            switch (outcome.kind) {
                case 'delivered_priced':
                    return settleReservation(query as SpendQuery, schema, {
                        effectKey, chargedMinor: outcome.chargedMinor ?? 0,
                        evidence: 'provider_reported_price',
                        providerMessageId: outcome.providerMessageId, remoteState: 'delivered',
                        transmitToken,
                    });
                case 'accepted':
                    // ═══ A WAMID IS AN ACCEPTANCE, NOT A DELIVERY ═══
                    //
                    // This case used to be called `delivered_unpriced` and it
                    // wrote `remote_state='delivered'`. It was not a delivery:
                    // the POST's answer says Meta HAS the message and will try.
                    // The charge lands on delivery, so a row that claimed to be
                    // delivered was then settled by the reconciler at the
                    // reserved amount 72 hours later — and a message Meta
                    // accepted and never delivered appeared in the books as a
                    // confirmed charge.
                    //
                    // The exposure is retained, because the money may still be
                    // spent. Nothing else is asserted.
                    return retainReservation(query as SpendQuery, schema, {
                        effectKey, state: 'accepted',
                        reason: 'provider_accepted_awaiting_delivery',
                        providerMessageId: outcome.providerMessageId, remoteState: 'accepted',
                        transmitToken,
                    });
                case 'rejected':
                    // The only positive negative: an explicit refusal with no
                    // message id. Nothing left, so nothing is owed.
                    return releaseReservation(query as SpendQuery, schema, {
                        effectKey, evidence: 'provider_rejected_without_message_id',
                        reason: outcome.errorCode ?? null, remoteState: 'rejected',
                        transmitToken,
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
                        transmitToken,
                    });
            }
        });
    }

    /**
     * What a provider receipt does to the money, minutes after the send.
     *
     * ═══ ACCEPTED IS NOT DELIVERED, AND DELIVERED IS WHAT META BILLS ═══
     *
     * The POST answers with a wamid and nothing else. That is an ACCEPTANCE:
     * Meta has the message and will try to deliver it. From October 2026 the
     * charge lands on DELIVERY, so the send path can only ever leave the effect
     * counted-but-unresolved, and something later has to say what became of it.
     * That something is this: the status webhook, arriving seconds or minutes
     * afterwards, carrying the one fact nobody else has.
     *
     * Without it every reservation stayed on the books for ever, every ceiling
     * filled up with messages that had long since arrived or failed, and the
     * exposure report showed a month of held money for an account that had
     * settled its bill.
     *
     * ── WHAT EACH RECEIPT MEANS ─────────────────────────────────────────────
     *
     *   `sent`       Meta has it. Nothing is decided; the row stays as it is.
     *   `delivered`  It reached the phone. Meta bills it, so the effect settles.
     *   `read`       Also delivered — and it can arrive FIRST, out of order, so
     *                it settles the same way rather than being ignored.
     *   `failed`     It never arrived. Meta does not bill an undelivered
     *                message, so the whole reservation goes back.
     *
     * ── WHY A SECOND RECEIPT CHANGES NOTHING ────────────────────────────────
     *
     * Meta redelivers webhooks, and it may send `delivered` then `read` for the
     * same message. Both are handled by the state, not by a dedupe table: once
     * a row is `settled` or `released` its money has moved, and the writers
     * refuse those states outright. A duplicate is a no-op rather than a second
     * charge, and it is a no-op even if the events arrive in either order, on
     * two workers, at the same moment.
     */
    async applyDeliveryReceipt(schema: string, receipt: {
        readonly providerMessageId: string;
        readonly status: 'sent' | 'delivered' | 'read' | 'failed';
        readonly errorCode?: string | null;
        /** Meta's own words, when the numeric code alone is generic. */
        readonly errorDetail?: string | null;
        /** Who owns the number, so a funding refusal can pause it. */
        readonly tenantId?: string | null;
        readonly channelAccountId?: string | null;
        /**
         * Meta's own `pricing` block, when the webhook carried one.
         *
         * `billable: false` is authoritative and is the only thing that can
         * settle a delivered message at zero: it is Meta saying THIS delivery
         * was inside the free allowance or a free entry point. Nothing else may
         * decide that, because everything else would be guessing.
         */
        readonly pricing?: { readonly billable?: boolean | null;
            readonly category?: string | null; readonly model?: string | null } | null;
    }): Promise<'settled' | 'released' | 'ignored' | 'unknown_receipt'> {
        // ── 1. THE FACT, DURABLE, BEFORE ANY CONSEQUENCE ────────────────────
        //
        // Its own committed statement. If this raises, nothing has been
        // recorded and nothing has been acted on: the caller owns a retryable
        // job and re-delivering the identical event costs nothing. If it
        // succeeds and the process dies on the next line, the sweep finds it.
        await this.prisma.transactionInTenantSchema(schema, query =>
            rememberReceipt(query as SpendQuery, schema, {
                providerMessageId: receipt.providerMessageId,
                status: receipt.status,
                tenantId: receipt.tenantId ?? null,
                channelAccountId: receipt.channelAccountId ?? null,
                errorCode: receipt.errorCode ?? null,
                errorDetail: receipt.errorDetail ?? null,
                pricing: receipt.pricing ?? null,
            }));

        // ── 2. AND THEN ITS CONSEQUENCES ────────────────────────────────────
        try {
            const outcome = await this.resolveReceipt(schema, receipt);
            await this.observeReceiptFunding(receipt);
            // ── "NOT OURS" AND "NOT OURS YET" ARE DIFFERENT ANSWERS ─────────
            //
            // Meta's `sent` webhook can arrive before the POST's own answer has
            // been committed: the round trip from Meta is not always slower
            // than the round trip to our own database. Filing that as
            // `unknown_receipt` — which is what happened — made it TERMINAL.
            // The `wamid` appeared a second later, and nothing ever came back
            // to resolve the reservation: the money stayed counted for ever for
            // a message that had been delivered, and the row said the receipt
            // had been applied.
            //
            // Held instead, with a backoff, until either the association
            // appears or enough time passes that it never will.
            if (outcome === 'unknown_receipt') {
                const held = await this.prisma.transactionInTenantSchema(schema, query =>
                    holdUnassociatedReceipt(query as SpendQuery, schema, receipt));
                if (held) {
                    this.logger.debug(`[Spend] receipt ${receipt.providerMessageId} names no `
                        + 'reservation yet; held for the sweep');
                }
                return outcome;
            }
            await this.prisma.transactionInTenantSchema(schema, query =>
                markReceiptApplied(query as SpendQuery, schema, receipt, outcome));
            return outcome;
        } catch (error: any) {
            // Left `pending`, with a backoff. Never swallowed into a log line:
            // that is precisely how a reservation stayed counted for ever.
            await this.prisma.transactionInTenantSchema(schema, query =>
                noteReceiptFailure(query as SpendQuery, schema, receipt,
                    String(error?.message ?? error))).catch(() => { /* the throw below is the signal */ });
            throw error;
        }
    }

    /**
     * Retry the receipts whose consequences never landed.
     *
     * Runs from the maintenance pass. Each receipt is replayed through the same
     * entry point that first tried it, so there is exactly one rule about what
     * a receipt means — and replaying a receipt that did land is a no-op,
     * because the reservation refuses to leave `settled` or `released`.
     */
    async retryPendingReceipts(schema: string, input: {
        readonly limit?: number; readonly at?: Date; readonly maxAttempts?: number;
    } = {}): Promise<{ retried: number; applied: number; abandoned: number }> {
        // Give up on the hopeless ones FIRST, so this pass does not spend its
        // budget re-attempting them and then decide they were hopeless. In the
        // other order a queue of exhausted receipts would crowd out the ones
        // that are merely late.
        const abandoned = await this.prisma.transactionInTenantSchema(schema, query =>
            abandonExhaustedReceipts(query as SpendQuery, schema, input));
        const due = await this.prisma.transactionInTenantSchema(schema, query =>
            pendingReceipts(query as SpendQuery, schema, input));
        let applied = 0;
        for (const pending of due) {
            try {
                await this.applyDeliveryReceipt(schema, {
                    providerMessageId: pending.providerMessageId,
                    status: pending.status,
                    errorCode: pending.errorCode ?? null,
                    errorDetail: pending.errorDetail ?? null,
                    tenantId: pending.tenantId ?? null,
                    channelAccountId: pending.channelAccountId ?? null,
                    pricing: (pending.pricing ?? null) as any,
                });
                applied += 1;
            } catch (error: any) {
                this.logger.warn(`[Spend] recibo ${pending.providerMessageId}/${pending.status} `
                    + `sigue sin aplicarse: ${error?.message}`);
            }
        }
        return { retried: due.length, applied, abandoned };
    }

    /**
     * The funding half of a receipt: Meta saying this account cannot be billed.
     *
     * Deliberately not swallowed. `observeFunding` never throws on its own, so
     * a failure to persist the pause would otherwise be invisible — and an
     * invisible failure here means the number keeps burning attempts against a
     * wall nobody can see. Raising leaves the receipt `pending` and the sweep
     * tries again.
     */
    private async observeReceiptFunding(receipt: {
        readonly status: string;
        readonly errorCode?: string | null;
        readonly errorDetail?: string | null;
        readonly tenantId?: string | null;
        readonly channelAccountId?: string | null;
    }): Promise<void> {
        if (receipt.status !== 'failed') return;
        if (!this.pauses || !receipt.tenantId || !receipt.channelAccountId) return;
        const signal = fundingSignalFrom({
            source: 'status_webhook', code: receipt.errorCode, detail: receipt.errorDetail,
        });
        if (!signal) return;
        const pause = await this.pauses.observeFunding(
            receipt.tenantId, receipt.channelAccountId,
            { source: 'status_webhook', code: receipt.errorCode, detail: receipt.errorDetail });
        if (!pause) throw new Error('funding_pause_not_recorded');
    }

    private async resolveReceipt(schema: string, receipt: {
        readonly providerMessageId: string;
        readonly status: 'sent' | 'delivered' | 'read' | 'failed';
        readonly errorCode?: string | null;
        readonly pricing?: { readonly billable?: boolean | null;
            readonly category?: string | null; readonly model?: string | null } | null;
    }): Promise<'settled' | 'released' | 'ignored' | 'unknown_receipt'> {
        return this.prisma.transactionInTenantSchema(schema, async query => {
            const row = await findReservationByProviderMessage(
                query as SpendQuery, schema, receipt.providerMessageId);
            // Not every WhatsApp message on the platform is one of ours: a
            // receipt for something sent before metering existed, or from
            // another tool on the same number, has no reservation and is not a
            // problem. Saying so is better than inventing one.
            if (!row) return 'unknown_receipt' as const;
            // Finished. A redelivered webhook, or `read` after `delivered`,
            // must not move money a second time.
            if (row.state === 'settled' || row.state === 'released') return 'ignored' as const;
            // Acceptance, which the send path already recorded. Nothing here.
            if (receipt.status === 'sent') return 'ignored' as const;

            if (receipt.status === 'failed') {
                const released = await releaseReservation(query as SpendQuery, schema, {
                    effectKey: row.effectKey,
                    evidence: 'provider_reported_failure',
                    reason: receipt.errorCode ?? 'delivery_failed',
                    remoteState: 'failed',
                    fromStates: RESOLVABLE_STATES,
                });
                return released ? 'released' as const : 'ignored' as const;
            }

            // Delivered — by that name or by `read`, which implies it.
            //
            // What it COST is a separate question from whether it arrived. Meta
            // says `billable: false` when the delivery was free; otherwise the
            // authority on the amount is the reservation's own price, and where
            // that price was never computable the effect stays pending until a
            // reconciliation against Meta's invoice resolves it.
            const free = receipt.pricing?.billable === false;
            if (!free && row.money.basis === 'unknown') {
                // It arrived and nobody can say what it cost. The exposure
                // stands, now marked as awaiting Meta's invoice rather than
                // awaiting a receipt. A row already in that state is left
                // alone — `retainReservation` only moves out of `held`.
                await retainReservation(query as SpendQuery, schema, {
                    effectKey: row.effectKey, state: 'pending_reconciliation',
                    reason: 'delivered_without_price', remoteState: receipt.status,
                    providerMessageId: receipt.providerMessageId,
                    // From wherever it was. An `accepted` row learning it was
                    // delivered is the normal case now, and the `held`-only
                    // default would refuse it by matching no rows — silently,
                    // which is how an effect sits unresolved for ever while
                    // every pass reports success.
                    fromStates: RESOLVABLE_STATES,
                });
                return 'ignored' as const;
            }
            const settled = await settleReservation(query as SpendQuery, schema, {
                effectKey: row.effectKey,
                chargedMinor: free ? 0 : row.money.reservedMinor,
                evidence: free ? 'provider_reported_free' : 'provider_reported_delivery',
                providerMessageId: receipt.providerMessageId,
                remoteState: receipt.status,
                fromStates: RESOLVABLE_STATES,
            });
            return settled ? 'settled' as const : 'ignored' as const;
        });
    }

    /**
     * ═══ THE RECONCILER, WHICH NO LONGER CHARGES ANYBODY ═══
     *
     * It used to settle a delivery whose price nobody could compute at the
     * reserved amount once 72 hours had passed, under the evidence string
     * `reconciled_at_reserved_amount`. That reads like an invoice and means
     * "the clock ran out" — and while an ACK was being recorded as a delivery,
     * it turned messages Meta accepted and never delivered into confirmed
     * charges that looked exactly like real ones.
     *
     * Now it states the honest thing instead: the bound becomes an ESTIMATE and
     * says so. The committed money is unchanged, so a ceiling still fills the
     * same way; what changes is that nothing appears in the BILL that no
     * authority stated. `settleFromInvoice` is the only road from an estimate
     * to a charge.
     *
     * Safe to run twice: `retainReservation` moves out of
     * `pending_reconciliation` and nothing else.
     */
    async reconcile(schema: string, input: {
        readonly graceHours?: number; readonly limit?: number; readonly at?: Date;
    } = {}): Promise<{
        estimated: number; estimatedMinor: number; needsPerson: number;
        /** Kept as a name so callers do not have to change; always 0 now. */
        settled: number; settledMinor: number;
    }> {
        const at = input.at ?? new Date();
        const olderThan = new Date(at.getTime() - (input.graceHours ?? 72) * 3_600_000);
        const estimated = await this.prisma.transactionInTenantSchema(schema, query =>
            estimateDeliveredEffects(query as SpendQuery, schema,
                { olderThan, limit: input.limit }));
        const stuck = await this.awaitingResolution(schema, { ...input, at });
        const estimatedMinor = estimated.reduce(
            (total, row) => total + row.money.reservedMinor, 0);
        if (estimated.length) {
            this.logger.log(`[Spend] ${estimated.length} delivered effect(s) in ${schema} have `
                + `no authoritative price and are now recorded as ESTIMATES at their upper `
                + `bound (${estimatedMinor} minor units). Nothing was charged.`);
        }
        if (stuck.length) {
            // Said at warning level and with a count, because the number is the
            // signal: one is a lost webhook, fifty is something systematic and
            // the money in them is real exposure nobody is watching.
            this.logger.warn(`[Spend] ${stuck.length} effect(s) in ${schema} are past the grace `
                + 'period with nobody able to say whether they were delivered. Waiting longer '
                + 'will not decide it.');
        }
        return {
            estimated: estimated.length, estimatedMinor, needsPerson: stuck.length,
            settled: 0, settledMinor: 0,
        };
    }

    /**
     * The effects waiting on a person, for the panel that shows them.
     *
     * Two states, both of them "nobody knows", reached by different roads:
     * `accepted` is a POST that succeeded and whose status webhook never came;
     * `indeterminate` is a POST whose own outcome is unknown. Returned together
     * because the panel shows one list, kept distinct in the rows because the
     * question a person has to answer is not the same.
     */
    async awaitingResolution(schema: string, input: {
        readonly graceHours?: number; readonly limit?: number; readonly at?: Date;
    } = {}): Promise<readonly ReservationRow[]> {
        const at = input.at ?? new Date();
        const olderThan = new Date(at.getTime() - (input.graceHours ?? 72) * 3_600_000);
        return this.prisma.transactionInTenantSchema(schema, async query => {
            const unknown = await staleIndeterminateEffects(query as SpendQuery, schema,
                { olderThan, limit: input.limit });
            const accepted = await staleAcceptedEffects(query as SpendQuery, schema,
                { olderThan, limit: input.limit });
            return Object.freeze([...unknown, ...accepted]);
        });
    }

    /**
     * Turn estimates into charges, using what the provider says it billed.
     *
     * THE authority, and the only road from an estimate to a charge. Each line
     * carries the document and version it came from: an amount with no
     * provenance is indistinguishable from a number somebody typed, and a
     * corrected invoice has to be able to say which one it corrects.
     */
    async settleFromInvoice(schema: string, lines: readonly ProviderInvoiceLine[]): Promise<{
        applied: number; currencyMismatch: readonly string[]; unknown: readonly string[];
        overReserved: readonly string[];
    }> {
        const outcome = await this.prisma.transactionInTenantSchema(schema, query =>
            settleFromProviderEvidence(query as SpendQuery, schema, lines));
        if (outcome.overReserved.length) {
            // The reserved amount is an upper bound from the published rate. An
            // invoice above it means the rate table is wrong — a thing to fix,
            // not to absorb, and certainly not to record truncated.
            this.logger.error(`[Spend] ${outcome.overReserved.length} invoice line(s) in `
                + `${schema} charge more than was ever reserved. None were applied: the rate `
                + 'table disagrees with what Meta billed and a person has to reconcile them.');
        }
        if (outcome.currencyMismatch.length) {
            // Refused, never converted. Adding COP minor units to a USD counter
            // is off by a factor of four thousand and looks entirely plausible.
            this.logger.error(`[Spend] ${outcome.currencyMismatch.length} invoice line(s) in `
                + `${schema} name a currency the reservation does not use. None were applied.`);
        }
        return outcome;
    }

    /**
     * A person deciding what nothing else can decide.
     *
     * The only way an `indeterminate` effect leaves that state, and deliberately
     * so: it means the request went out and no answer ever came back, and the
     * two possible truths — it arrived, it did not — have opposite consequences
     * for somebody's bill. A scheduler picking one would be inventing evidence.
     *
     * The reason is REQUIRED and stored. An adjustment to a business's spending
     * record with no stated reason is indistinguishable from a mistake, and in
     * six months nobody will remember which it was.
     */
    async resolveManually(schema: string, input: {
        readonly effectKey: string;
        readonly decision: 'delivered' | 'not_delivered';
        readonly reason: string;
        readonly actorId: string;
        readonly chargedMinor?: number | null;
    }): Promise<ReservationRow | null> {
        const reason = String(input.reason ?? '').trim();
        if (!reason) throw new Error('spend_manual_resolution_requires_a_reason');
        return this.prisma.transactionInTenantSchema(schema, async query => {
            const current = await findReservation(query as SpendQuery, schema, input.effectKey);
            if (!current) return null;
            // Only what is genuinely unresolved. A settled or released effect is
            // finished, and re-deciding it here would be an edit to a record of
            // money that already moved.
            if (current.state === 'settled' || current.state === 'released') return null;
            const evidence = `manual:${input.actorId}:${reason}`.slice(0, 500);
            if (input.decision === 'not_delivered') {
                return releaseReservation(query as SpendQuery, schema, {
                    effectKey: input.effectKey, evidence,
                    reason: 'manually_resolved_not_delivered',
                    // `failed` rather than a new word: the column holds what the
                    // PROVIDER's vocabulary can express, and a person saying it
                    // never arrived is asserting the same fact a failed receipt
                    // would have. Inventing a value here violates the CHECK and
                    // takes the whole transaction with it.
                    remoteState: 'failed',
                    fromStates: RESOLVABLE_STATES,
                });
            }
            // A person may know the real figure from Meta's invoice. Absent
            // that, the reservation's own amount stands — the same upper bound
            // the reconciler uses.
            //
            // Above the reservation it is REFUSED rather than clamped. The
            // counters can only return what they allocated, so a larger figure
            // would be silently truncated: the row would say 500 and the
            // account would move by 200, and the two numbers a person compares
            // would disagree for ever. A bill that exceeded its own ceiling is
            // a real event and deserves its own correction, not a rounding.
            const charged = input.chargedMinor ?? current.money.reservedMinor;
            if (charged > current.money.reservedMinor) {
                throw new Error('spend_manual_charge_exceeds_reservation');
            }
            return settleReservation(query as SpendQuery, schema, {
                effectKey: input.effectKey,
                chargedMinor: charged,
                evidence, remoteState: 'delivered',
                fromStates: RESOLVABLE_STATES,
            });
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
/**
 * A rate that cannot be asked for, shaped like one the resolver refused.
 *
 * Built here rather than by calling the resolver with a placeholder, because a
 * placeholder is exactly what produced a confident price in money nobody
 * established. The reservation that carries this reserves at the declared
 * ceiling and settles against whatever Meta actually bills.
 */
function unpriceable(reason: string, at: Date, zone: string) {
    return {
        basis: 'unknown' as const,
        reason: 'market_not_in_rate_card' as const,
        detail: reason,
        rateVersion: null,
        tableVersion: WHATSAPP_RATE_TABLE_VERSION,
        appliedOnLocalDate: wabaLocalDate(at, zone),
    };
}

class SpendRefused extends Error {
    constructor(readonly block: SpendBlock) { super(block.code); }
}

export type SpendAuthorizeResult =
    /**
     * `pressure` travels with a PERMITTED effect on purpose. It is the only
     * moment the platform knows how full a ceiling is without asking, and a
     * warning that is only emitted when something is refused arrives after the
     * thing it was supposed to warn about.
     */
    | {
        readonly outcome: 'reserved'; readonly reservation: ReservationRow;
        readonly pressure: SpendPressure;
        /**
         * A ceiling this effect crossed while nobody was enforcing it.
         *
         * The effect is reserved, allocated and recoverable exactly like any
         * other — this is the DIAGNOSIS, not a permission. Under `enforce` the
         * same condition is a refusal.
         */
        readonly observedBlock?: SpendBlock | null;
    }
    | { readonly outcome: 'adopted'; readonly reservation: ReservationRow; readonly pressure: SpendPressure }
    | { readonly outcome: 'blocked'; readonly block: SpendBlock };

/** Whether a ceiling may refuse, or only record what it would have refused. */
export type SpendEnforcementMode = 'enforce' | 'observe';

const blocked = (block: SpendBlock): SpendAuthorizeResult =>
    Object.freeze({ outcome: 'blocked' as const, block });

/** Did this authorisation permit a remote call? */
export function mayTransmit(result: SpendAuthorizeResult): boolean {
    return result.outcome !== 'blocked' && result.reservation.state === 'held';
}
