import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AgentDispatchOutboxStore } from './agent-dispatch-outbox.store';
import { OutboundQueueService } from './outbound-queue.service';
import type { DispatchItem } from './agent-dispatch-outbox';

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
     * The existing active thread wins whenever there is one.
     */
    async conversationFor(schemaName: string, input: {
        readonly contactId: string;
        readonly channelType: string;
        readonly channelAccountId: string;
    }): Promise<string | null> {
        try {
            const [existing] = await this.prisma.executeInTenantSchema<any[]>(schemaName,
                `SELECT id FROM conversations
                  WHERE contact_id = $1::uuid AND channel_type = $2
                    AND channel_account_id = $3
                  ORDER BY (status = 'active') DESC, updated_at DESC
                  LIMIT 1`,
                [input.contactId, input.channelType, input.channelAccountId]);
            if (existing?.id) return String(existing.id);
            const [created] = await this.prisma.executeInTenantSchema<any[]>(schemaName,
                // `ON CONFLICT DO NOTHING` is not available here — there is no
                // unique index on the triple — so two producers racing for the
                // same contact could both insert. That is a duplicate THREAD,
                // not a duplicate message: both reminders still go out once
                // each, and the identity service merges the threads. Losing the
                // reminder to avoid a merge would be the worse trade.
                `INSERT INTO conversations(contact_id, channel_type, channel_account_id, status)
                 VALUES($1::uuid, $2, $3, 'active') RETURNING id`,
                [input.contactId, input.channelType, input.channelAccountId]);
            return created?.id ? String(created.id) : null;
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
     * Commit this effect, then publish it. In that order, always.
     *
     * Returns the origin id, so a caller can record what it wrote, and `null`
     * only when the outbox refused the batch — which it does for a binding that
     * names a conversation belonging to another contact, and for a second batch
     * whose SHAPE disagrees with the first. Both are conflicts to surface, not
     * to paper over.
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
    }): Promise<string | null> {
        const originId = ProactiveDispatchService.originId(input.originKey);
        const binding = {
            conversationId: input.conversationId,
            contactId: input.contactId,
            inboundMessageId: originId,
            channelType: input.channelType,
            channelAccountId: input.channelAccountId,
            recipient: input.recipient,
        };
        const prepared = await this.outbox.prepare(tenantId, {
            binding, items: input.items,
            operationalScope: input.operationalScope,
            originKind: 'proactive',
        });
        // Published AFTER the rows are committed, and a failure to publish is
        // not a failure to send: the row is the record, and the recovery pass
        // reads it. This is exactly the asymmetry the durable lane exists for.
        await this.outbox.publishBatch(tenantId, prepared.rows,
            (dispatchId, delayMs) => this.queue.enqueueDispatch(tenantId, dispatchId, delayMs));
        return originId;
    }
}
