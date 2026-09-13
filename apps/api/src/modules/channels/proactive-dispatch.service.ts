import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AgentDispatchOutboxStore } from './agent-dispatch-outbox.store';
import { OutboundQueueService } from './outbound-queue.service';
import type { DispatchDisposition, DispatchItem, DispatchOriginKind } from './agent-dispatch-outbox';
import { DispatchOutboxError } from './agent-dispatch-outbox';
import { proactivePolicyAuthority } from '../persona/proactive-policy-authority';
import {
    humanOperatorAuthority, type HumanOperatorSurface,
} from '../persona/human-operator-authority';

/** The shape a persisted identifier has. A derived one has it too, by design. */
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

/**
 * ═══ WHAT HAPPENED, SAID IN A WAY A PRODUCER CAN ACT ON ═══
 *
 * This used to return `string | null`, and the reminders read `null` as "it did
 * not work" and `void` as "carry on" — then marked the appointment as reminded
 * either way. A producer that writes its "sent" flag on anything other than
 * "the durable effect now exists" is a producer that loses messages silently,
 * which is the entire failure the durable lane exists to end.
 *
 * Five answers, and each one calls for something different:
 *
 *   · `prepared`        the row exists and is published. Write the flag.
 *   · `already_present` the row existed from a previous attempt. Write the
 *                       flag: the effect is owed exactly once and it is owed.
 *   · `suppressed`      the policy says this should NOT be sent — the
 *                       appointment was cancelled, the entity is gone. Write
 *                       the flag: nothing is owed any more, and leaving it
 *                       unset means trying again every fifteen minutes for
 *                       ever.
 *   · `deferred`        nothing was written and the reason may pass. Leave the
 *                       flag alone so the next pass retries.
 *   · `refused`         nothing was written and retrying cannot help — no
 *                       sender, no thread, an authority nobody can build.
 *                       Leave the flag alone and let the producer say so.
 */
export type ProactiveSendResult =
    | { readonly kind: 'prepared'; readonly originId: string }
    | { readonly kind: 'already_present'; readonly originId: string }
    | { readonly kind: 'suppressed'; readonly reason: string }
    | { readonly kind: 'deferred'; readonly reason: string }
    | { readonly kind: 'refused'; readonly reason: string };

/** Did this result leave a durable effect that will be delivered exactly once? */
/**
 * The `kind` every authority the outbox accepts carries.
 *
 * ── WHY THIS LIST IS CHECKED AGAINST THE FACTORIES, NOT WRITTEN FROM MEMORY ──
 *
 * A served agent's scope is `agent` or `legacy` — NOT `served_agent`, which is
 * what the authority is called in prose and what a first version of the guard
 * below looked for. The result was a guard that refused every deterministic
 * reply on the durable lane: thirteen tests went red at once, which is the only
 * reason it was caught before it silenced a producer.
 *
 * So `proactive-scope-required.spec.ts` builds one of each authority through
 * its real factory and asserts the kind it comes out with is in this list. A
 * new authority whose kind is not here fails there rather than at a customer.
 */
export const DISPATCH_AUTHORITY_KINDS: readonly string[] = Object.freeze([
    'agent', 'legacy', 'proactive_policy', 'human_operator',
]);

export function effectIsDurable(result: ProactiveSendResult): boolean {
    return result.kind === 'prepared' || result.kind === 'already_present';
}

/** May the producer stop trying? True for anything that is not worth retrying. */
export function producerMayAdvance(result: ProactiveSendResult): boolean {
    return effectIsDurable(result) || result.kind === 'suppressed';
}

