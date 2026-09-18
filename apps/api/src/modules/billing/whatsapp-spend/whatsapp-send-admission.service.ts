import { isScopedAddressKey, parseScopedAddressKey } from '@parallext/shared';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PROVIDER_BILLED_CHANNELS, type OutboundSendContext } from '@parallext/shared';
import { recipientIso, recipientMarket, describeRecipientMarket } from '../whatsapp-rates';
import { describeCurrency, resolveCurrency } from '../../whatsapp/waba-currency-authority';
import {
    declaredCategory, resolveMessageCategory, type CategoryEvidence,
} from './message-category';
import { mayTransmit, WhatsappSpendService, type SpendAuthorizeResult } from './whatsapp-spend.service';
import type { TransmissionGrant } from './spend-ledger';
import type { SpendDisposition, SpendPressure } from './spend-ledger';
import { resolveRepetitionPolicy, type RepetitionPolicy } from './spend-repetition';
import { describeBlock, spendBlock, type SpendBlock } from './spend-diagnosis';
import { consumesFreeAllowance, freeAllowanceFromMetadata } from './free-allowance';
import { SpendMeterUnavailable } from './spend-unavailable';
import { AccountPauseStore, PauseStateUnavailable } from '../../channels/account-pause-store';
import { describePause } from '../../channels/account-send-pause';
import { RedisService } from '../../redis/redis.service';
import { spendEnforcementFromSettings } from './account-send-readiness';

/**
 * ═══ THE ONE GATE EVERY CHARGEABLE WHATSAPP MESSAGE PASSES ═══
 *
 * The census found thirty-eight call sites that can put a message on a
 * customer's phone, twenty-six of them outside any durable lane. Rewriting
 * twenty-six producers is a migration; giving them one boundary is a gate — and
 * the gate belongs at the SINKS, because there are three of those and they are
 * the only places a WhatsApp request actually leaves the process:
 *
 *   · the durable dispatch transport, in `OutboundQueueProcessor`;
 *   · the legacy channel gateway, in the same processor;
 *   · `WhatsappMessagingService`, the inline REST surface.
 *
 * A producer that does not pass through one of those cannot send at all, so
 * "every chargeable send is authorised" is a property of the code rather than a
 * list somebody maintains.
 *
 * ── WHY THE DEFAULT IS `observe` ────────────────────────────────────────────
 *
 * No tenant has a billing time zone yet, no rate card is bound to an account,
 * and no ceiling has been configured by anybody. Shipping this as `enforce`
 * would stop every message on the platform the moment it deployed — a limit
 * nobody asked for, applied to everybody, on the strength of data that does not
 * exist.
 *
 * So the gate RECORDS by default: it reserves, it counts, it writes the
 * diagnosis, and it lets the message through. Turning it to `enforce` is a
 * deliberate commercial decision, per tenant, taken by somebody who has looked
 * at what `observe` recorded. The boundary is structural from day one; the
 * refusal is opt-in.
 */
export type SpendEnforcement = 'observe' | 'enforce';

/**
 * The currency used when the account's own is not known yet.
 *
 * Not a guess about the tenant: it is the currency Meta publishes its rate
 * cards in for most markets, and the reservation that uses it is marked
 * `basis: 'unknown'` so the exposure reads as unpriced rather than as priced in
 * the wrong money. The alternative was refusing to reserve at all, which is how
 * `currency_unknown` turned every send into an unmeasured POST.
 */
const ASSUMED_CURRENCY = 'USD';

/**
 * The connection an effect is authorised against.
 *
 * Every field is what the CONNECTION RESOLVER returned, not what a caller
 * happened to know. `payerKind` in particular was being decided by the presence
 * of an optional parameter — if a sink passed `payerWabaId`, the payer was
 * `business_direct`, and if it did not, the payer was `unknown` and the whole
 * send was refused. None of the three sinks passed it, so every authorisation
 * failed on `payer_unknown`: silence under `enforce`, and under `observe` a
 * refusal that turned into permission with no reservation behind it.
 *
 * `fromSendContext` is the only way this should be built in production code.
 */
export interface AdmissionConnection {
    readonly tenantId: string;
    readonly channelType: string;
    readonly channelAccountId: string;
    readonly channelAddress?: string | null;
    readonly payerKind?: 'business_direct' | 'partner' | 'unknown';
    readonly payerWabaId?: string | null;
    readonly payerBusinessId?: string | null;
    readonly credentialId?: string | null;
    readonly credentialSource?: 'channel_account' | 'tenant_credential' | 'system_user' | null;
}

/** Build an admission connection out of a resolved send context, losing nothing. */
export function fromSendContext(context: OutboundSendContext): AdmissionConnection {
    return Object.freeze({
        tenantId: context.tenantId,
        channelType: context.channelType,
        channelAccountId: context.channelAccountId,
        channelAddress: context.channelAddress ?? null,
        payerKind: context.payer.kind,
        payerWabaId: context.payer.wabaId ?? null,
        payerBusinessId: context.payer.businessId ?? null,
        credentialId: context.credential.id,
        credentialSource: context.credential.source,
    });
}

