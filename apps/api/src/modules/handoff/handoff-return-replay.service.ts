import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import type { NormalizedMessage } from '@parallext/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { InboundQueueService } from '../inbound/inbound-queue.service';
import { ComplianceService } from '../analytics/compliance.service';
import { providerMessageId, turnDoneKey } from '../../common/utils/provider-message-id.util';
import { hasDispatchOutbox, noHumanReplySql } from './handoff-human-reply';

/** How many of the customer's waiting messages are folded into the one answer. */
const MAX_WAITING_MESSAGES = 8;
const MAX_WAITING_CHARS = 4000;
const ENQUEUE_ATTEMPTS = 3;

export type ReturnReplayResult =
    | { readonly kind: 'enqueued'; readonly jobIdSuffix: string }
    | { readonly kind: 'skipped'; readonly reason: string };

/**
 * ═══ AFTER AN UNATTENDED HANDOFF RETURNS, THE CUSTOMER GETS AN ANSWER ═══
 *
 * The sweep (`HandoffService.returnUnattendedHandoffs`) gives a conversation back
 * to the agent only when the customer wrote after the handoff started, and it
 * sets `returnNoticePending`. But the return notice was only ever claimed when
 * the NEXT inbound arrived, so the customer who had been waiting stayed in
 * silence until they wrote again (observed: 14 minutes more).
 *
 * This listens to the sweep's `handoff.returned_unattended` event and runs the
 * normal inbound turn once more over what the customer sent while waiting. It
 * adds no second way to answer: the turn is the same one, so the return notice
 * is prepended by `claimReturnNotice` inside the SAME durable batch, and the
 * opt-out detection, the persona, the business hours and the channel windows
 * apply exactly as for any message.
 *
 * ── WHY IT IS SAFE TO RUN A SECOND TIME OVER A STORED MESSAGE ───────────────
 *  · One claim per handoff episode. `returnReplayFor` stores the `startedAt` it
 *    was taken for, so a second event, a second sweep process, or a retry finds
 *    it taken. The claim also needs status `active`, `returnNoticePending` and
 *    NO human reply since the handoff (the same rule the sweep uses): a person
 *    who answered in the meantime is never contradicted.
 *  · The stored inbound row is the message. The rebuilt message carries the same
 *    provider id, so `saveMessage` finds the existing row (no duplicate inbound)
 *    and the outbox identifies the answer by that inbound — free for it, because
 *    the queue notice now has its own identity.
 *  · The queue job has a distinct id per episode (BullMQ drops a repeat) and the
 *    `turn:done` marker that the skipped turn left is cleared, or the pipeline
 *    would take the replay for a redelivery of an answered message.
 *  · A message without a provider id (widget, tests) cannot be deduplicated, so
 *    it is not replayed: inserting it twice would be worse than the silence.
 */
@Injectable()
export class HandoffReturnReplayService {
    private readonly logger = new Logger(HandoffReturnReplayService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
        private readonly inboundQueue: InboundQueueService,
        private readonly compliance: ComplianceService,
    ) {}

    @OnEvent('handoff.returned_unattended', { async: true })
    async onReturned(event: { tenantId: string; schemaName?: string; conversationId: string }): Promise<void> {
        try {
            const result = await this.replayWaitingMessages(event);
            if (result.kind === 'skipped') {
                this.logger.log(`[HandoffReplay] ${event?.conversationId} not replayed: ${result.reason}`);
            }
        } catch (error: any) {
            // The customer is not told anything went wrong, and nothing can be
            // retried from here: say so loudly.
            this.logger.error(`[HandoffReplay] ${event?.conversationId} could not be replayed: ${error?.message}`);
        }
    }