/**
 * ═══ THE DURABLE LANE, FOR THINGS NOBODY ASKED FOR ═══
 *
 * `agent_dispatch_outbox` exists so that one acceptance from a provider means
 * exactly one effect the customer received: a row committed before the POST, a
 * lease, a single owner of the attempt, a receipt tied back to the message.
 *
 * All of that was modelled around ANSWERING an inbound message. A reminder, a
 * drip step, a campaign and a REST send answer nothing, so they could not write
 * a row — and so twenty-five producers went out through BullMQ (where Redis is
 * the only record) or straight to the adapter (no record at all). A restart
 * between the decision and the POST lost the message or sent it twice, and
 * nothing could refuse the spend before it happened.
 *
 * ── THE ORIGIN, WHICH IS THE WHOLE TRICK ────────────────────────────────────
 *
 * A reply's origin is the inbound message. A proactive effect's origin is a
 * UUID DERIVED from whatever the producer already keeps durably: the reminder's
 * appointment id and kind, the drip step, the campaign recipient. Two attempts
 * at the same effect derive the same origin, so the outbox's existing
 * `UNIQUE (inbound_message_id, item_index)` makes the second one a no-op that
 * returns the first one's rows.
 *
 * That is why this takes an `originKey` and not an id: the producer states what
 * makes this effect THIS effect, in its own terms, and the derivation is one
 * place instead of twenty-five. A producer that cannot name one has no stable
 * identity to retry against, and saying so out loud is better than minting a
 * random id that turns every retry into a second message.
 *
 * ── WHAT THIS DELIBERATELY DOES NOT DO ──────────────────────────────────────
 *
 * It does not decide whether the message may be sent. Admission, the ceiling,
 * the payer and the transmission right all belong to the processor that picks
 * the row up — which is the point: the decision happens once, where the money
 * is, rather than once per producer.
 */
@Injectable()
export class ProactiveDispatchService {
    private readonly logger = new Logger(ProactiveDispatchService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly outbox: AgentDispatchOutboxStore,
        private readonly queue: OutboundQueueService,
    ) {}