export interface AdmissionRequest {
    readonly schema: string;
    readonly connection: AdmissionConnection;
    /** A contact id or a hashed address. NEVER the raw phone number. */
    readonly recipientRef: string;
    readonly contactId?: string | null;
    /**
     * The destination, in whatever shape the sink carries it. Read ONLY to
     * derive the tariff country, and never stored — `recipientRef` is what
     * reaches the ledger.
     */
    readonly recipientAddress?: string | null;
    /**
     * One of Meta's five, when the producer genuinely knows. Anything else is
     * ignored rather than passed through: a category the rate card does not
     * price is not a category.
     */
    readonly category?: string | null;
    /** Meta's own approval for the template being sent, when this is one. */
    readonly template?: {
        readonly name?: string | null;
        /** `MARKETING`, `UTILITY`, `AUTHENTICATION`, as Meta approved it. */
        readonly category?: string | null;
    } | null;
    /** False only where the producer can PROVE the 24-hour window has closed. */
    readonly insideServiceWindow?: boolean;
    /** An authentication template whose recipient is in another country. */
    readonly authenticationInternational?: boolean;
    /** The campaign, broadcast or automation this belongs to, when there is one. */
    readonly taskId?: string | null;
    /** Which producer asked. Part of the effect key, so it must be stable. */
    readonly producer: string;
    /**
     * Did WE start this exchange, or did the customer?
     *
     * Declared by the producer, never inferred from the message: deciding from
     * a body that a person asking for help is a marketing blast is exactly the
     * invented intent this whole layer is supposed to avoid. It is what the
     * soft stop reads — a budget nearly spent pauses the campaigns and keeps
     * answering the people who wrote in — so getting it wrong either silences
     * customers or lets a broadcast run to the ceiling.
     *
     * Omitted means `proactive`: the reading that spends less.
     */
    readonly disposition?: SpendDisposition;
    readonly ordinal?: number;
    /** What is being sent, as a digest. The content itself never travels. */
    readonly contentDigest: string;
    readonly deliveries?: number;
    readonly admissionReason: string;
    readonly binding?: {
        inboundMessageId?: string | null; batchId?: string | null;
        dispatchItemId?: string | null; itemIndex?: number | null;
        /** A persisted outbound message row, written before the send. */
        messageId?: string | null;
        /** A durable queue job: one id for every attempt of the same job. */
        jobId?: string | null;
        /** A synchronous one-off that minted its own id for this press. */
        requestId?: string | null;
    };
}

export interface Admission {
    /**
     * May the caller perform the remote request?
     *
     * True only when this caller HOLDS the exclusive transmission right. Two
     * concurrent authorisations of one effect produce one reservation, and
     * exactly one of them is permitted — the other is told somebody else is
     * sending it.
     */
    readonly permitted: boolean;
    /**
     * The transmission right, present only for the caller that may send.
     *
     * It must be passed back with the outcome, so a worker whose lease expired
     * cannot overwrite the result of the attempt that replaced it.
     */
    readonly transmit?: TransmissionGrant | null;
    /** Present whenever a reservation exists, including an adopted one. */
    readonly effectKey: string;
    readonly reservationId?: string | null;
    /** Why it would have been refused, whether or not it was. */
    readonly block?: SpendBlock | null;
    readonly enforcement: SpendEnforcement;
    /**
     * How full the fullest ceiling is now. Carried on a PERMITTED admission too:
     * a warning only emitted on refusal arrives after the thing it was meant to
     * warn about.
     */
    readonly pressure?: SpendPressure;
    /** True when this channel is not billed by a provider at all. */
    readonly notBilled?: boolean;
}

@Injectable()
export class WhatsappSendAdmissionService {
    private readonly logger = new Logger(WhatsappSendAdmissionService.name);

    /** Repetition is process-local; enforcement is shared across API and worker. */
    private readonly REPETITION_TTL_MS = 60_000;
    private readonly MODE_CACHE_KEY = 'whatsapp-spend:enforcement';
    private readonly MODE_CACHE_SECONDS = 300;

    constructor(
        private readonly prisma: PrismaService,
        private readonly spend: WhatsappSpendService,
        // Optional for the same reason the whole gate is: a deployment that has
        // not wired it must still send. When it IS wired, a number Meta refuses
        // to bill stops trying.
        @Optional() private readonly pauses?: AccountPauseStore,
        // Optional keeps isolated unit harnesses small. Production has the
        // global RedisModule; without it PostgreSQL is read on every send.
        @Optional() private readonly redis?: RedisService,
    ) {}