    async replayWaitingMessages(event: {
        tenantId: string; schemaName?: string; conversationId: string;
    }): Promise<ReturnReplayResult> {
        const { tenantId, conversationId } = event || ({} as any);
        if (!tenantId || !conversationId) return { kind: 'skipped', reason: 'invalid_event' };
        const schemaName = event.schemaName
            || (await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { schemaName: true } }))?.schemaName;
        if (!schemaName) return { kind: 'skipped', reason: 'tenant_schema_unavailable' };
        const run = (sql: string, params: any[]) => this.prisma.executeInTenantSchema<any[]>(schemaName, sql, params);

        // ── 1. The claim: one per episode, and only while nobody human answered ──
        const hasOutbox = await hasDispatchOutbox(run, schemaName);
        const claimed = await run(
            `UPDATE conversations c
                SET metadata = jsonb_set(COALESCE(c.metadata, '{}'::jsonb), '{handoff,returnReplayFor}',
                        to_jsonb(c.metadata->'handoff'->>'startedAt'), true)
              WHERE c.id = $1::uuid
                AND c.status = 'active'
                AND c.metadata->'handoff'->>'returnedToAi' = 'true'
                AND c.metadata->'handoff'->>'returnNoticePending' = 'true'
                AND c.metadata->'handoff'->>'startedAt' IS NOT NULL
                AND COALESCE(c.metadata->'handoff'->>'returnReplayFor', '') <> c.metadata->'handoff'->>'startedAt'
                ${noHumanReplySql('c', hasOutbox)}
            RETURNING c.contact_id, c.channel_type, c.channel_account_id,
                      c.metadata->'handoff'->>'startedAt' AS started_at`,
            [conversationId],
        );
        if (!claimed?.length) return { kind: 'skipped', reason: 'not_claimable' };
        const episode = claimed[0];
        const release = () => run(
            `UPDATE conversations
                SET metadata = metadata #- '{handoff,returnReplayFor}'
              WHERE id = $1::uuid AND metadata->'handoff'->>'returnReplayFor' = $2`,
            [conversationId, String(episode.started_at)],
        ).catch((e: any) => this.logger.error(`[HandoffReplay] claim of ${conversationId} not released: ${e?.message}`));

        try {
            // ── 2. What the customer sent while waiting ──
            const waiting = await run(
                `SELECT id, content_type, content_text, media_url, media_mime_type, caption,
                        external_id, metadata, created_at
                   FROM messages
                  WHERE conversation_id = $1::uuid AND direction = 'inbound'
                    AND created_at > $2::timestamptz
                  ORDER BY created_at DESC, id DESC
                  LIMIT ${MAX_WAITING_MESSAGES}`,
                [conversationId, episode.started_at],
            );
            const last = waiting?.[0];
            if (!last) { await release(); return { kind: 'skipped', reason: 'no_waiting_message' }; }
            if (!last.external_id) {
                await release();
                return { kind: 'skipped', reason: 'last_message_has_no_provider_id' };
            }

            const [contact] = await run('SELECT external_id FROM contacts WHERE id = $1::uuid', [episode.contact_id]);
            if (!contact?.external_id || !episode.channel_account_id) {
                await release();
                return { kind: 'skipped', reason: 'sender_unknown' };
            }

            // ── 3. An opt-out among the waiting words wins over any answer ──
            // The turn detects it too, but only on the text it is handed; asking
            // here keeps a customer who wrote STOP while waiting out of the queue.
            const texts = waiting.slice().reverse()
                .filter((m: any) => m.content_type === 'text' && typeof m.content_text === 'string' && m.content_text.trim())
                .map((m: any) => String(m.content_text).trim());
            if (texts.some((t: string) => this.compliance.detectOptOut(t))) {
                // Left claimed on purpose: the episode is over, nothing may follow.
                return { kind: 'skipped', reason: 'customer_opted_out' };
            }

            // ── 4. Rebuild the message exactly as the channel delivered it ──
            const metadata = { ...(last.metadata && typeof last.metadata === 'object' ? last.metadata : {}) } as Record<string, unknown>;
            const lastIsText = last.content_type === 'text';
            const combined = lastIsText ? texts.join('\n').slice(-MAX_WAITING_CHARS) : undefined;
            const message: NormalizedMessage = {
                id: randomUUID(),
                tenantId,
                channelType: episode.channel_type,
                channelAccountId: String(episode.channel_account_id),
                contactId: String(contact.external_id),
                conversationId,
                direction: 'inbound',
                content: {
                    type: last.content_type || 'text',
                    ...(lastIsText
                        ? { text: combined }
                        : {
                            ...(last.content_text ? { text: String(last.content_text) } : {}),
                            ...(last.media_url ? { mediaUrl: String(last.media_url) } : {}),
                            ...(last.media_mime_type ? { mimeType: String(last.media_mime_type) } : {}),
                            ...(last.caption ? { caption: String(last.caption) } : {}),
                        }),
                } as NormalizedMessage['content'],
                timestamp: last.created_at instanceof Date ? last.created_at : new Date(last.created_at),
                status: 'delivered' as NormalizedMessage['status'],
                metadata: { ...metadata, handoffReturnReplay: true },
            };
            // The identity that makes the replay land on the row it already has.
            const pmid = providerMessageId(message);
            if (!pmid || pmid !== String(last.external_id)) {
                await release();
                return { kind: 'skipped', reason: 'provider_id_not_recoverable' };
            }

            // ── 5. Re-open the turn and hand it to the normal queue ──
            const jobIdSuffix = `handoff-return-${Date.parse(String(episode.started_at)) || String(episode.started_at)}`;
            await this.redis.del(turnDoneKey(tenantId, pmid)).catch(() => { /* best-effort: absent is fine */ });
            let lastError: unknown;
            for (let attempt = 1; attempt <= ENQUEUE_ATTEMPTS; attempt++) {
                try {
                    await this.inboundQueue.enqueue(message, { jobIdSuffix });
                    this.logger.log(`[HandoffReplay] Re-processing ${waiting.length} waiting message(s) of ${conversationId} (trace=${pmid})`);
                    return { kind: 'enqueued', jobIdSuffix };
                } catch (error) {
                    lastError = error;
                    if (attempt < ENQUEUE_ATTEMPTS) await new Promise(r => setTimeout(r, 250 * attempt));
                }
            }
            throw lastError;
        } catch (error) {
            // Nothing was queued: give the claim back so a second event can retry.
            await release();
            throw error;
        }
    }
}