    /**
     * The thread this proactive message belongs to, creating it if there is none.
     *
     * ── WHY A PROACTIVE EFFECT NEEDS A CONVERSATION AT ALL ──────────────────
     *
     * Because the durable lane writes the outbound into `messages` in the same
     * transaction as the row, and a message belongs to a thread. That history
     * row is not bookkeeping: it is what the customer's agent reads, what the
     * receipt ties back to, and what erasure clears.
     *
     * An appointment booked by hand or through the public page has no
     * conversation, and a reminder for it is still part of the conversation
     * this business is having with that person — a customer who replies to it
     * expects the answer to land in the same thread, and it will.
     *
     * ── AND WHY IT IS FOUND RATHER THAN ALWAYS CREATED ──────────────────────
     *
     * A second thread for the same person on the same number splits their
     * history in two: the agent sees half of it, the identity service sees two
     * customers, and the reminder arrives looking like it came from a stranger.
     *
     * ── AND WHY AN ARCHIVED THREAD IS NOT A THREAD ──────────────────────────
     *
     * `ORDER BY (status = 'active') DESC` PREFERRED an active one and settled
     * for anything else, so a reminder could land in a conversation somebody
     * had closed months ago — the agent console does not show it, the customer
     * replies into a thread nobody is watching, and the reply looks like it
     * came from nowhere. Only a live thread is reused; a closed one is left
     * closed and a new one opened beside it.
     *
     * ── AND WHY THE WHOLE THING IS ONE TRANSACTION ──────────────────────────
     *
     * Read-then-insert across two statements is a race two crons lose together:
     * both read nothing, both insert, and the person now has two threads on one
     * number. There is no unique index to lean on — the same (contact, channel,
     * account) legitimately has several conversations over time — so the
     * serialisation is an advisory lock on exactly that triple, held for the
     * transaction. It costs one lock on a path that runs a few times a minute.
     */
    async conversationFor(schemaName: string, input: {
        readonly contactId: string;
        readonly channelType: string;
        readonly channelAccountId: string;
    }): Promise<string | null> {
        try {
            return await this.prisma.transactionInTenantSchema(schemaName, async query => {
                // Serialised on the triple itself, so two producers asking at
                // the same moment cannot both decide there is no thread.
                await query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text',
                    [`proactive-conversation:${schemaName}:${input.contactId}`
                        + `:${input.channelType}:${input.channelAccountId}`]);
                const [existing] = await query<any[]>(
                    `SELECT id FROM conversations
                      WHERE contact_id = $1::uuid AND channel_type = $2
                        AND channel_account_id = $3
                        -- LIVE only. A resolved or archived thread is a closed
                        -- conversation, and writing into one puts the message
                        -- where nobody is looking.
                        AND COALESCE(status, 'active') NOT IN ('resolved', 'archived')
                      ORDER BY updated_at DESC
                      LIMIT 1`,
                    [input.contactId, input.channelType, input.channelAccountId]);
                if (existing?.id) return String(existing.id);
                const [created] = await query<any[]>(
                    `INSERT INTO conversations(contact_id, channel_type, channel_account_id, status)
                     VALUES($1::uuid, $2, $3, 'active') RETURNING id`,
                    [input.contactId, input.channelType, input.channelAccountId]);
                return created?.id ? String(created.id) : null;
            });
        } catch (error: any) {
            // Never invent one. A caller that gets `null` sends nothing, which
            // is the honest outcome: without a thread there is no history row,
            // and without a history row the effect has no receipt and no way
            // back.
            this.logger.error(`[Proactive] no conversation for contact ${input.contactId} `
                + `on ${input.channelType}: ${error?.message}`);
            return null;
        }
    }

    /**
     * A UUID that is a function of what the producer already knows.
     *
     * SHA-256 of the key, shaped into a v4-looking UUID. Not `randomUUID`: a
     * random id minted inside a failed attempt is not recomputable, so the
     * retry would mint a second one and send a second message — the same class
     * of mistake as the outbound `jobId` incident.
     *
     * The version and variant nibbles are forced so the value is a legal UUID
     * for the column, and the remaining 122 bits come from the digest, which is
     * far more collision resistance than a tenant's reminder schedule needs.
     */
    static originId(originKey: string): string {
        const key = String(originKey ?? '').trim();
        if (!key) throw new Error('proactive_dispatch_requires_an_origin_key');
        const hex = createHash('sha256').update(`proactive:${key}`).digest('hex');
        return [
            hex.slice(0, 8), hex.slice(8, 12),
            `4${hex.slice(13, 16)}`,
            `${((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}`,
            hex.slice(20, 32),
        ].join('-');
    }

    /**
     * The authority a scheduled behaviour sends under.
     *
     * Built by READING the domain row, in its own transaction, so the revision
     * it carries describes the appointment as it actually is rather than as the
     * producer remembers it. `undefined` means either the policy is unknown or
     * the entity no longer justifies the message, and both are reasons not to
     * prepare anything.
     */
    /**
     * The authority a PERSON sends under.
     *
     * Same shape of promise as `policyAuthority`, over a different fact: not
     * "is this appointment still the appointment", but "may this person still
     * speak for this business on this connection". Built by reading the user
     * row, so the revision describes their standing as it is rather than as the
     * request that queued the message remembers it.
     *
     * `undefined` means they may not — deactivated, demoted, moved or gone —
     * and the caller prepares nothing. There is nobody to attribute the message
     * to, and a message with no attributable sender is exactly what the outbox
     * exists to refuse.
     */
    async operatorAuthority(schemaName: string, input: {
        readonly tenantId: string;
        readonly userId: string;
        readonly surface: HumanOperatorSurface;
        readonly channelType: string;
        readonly channelAccountId: string;
    }) {
        return this.prisma.transactionInTenantSchema(schemaName, query =>
            humanOperatorAuthority(query as any, schemaName, input));
    }

    async policyAuthority(schemaName: string, input: {
        readonly tenantId: string;
        readonly producer: string;
        readonly channelType: string;
        readonly channelAccountId: string;
        readonly entityId: string;
    }) {
        return this.prisma.transactionInTenantSchema(schemaName, query =>
            proactivePolicyAuthority(query as any, schemaName, input));
    }

    /**
     * Commit this effect, then publish it. In that order, always.
     *
     * Every answer is one of five named outcomes. It used to be `string | null`,
     * and a producer cannot tell "already done" from "could not" from "must not"
     * with a null — the reminders read `null` as nothing at all and marked the
     * appointment reminded regardless.
     */
    async send(tenantId: string, input: {
        /** What makes this effect THIS effect, in the producer's own terms. */
        readonly originKey: string;
        readonly conversationId: string;
        readonly contactId: string;
        readonly channelType: string;
        readonly channelAccountId: string;
        readonly recipient: string;
        readonly items: readonly DispatchItem[];
        /** Who the effect is served on behalf of. The outbox refuses without it. */
        readonly operationalScope: any;
        /**
         * How this effect gets its idempotent identity. `proactive` derives it
         * from `originKey`; `inbound_reply` uses the real inbound message id.
         * Economic treatment is declared separately in `disposition`.
         */
        readonly originKind?: DispatchOriginKind;
        /** The customer message being answered. Required for `inbound_reply`. */
        readonly inboundMessageId?: string;
        /** Economic treatment, independent from the key that deduplicates it. */
        readonly disposition?: DispatchDisposition;
        /** Customer message answered by a separately identified effect. */
        readonly replyToMessageId?: string;
    }): Promise<ProactiveSendResult> {
        // ── AN EMPTY OBJECT IS TRUTHY, AND IT IS NOT AN AUTHORITY ───────────
        //
        // The guard was `!input.operationalScope`, so `{}` — or any object a
        // producer built when its authority lookup came back empty — walked
        // straight through it. The row was then committed, published and
        // leased, and `admit` refused it with `dispatch_authority_required`
        // every single time, for ever: an effect that can only fail, discovered
        // hours later for a scheduled message, with a diagnosis that reads like
        // a permission problem rather than a producer bug.
        //
        // Checking the KIND here rather than validating the whole scope keeps
        // the two ends honest about their jobs: this is "did the producer bring
        // one at all", and the full validation belongs to the transaction that
        // grants the lease, which can read the rows the scope refers to.
        if (!DISPATCH_AUTHORITY_KINDS.includes(String((input.operationalScope as any)?.kind ?? ''))) {
            return { kind: 'suppressed', reason: 'policy_authority_unavailable' };
        }
        const originKind: DispatchOriginKind = input.originKind === 'inbound_reply'
            ? 'inbound_reply' : 'proactive';
        // An answer is identified by the message it answers; anything else is
        // identified by the producer's own durable key, hashed into a UUID so
        // two attempts at the same effect collide on one row.
        const originId = originKind === 'inbound_reply'
            ? String(input.inboundMessageId ?? '')
            : ProactiveDispatchService.originId(input.originKey);
        if (originKind === 'inbound_reply' && !UUID.test(originId)) {
            // Refused rather than fabricated. A derived id here would let a
            // producer claim a reply to a message that does not exist, and the
            // whole point of the column is that it cannot.
            return { kind: 'refused', reason: 'inbound_message_required_for_reply' };
        }
        const binding = {
            conversationId: input.conversationId,
            contactId: input.contactId,
            inboundMessageId: originId,
            channelType: input.channelType,
            channelAccountId: input.channelAccountId,
            recipient: input.recipient,
        };
        let prepared: Awaited<ReturnType<AgentDispatchOutboxStore['prepare']>>;
        try {
            prepared = await this.outbox.prepare(tenantId, {
                binding, items: input.items,
                operationalScope: input.operationalScope,
                originKind,
                disposition: input.disposition,
                replyToMessageId: input.replyToMessageId,
            });
        } catch (error: any) {
            if (error instanceof DispatchOutboxError) {
                // A conflict is a decision, not an outage: the binding names
                // somebody else's conversation, or a second batch disagrees
                // with the first about the shape of the answer. Retrying sends
                // the identical thing and gets the identical refusal.
                this.logger.error(`[Proactive] ${input.originKey} refused by the outbox: `
                    + `${error.message}`);
                return { kind: 'refused', reason: error.message };
            }
            // Everything else may pass. Nothing was written, so the producer
            // leaves its flag alone and the next pass tries again.
            this.logger.warn(`[Proactive] ${input.originKey} could not be committed: `
                + `${error?.message}`);
            return { kind: 'deferred', reason: String(error?.message ?? error).slice(0, 200) };
        }
        // `prepare` returns the FIRST batch when one already exists, so a
        // repeat is recognisable by its rows already having left `prepared`.
        const fresh = prepared.rows.some(row => row.state === 'prepared');
        // Published AFTER the rows are committed, and a failure to publish is
        // not a failure to send: the row is the record, and the recovery pass
        // reads it. This is exactly the asymmetry the durable lane exists for.
        await this.outbox.publishBatch(tenantId, prepared.rows,
            (dispatchId, delayMs) => this.queue.enqueueDispatch(tenantId, dispatchId, delayMs));
        return fresh
            ? { kind: 'prepared', originId }
            : { kind: 'already_present', originId };
    }
}