    /**
     * Authorise one remote effect, or say exactly why not.
     *
     * Never throws for a money reason: a caller in the middle of a send path
     * gets a verdict, not an exception. It DOES let an infrastructure error
     * propagate, because "the database is unreachable" is not a spending
     * decision and must not be silently read as permission.
     */
    async admit(request: AdmissionRequest): Promise<Admission> {
        const channel = String(request.connection.channelType || '').toLowerCase();

        // ── The canonical category, BEFORE the key that hashes it ───────────
        //
        // The key includes the category, and it was being built from
        // `request.category || 'service'` — the raw value a producer happened to
        // pass, or the cheapest default. So the same message could be keyed as
        // `service` and reserved as `marketing`, and two attempts at one effect
        // could land on two different keys.
        const category = this.categoryFor(request);
        const keyCategory = category.kind === 'resolved' ? category.category : 'category_unknown';

        // ── THE DURABLE HALF OF THE KEY ─────────────────────────────────
        //
        // Without it two different campaigns sending the same approved template
        // to the same customer from the same number produce the same key, and
        // the second adopts the first one's reservation — so the second message
        // is never sent and never charged. And in the other direction: a retry
        // that re-renders the body (a time, a name, a price) produces a
        // DIFFERENT key and pays for the same message twice.
        const logicalEffectId = WhatsappSpendService.logicalEffectId({
            ...(request.binding ?? {}),
            taskId: request.taskId ?? null,
            recipientRef: request.recipientRef,
            ordinal: request.ordinal ?? 0,
        });
        const keyParts = {
            tenantId: request.connection.tenantId,
            channelAccountId: request.connection.channelAccountId,
            recipientRef: request.recipientRef,
            // `category_unknown` rather than `service`: an unclassified message
            // must not share a key with a classified one, and must not be keyed
            // as the cheapest thing Meta sells.
            category: keyCategory,
            producer: request.producer,
            ordinal: request.ordinal ?? 0,
            contentDigest: request.contentDigest,
        };
        const durableKey = this.spend.effectKey({ ...keyParts, logicalEffectId });
        // The shape every effect had before identity became mandatory. Computed
        // so an effect ALREADY in flight under it can still be found: a deploy
        // must not orphan the reservations that were live when it landed.
        const legacyKey = this.spend.effectKey({ ...keyParts, logicalEffectId: null });
        const effectKey = logicalEffectId ? durableKey : legacyKey;

        // Instagram, Messenger, Telegram and the widget are not billed by their
        // provider per message. Counting them would invent a cost, and a number
        // that is not real is worse than no number.
        //
        // Checked before the identity requirement below: an unbilled channel is
        // not a chargeable effect, so demanding a durable identity from it would
        // stop Telegram replies to protect a WhatsApp invoice.
        // ── A DESTINATION ONLY ITS WHATSAPP PORTFOLIO CAN ADDRESS ───────────
        //
        // Above the unbilled early return, deliberately. "No provider bills
        // this channel" and "this string is a destination" are different
        // questions, and answering the first used to skip the second: a
        // business-scoped key on Telegram, Instagram or Messenger came back
        // `permitted: true, notBilled: true` and went on to be POSTed.
        // Nothing mints such a key for those channels today, which is
        // exactly why the guard belongs here rather than in whoever might.
        //
        // A WhatsApp BSUID is valid only within the portfolio that minted it.
        // The transport can unwrap it into Meta's `to` field, but admission
        // must first prove that the selected payer belongs to the same WABA.
        // A malformed or cross-WABA key is refused before money is reserved.
        const scopedRecipient = parseScopedAddressKey(request.recipientAddress ?? null);
        const scopedCannotUseConnection = isScopedAddressKey(request.recipientAddress ?? null)
            && (channel !== 'whatsapp'
                || !scopedRecipient
                || ![request.connection.payerWabaId, request.connection.channelAccountId]
                    .filter(Boolean).includes(scopedRecipient.portfolioId));
        if (scopedCannotUseConnection) {
            return Object.freeze({
                permitted: false, effectKey,
                // Read even though this is not a money decision: the verdict
                // carries the mode on every path, and hardcoding 'observe'
                // here would tell an operator enforcement was off when it is
                // on. It is memoised, and only reached for an address that is
                // refused anyway.
                enforcement: await this.enforcementFor(request.connection.tenantId),
                block: spendBlock('recipient_not_addressable',
                    `recipient=${String(request.recipientAddress).slice(0, 60)}`),
            });
        }

        if (!PROVIDER_BILLED_CHANNELS.includes(channel as any)) {
            return Object.freeze({ permitted: true, effectKey, enforcement: 'observe' as const, notBilled: true });
        }

        const enforcement = await this.enforcementFor(request.connection.tenantId);

        // ── EVERY NEW CHARGEABLE EFFECT NAMES SOMETHING DURABLE ─────────────
        //
        // A key made only of content cannot tell a retry from a second message.
        // Both directions cost real money: a re-rendered body on retry pays
        // twice for one message, and two genuinely different sends with the
        // same words collapse into one, so the second is never sent.
        //
        // Under `enforce` this is a refusal. Under `observe` the effect still
        // reserves under the legacy key — dropping it would stop METERING to
        // punish a producer defect, which is the wrong trade — and the log says
        // what enforcement would have stopped.
        //
        // An effect ALREADY in flight under a legacy key is never refused: a
        // deploy must not orphan the reservations that were live when it
        // landed, so the existing row is looked for before refusing.
        if (!logicalEffectId) {
            const inFlight = enforcement === 'enforce'
                ? await this.spend.reservationFor(request.schema, legacyKey)
                : null;
            if (enforcement === 'enforce' && !inFlight) {
                this.logger.warn(`[Spend] refused ${request.producer}: no durable effect identity`);
                return Object.freeze({
                    permitted: false, effectKey, enforcement,
                    block: spendBlock('effect_identity_missing',
                        `producer=${request.producer} account=${request.connection.channelAccountId}`),
                });
            }
            this.logger.warn(`[Spend] ${request.producer} has no durable effect identity; `
                + `keyed by content, which cannot tell a retry from a second message`);
        }

        // ── Is Meta refusing to bill this number at all? ────────────────────
        //
        // Checked BEFORE pricing and before any reservation, because the answer
        // is not "this message costs too much" but "no message from this number
        // can be delivered until a person adds a card in Meta". Retrying is
        // pointless — every attempt is identical — so the refusal is returned
        // regardless of enforcement mode. `observe` exists to avoid stopping
        // messages that WOULD have gone out; these would not.
        // ── AN UNREADABLE PAUSE IS NOT "NOT PAUSED" ─────────────────────────
        //
        // `.catch(() => null)` turned every database blip into permission to
        // send from a number Meta may already have refused to bill. That is the
        // one direction this check cannot afford to be wrong in: the pause
        // exists because every attempt from such a number is identical, fails
        // identically, and fills the queue while the customer hears nothing.
        let pause: Awaited<ReturnType<AccountPauseStore['current']>> = null;
        try {
            pause = (await this.pauses?.current(
                request.connection.tenantId, request.connection.channelAccountId)) ?? null;
        } catch (error) {
            if (!(error instanceof PauseStateUnavailable)) throw error;
            this.logger.warn(`[Spend] refusing ${request.producer}: the pause state of `
                + `${request.connection.channelAccountId} could not be read`);
            return Object.freeze({
                permitted: false, effectKey, enforcement,
                block: spendBlock('account_pause_unknown',
                    `account=${request.connection.channelAccountId}`),
            });
        }
        if (pause && !pause.clearedAt) {
            return Object.freeze({
                permitted: false, effectKey, enforcement,
                block: spendBlock('account_paused', describePause(pause)),
            });
        }

        const account = await this.accountFacts(request.connection.tenantId, request.connection.channelAccountId);

        // ── The currency, with provenance or not at all ─────────────────────
        //
        // A substituted default plus a real market and category produced
        // `basis: 'priced'` — an exact amount in money nobody established. That
        // is worse than the refusal it replaced, because it reads as
        // authoritative. The reservation still happens; what it must not do is
        // claim a price.
        const currency = resolveCurrency(account.metadata);
        const currencyEstablished = currency.kind === 'established';
        if (!currencyEstablished && enforcement === 'enforce') {
            // Under enforcement the effect is DEFERRED rather than sent
            // unpriced: a tenant that asked for a ceiling asked for a ceiling
            // that means something, and a ceiling cannot be applied to an
            // amount nobody can compute.
            return Object.freeze({
                permitted: false, effectKey, enforcement,
                block: spendBlock('currency_unknown', describeCurrency(currency)),
            });
        }
        if (currency.kind === 'established' && currency.stale) {
            this.logger.warn(`[Spend] pricing ${request.connection.channelAccountId} in `
                + `${currency.currency}, last confirmed ${Math.floor(currency.ageMs / 86_400_000)} `
                + `day(s) ago`);
        }

        // ── The country being messaged, read before the address is hashed ───
        //
        // Meta charges by the RECIPIENT'S country. The old code read one fixed
        // `billingMarket` off the sending number, which is wrong for every
        // tenant with a customer abroad. Only the ISO survives into the ledger.
        const market = recipientMarket(request.recipientAddress ?? null);
        // NOT `account.market`. Falling back to the sending number's country is
        // the very defect this replaced: it prices a Mexican customer at the
        // Colombian rate and looks entirely plausible doing it. An
        // unresolvable destination stays unknown, and the rate card's own
        // unnamed bucket answers for it.
        const marketIso = market.kind === 'resolved' ? market.iso : null;
        if (!marketIso) {
            this.logger.log(`[Spend] market unresolved for ${request.producer}: `
                + `${describeRecipientMarket(market)}`);
        }

        // Which of Meta's five categories this is was resolved above, before
        // the key. A fact about the message, not a default: every lane used to
        // pass nothing and get `service`, so campaigns and one-time passwords
        // priced as the cheapest thing Meta sells.
        if (category.kind === 'unknown' && enforcement === 'enforce') {
            // Deferred, not sent unpriced. A proactive message nobody can
            // classify is the one most likely to be expensive.
            return Object.freeze({
                permitted: false, effectKey, enforcement,
                block: spendBlock('category_unknown', category.detail),
            });
        }

        // What makes a price impossible, as opposed to merely hard to find.
        // Either of these makes the rate card inapplicable, so nothing is asked
        // of it and the reservation carries the declared ceiling as exposure.
        const costUnknowable = !currencyEstablished
            ? { reason: `currency_unestablished: ${describeCurrency(currency)}` }
            : category.kind === 'unknown'
                ? { reason: `category_unknown: ${category.detail}` }
                : !marketIso
                    // A destination whose country cannot be named has no rate
                    // line. The resolver would fall into an unnamed bucket and
                    // return a number; that number is for a different country.
                    ? { reason: `market_unknown: ${describeRecipientMarket(market)}` }
                    : null;

        const result: SpendAuthorizeResult = await this.spend.authorize(request.schema, {
            effectKey,
            // ── THE FREE THOUSAND, AND WHO MAY SPEND IT ────────────────────
            //
            // Only a message we could actually CLASSIFY as service. The
            // identity below writes `service` for an unclassifiable one too —
            // the column is constrained and that is what fits — so reading the
            // allowance off it would hand a free message to a utility template
            // that Meta charges for and that explicitly does not consume the
            // quota. The business would then pay twice: once for the template,
            // and once for the service reply whose free slot it ate.
            freeAllowanceEligible: category.kind === 'resolved'
                && consumesFreeAllowance(category.category),
            // Meta's published figure unless this number was told another one.
            freeAllowance: freeAllowanceFromMetadata(account.metadata),
            identity: {
                tenantId: request.connection.tenantId,
                channelType: channel,
                channelAccountId: request.connection.channelAccountId,
                channelAddress: request.connection.channelAddress ?? account.address,
                // Derived from the RESOLVED connection, never from whether an
                // optional parameter happened to be passed.
                payerKind: request.connection.payerKind
                    ?? (request.connection.payerWabaId || account.wabaId ? 'business_direct' : 'unknown'),
                payerWabaId: request.connection.payerWabaId ?? account.wabaId,
                payerBusinessId: request.connection.payerBusinessId ?? account.businessId,
                credentialId: request.connection.credentialId || 'unknown',
                credentialSource: request.connection.credentialSource || 'system_user',
                recipientScope: 'customer',
                recipientRef: request.recipientRef,
                // `service` only when something actually established it. An
                // unknown category still reserves in `observe` — at the unknown
                // basis, which is visible — rather than pricing as a reply.
                category: category.kind === 'resolved' ? category.category : 'service',
                market: marketIso,
                // The ledger column is NOT NULL, so an unestablished currency is
                // still written — but `costUnknowable` below makes sure nothing
                // is ever priced in it.
                currency: currencyEstablished ? currency.currency : ASSUMED_CURRENCY,
            },
            binding: request.binding,
            contactId: request.contactId,
            taskId: request.taskId,
            deliveries: Math.max(1, request.deliveries ?? 1),
            wabaTimeZone: account.timeZone,
            admissionReason: request.admissionReason,
            disposition: request.disposition,
            // The digest travels on its own as well as inside the effect key:
            // the key hashes the producer too, so it recognises a retry of ONE
            // effect and not the same sentence arriving by another road.
            contentDigest: request.contentDigest,
            repetition: await this.repetitionFor(request.connection.tenantId),
            // In observe mode an unknown rate must not stop the recording: the
            // point of observing is to find out how many effects have no price.
            //
            // A category nobody could establish is an unknown rate by the same
            // rule, and an assumed currency is too. Both are recorded with
            // `basis: 'unknown'`, which is what makes the exposure visible
            // instead of confidently wrong.
            allowUnknownCost: enforcement === 'observe' || Boolean(costUnknowable),
            costUnknowable,
            // ── OBSERVING IS NOT DOING LESS BOOKKEEPING ─────────────────────
            //
            // Under `observe` a ceiling records what it would have stopped and
            // lets the message go — but the reservation, the allocation, the
            // identity and the transmission right all still happen. They used
            // not to: a cap refusal rolled the whole transaction back and the
            // caller was told `permitted: true` with no reservation at all, so
            // a chargeable POST went out with no exposure, no ceiling movement,
            // no transmission right and nothing for a receipt to resolve.
            //
            // That is the one failure this whole subsystem cannot recover from,
            // and it happened precisely to the tenants nobody was watching yet.
            caps: enforcement,
        });

        if (result.outcome !== 'blocked') {
            // ── ADOPTING A ROW IS NOT PERMISSION TO SEND AGAIN ──────────────
            //
            // `mayTransmit` existed and no sink applied it, so a retry that
            // adopted a `settled` reservation was told to go ahead — sending a
            // second copy of a message that had already been delivered AND
            // charged, with nothing left to settle it against. A
            // `pending_reconciliation` or `indeterminate` row is worse: the
            // provider may have acted, and another POST is the duplicate the
            // whole outbox exists to prevent.
            //
            // Only a reservation still HELD authorises a request. Everything
            // else is over, or waiting on evidence nobody here has.
            if (!mayTransmit(result)) {
                const state = result.reservation.state;
                this.logger.warn(`[Spend] ${request.producer} adopted a reservation in state `
                    + `${state}; no further POST is authorised for this effect`);
                return Object.freeze({
                    permitted: false, effectKey, reservationId: result.reservation.id, enforcement,
                    pressure: result.pressure,
                    block: spendBlock('effect_already_resolved',
                        `the effect is ${state}: `
                        + (state === 'settled' ? 'it was delivered and charged'
                            : state === 'released' ? 'it was refused and the money returned'
                                : 'its outcome never came back and is being reconciled')),
                });
            }
            if (result.pressure === 'warning' || result.pressure === 'soft_stop') {
                // Said once per admission rather than once per period: a ceiling
                // that fills over an afternoon should be visible all afternoon,
                // not in one line somebody scrolled past at 14:03.
                this.logger.warn(`[Spend] ${result.pressure} on ${request.producer} `
                    + `for account ${request.connection.channelAccountId}`);
            }

            // ── THE RIGHT TO SEND, WHICH IS NOT THE RESERVATION ─────────────
            //
            // `held` says the money is set aside. It does not say WHICH of the
            // callers holding this effect may make the request — and with the
            // effect lock in place, the loser of a concurrent authorisation
            // adopts a perfectly good `held` row. Both were being told to send.
            const claim = await this.spend.claimTransmission(request.schema, effectKey);
            if (claim.kind !== 'granted') {
                // Three refusals, said apart, because an operator reading the
                // log has to be able to tell "wait" from "never send this
                // again". `uncertain` is the one that matters most: a previous
                // attempt died with the request already started, so nobody can
                // say whether Meta processed it and a second POST is exactly
                // the duplicate delivery this mechanism exists to prevent.
                const detail = claim.kind === 'held_by_other'
                    ? `another attempt holds the send right until ${claim.expiresAt?.toISOString() ?? 'soon'}`
                    : claim.kind === 'uncertain'
                        ? 'a previous attempt was already in flight when it died: whether Meta '
                            + 'processed it cannot be known, so this effect goes to '
                            + 'reconciliation and is never sent again'
                        : `the effect is ${claim.state ?? 'gone'} and no further attempt is authorised`;
                this.logger.log(`[Spend] not transmitting ${request.producer}: ${detail}`);
                return Object.freeze({
                    permitted: false, effectKey, reservationId: result.reservation.id, enforcement,
                    pressure: result.pressure,
                    block: spendBlock(claim.kind === 'uncertain'
                        ? 'transmission_outcome_unknown' : 'transmission_held_elsewhere', detail),
                });
            }

            return Object.freeze({
                permitted: true, effectKey, reservationId: result.reservation.id, enforcement,
                pressure: result.pressure, transmit: claim.grant,
                // What enforcement WOULD have stopped. The effect is fully
                // accounted for either way; this is the diagnosis that is the
                // entire product of an observation.
                block: result.outcome === 'reserved' ? (result.observedBlock ?? undefined) : undefined,
            });
        }

        // ── BLOCKED BY SOMETHING THAT IS NOT A CEILING ──────────────────────
        //
        // A ceiling under `observe` no longer reaches here: it records the
        // exposure, keeps the reservation and reports itself as `observedBlock`
        // above. What is left are the conditions that make an effect
        // UNACCOUNTABLE rather than merely over budget — no time zone, no
        // payer, a repetition guard, an effect already resolved.
        //
        // Those refuse in BOTH modes, and that is the separation the review
        // asked for: observing may ignore a ceiling in order to measure it, and
        // may never turn an infrastructure, payer, timezone or identity failure
        // into permission. A message admitted on one of those would be a
        // chargeable POST whose reservation could not be written.
        const line = describeBlock(result.block);
        if (enforcement === 'enforce') {
            this.logger.warn(`[Spend] refused ${request.producer}: ${line}`);
        } else {
            this.logger.warn(`[Spend] refused ${request.producer} even under observation, `
                + `because the effect cannot be accounted for: ${line}`);
        }
        return Object.freeze({ permitted: false, effectKey, block: result.block, enforcement });
    }

    // ── `admitBySchema` IS GONE, AND ITS ABSENCE IS THE POINT ────────────────
    //
    // It took a channel type and an account id and built a connection out of
    // them: `{tenantId, channelType, channelAccountId, channelAddress}`. No
    // payer, no credential — because a call site cannot know those. So every
    // send through it arrived with `payerKind` undefined, the authority
    // answered `payer_unknown`, and under `enforce` the REST surface and the
    // agent console would have gone silent while the queue lane, which asked
    // the resolver, kept working.
    //
    // There is now exactly one way to build an `AdmissionConnection`, and it is
    // `fromSendContext` over a context the resolver produced. A sink that
    // cannot resolve its connection cannot send: that is a refusal with a
    // diagnosis, not an identity assembled from whatever was in scope.

    /** Schema → tenant. Immutable for the life of a tenant, so cached for good. */
    private readonly schemaTenants = new Map<string, string | null>();

    async tenantForSchema(schema: string): Promise<string | null> {
        if (this.schemaTenants.has(schema)) return this.schemaTenants.get(schema) ?? null;
        let tenantId: string | null = null;
        try {
            const tenant = await this.prisma.tenant.findFirst({
                where: { schemaName: schema }, select: { id: true },
            });
            tenantId = tenant?.id ?? null;
        } catch (error: any) {
            // Not cached: an unreachable database is a transient condition, and
            // remembering "no tenant" from it would unmeter the schema forever.
            this.logger.warn(`[Spend] tenant unresolved for ${schema}: ${error?.message}`);
            return null;
        }
        this.schemaTenants.set(schema, tenantId);
        return tenantId;
    }

    /**
     * Which of Meta's five categories this message is.
     *
     * A producer that states one outright is believed, but only if it names one
     * of the five — the REST lane used to pass the literal `'template'`, which
     * matched no row in the rate card, so the effect priced as unknown and the
     * exposure was invisible.
     */
    private categoryFor(request: AdmissionRequest) {
        const declared = declaredCategory(request.category);
        if (declared) return declared;
        return resolveMessageCategory({
            isTemplate: Boolean(request.template),
            templateCategory: request.template?.category ?? null,
            templateName: request.template?.name ?? null,
            insideServiceWindow: request.insideServiceWindow,
            authenticationInternational: request.template?.category?.toUpperCase() === 'AUTHENTICATION'
                && Boolean(request.authenticationInternational),
        } as CategoryEvidence);
    }

    /**
     * Say, durably, that the request is about to begin.
     *
     * The line that separates "provably sent nothing" from "nobody knows", and
     * it must be committed BEFORE the request. A false return means the right
     * was taken away while this caller was preparing; send nothing.
     */
    async beginTransmission(schema: string, admission: Admission): Promise<boolean> {
        if (!admission.transmit) return true;
        try {
            return await this.spend.markInFlight(schema, admission.transmit);
        } catch (error: any) {
            // Unable to record the intent. The request must not begin: a POST
            // whose start was never written cannot be told apart afterwards from
            // one that never happened.
            this.logger.error(`[Spend] could not mark ${admission.effectKey.slice(0, 12)} `
                + `in flight: ${error?.message}. Not sending.`);
            return false;
        }
    }

    /** Give the right back without sending. Only possible before the request begins. */
    async abandon(schema: string, admission: Admission): Promise<void> {
        if (!admission.transmit) return;
        try { await this.spend.abandonTransmission(schema, admission.transmit); }
        catch { /* the sweeper recovers a right nobody handed back */ }
    }

    /** What the provider said, recorded against the reservation this admitted. */
    async record(schema: string, admission: Admission, outcome: {
        readonly kind: 'delivered_priced' | 'accepted' | 'rejected' | 'rejected_retryable' | 'timeout';
        readonly providerMessageId?: string | null;
        readonly chargedMinor?: number | null;
        readonly errorCode?: string | null;
    }): Promise<void> {
        if (!admission.reservationId) return;
        try {
            await this.spend.recordOutcome(schema, admission.effectKey, {
                ...outcome,
                // Proves this is the attempt that sent, not an older one whose
                // lease expired while it was gone.
                transmitToken: admission.transmit?.token ?? null,
            });
        } catch (error: any) {
            // Never fatal to a send that already happened: the lease sweeper
            // turns an unrecorded outcome into visible exposure, which is the
            // honest state, and throwing here would retry a delivered message.
            this.logger.error(`[Spend] outcome not recorded for ${admission.effectKey.slice(0, 12)}: `
                + `${error?.message}. The lease will surface it as exposure.`);
        }
    }

    /**
     * The facts about an account that pricing needs, none of which it may guess.
     *
     * Every one of them is nullable on purpose. A missing time zone is a block
     * with a name and a one-field fix; a defaulted time zone is a wrong rate
     * date nobody ever notices.
     */
    private async accountFacts(tenantId: string, channelAccountId: string): Promise<{
        timeZone: string | null; market: string | null;
        wabaId: string | null; businessId: string | null; address: string | null;
        /** The raw metadata, so the currency authority can read its own evidence. */
        metadata: Record<string, any>;
    }> {
        try {
            const account = await this.prisma.channelAccount.findFirst({
                where: { tenantId, channelType: 'whatsapp', accountId: channelAccountId },
                select: { wabaTimezone: true, metadata: true, displayName: true },
            });
            const metadata = (account?.metadata ?? {}) as Record<string, any>;
            return {
                timeZone: account?.wabaTimezone ?? null,
                // NOT the currency: that comes from the authority, which refuses
                // a value with no provenance. Reading it here would be the same
                // unprovenanced guess wearing a different name.
                market: metadata.billingMarket ?? null,
                wabaId: metadata.wabaId ?? null,
                businessId: metadata.businessId ?? null,
                address: account?.displayName ?? null,
                metadata,
            };
        } catch (error: any) {
            // The account row IS the identity: the time zone that dates the
            // rate, the WABA that pays, the currency evidence. Proceeding
            // without it would send an unmeasured message rather than a
            // mismeasured one.
            throw new SpendMeterUnavailable(
                `account facts unreadable for ${channelAccountId}`, error);
        }
    }

    /**
     * How often a tenant is willing to say the same thing twice.
     *
     * Cached beside the enforcement mode and for the same reason: the busiest
     * path in the platform must not be two settings reads, and sixty seconds is
     * short enough that a change takes effect while the person who made it is
     * still looking at the screen.
     */
    private readonly repetitionCache = new Map<string, { policy: RepetitionPolicy; until: number }>();

    private async repetitionFor(tenantId: string): Promise<RepetitionPolicy> {
        const cached = this.repetitionCache.get(tenantId);
        if (cached && cached.until > Date.now()) return cached.policy;
        let configured: unknown;
        try {
            const tenant = await this.prisma.tenant.findUnique({
                where: { id: tenantId }, select: { settings: true },
            });
            configured = (tenant?.settings as any)?.whatsappSpend?.repetition;
        } catch (error: any) {
            // Unreadable settings mean the tenant configured nothing, which
            // resolves to the shipped default. Failing closed here would stop a
            // platform because one row could not be read.
            this.logger.warn(`[Spend] repetition policy unreadable for ${tenantId}: ${error?.message}`);
        }
        const policy = resolveRepetitionPolicy(configured);
        this.repetitionCache.set(tenantId, { policy, until: Date.now() + this.REPETITION_TTL_MS });
        return policy;
    }

    private async enforcementFor(tenantId: string): Promise<SpendEnforcement> {
        if (this.redis) {
            try {
                const cached = await this.redis.getTenantData<string>(tenantId, this.MODE_CACHE_KEY);
                if (cached === 'observe' || cached === 'enforce') return cached;
            } catch (error: any) {
                // PostgreSQL is the authority. A cache outage costs a read; it
                // never lifts a protection the tenant enabled.
                this.logger.warn(`[Spend] enforcement cache unreadable for ${tenantId}: ${error?.message}`);
            }
        }
        let mode: SpendEnforcement = 'observe';
        try {
            const tenant = await this.prisma.tenant.findUnique({
                where: { id: tenantId }, select: { settings: true },
            });
            // The one reading of the setting: the quality check that predicts
            // this admission's refusals (`whatsapp_delivery`) uses it too.
            mode = spendEnforcementFromSettings(tenant?.settings);
        } catch (error: any) {
            // The tenant row could not be read. That is not "they never opted
            // in" — it is "we do not know", and the difference matters: an
            // enforcing tenant would have every ceiling silently lifted for as
            // long as the database was unhappy.
            throw new SpendMeterUnavailable(
                `enforcement mode unreadable for tenant ${tenantId}`, error);
        }
        if (this.redis) {
            try {
                await this.redis.setTenantData(
                    tenantId, this.MODE_CACHE_KEY, mode, this.MODE_CACHE_SECONDS);
            } catch (error: any) {
                this.logger.warn(`[Spend] enforcement cache write failed for ${tenantId}: ${error?.message}`);
            }
        }
        return mode;
    }

    /** Current tenant mode for the control plane and its dashboard projection. */
    async enforcementMode(tenantId: string): Promise<SpendEnforcement> {
        return this.enforcementFor(tenantId);
    }

    /**
     * Remove the shared value before changing PostgreSQL. A worker that sends
     * during the transaction reads the old DB row; after commit it reads the
     * new one. If the transaction rolls back, it simply re-caches the old row.
     */
    async invalidateEnforcement(tenantId: string): Promise<void> {
        if (!this.redis) return;
        try {
            await this.redis.del(this.redis.tenantKey(tenantId, this.MODE_CACHE_KEY));
        } catch (error: any) {
            // If Valkey is unavailable, readers also fail their cache read and
            // fall back to PostgreSQL, which is the safe state.
            this.logger.warn(`[Spend] enforcement cache invalidation failed for ${tenantId}: ${error?.message}`);
        }
    }

    /** Warm every API/worker process through the shared cache after commit. */
    async cacheEnforcement(tenantId: string, mode: SpendEnforcement): Promise<void> {
        if (!this.redis) return;
        try {
            await this.redis.setTenantData(
                tenantId, this.MODE_CACHE_KEY, mode, this.MODE_CACHE_SECONDS);
        } catch (error: any) {
            this.logger.warn(`[Spend] enforcement cache refresh failed for ${tenantId}: ${error?.message}`);
        }
    }
}
