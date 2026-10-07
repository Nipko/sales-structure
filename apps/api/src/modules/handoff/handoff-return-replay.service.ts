import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { OnEvent } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import type { NormalizedMessage } from '@parallext/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { InboundQueueService } from '../inbound/inbound-queue.service';
import { providerMessageId, turnDoneKey } from '../../common/utils/provider-message-id.util';
import { foldedContent, mergeBurst, type BurstFragment } from '../conversations/burst-fragments';
import { RETURN_REPLAY_MESSAGE_FLAG } from '../conversations/handoff-return-replay-turn';
import { hasDispatchOutbox, noHumanReplySql } from './handoff-human-reply';

/** How many of the customer's waiting messages are folded into the one answer. */
const MAX_WAITING_MESSAGES = 8;
const MAX_WAITING_CHARS = 4000;
const ENQUEUE_ATTEMPTS = 3;
/** A replay that keeps failing is given up after this many claims. */
export const MAX_REPLAY_CLAIMS = 5;
const MEDIA_TYPES = new Set(['image', 'audio', 'video', 'document']);

export type ReturnReplayResult =
    | { readonly kind: 'enqueued'; readonly jobIdSuffix: string }
    | { readonly kind: 'answered_in_widget' }
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
 * This listens to the sweep's `handoff.returned_unattended` event (and to the
 * sweep's catch-up pass, which re-emits it for a replay that never happened) and
 * runs the normal turn once more over what the customer sent while waiting. It
 * adds no second way to answer: the turn is the same one, so the return notice
 * is prepended by `claimReturnNotice` inside the SAME durable batch, and the
 * opt-out detection, the persona, the business hours and the channel windows
 * apply exactly as for any message. What is different about that turn is in
 * `conversations/handoff-return-replay-turn.ts`.
 *
 * ── WHY IT IS SAFE TO RUN A SECOND TIME OVER A STORED MESSAGE ───────────────
 *  · One claim per handoff episode. `returnReplayFor` stores the `startedAt` it
 *    was taken for, so a second event, a second sweep process, or a catch-up pass
 *    finds it taken. The claim also needs status `active`, `returnNoticePending`
 *    and NO human reply since the handoff (the rule the sweep uses). Only a
 *    transient failure gives it back, and at most `MAX_REPLAY_CLAIMS` times.
 *  · The stored inbound row is the message. The rebuilt message carries the same
 *    provider id, so `saveMessage` finds the existing row (no duplicate inbound)
 *    and the outbox identifies the answer by that inbound — free for it, because
 *    the queue notice has its own identity.
 *  · The queue job has a distinct id per episode (BullMQ drops a repeat) and the
 *    `turn:done` marker that the skipped turn left is cleared, or the pipeline
 *    would take the replay for a redelivery of an answered message.
 *  · A queue-channel message without a provider id cannot be deduplicated, so it
 *    is not replayed. The web chat has no queue and no provider ids: its turn is
 *    run directly, and its reply receipt is keyed by the inbound message.
 */
@Injectable()
export class HandoffReturnReplayService {
    private readonly logger = new Logger(HandoffReturnReplayService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
        private readonly inboundQueue: InboundQueueService,
        /** ConversationsService imports this module, so it is resolved lazily. */
        private readonly moduleRef: ModuleRef,
    ) {}

    @OnEvent('handoff.returned_unattended', { async: true })
    async onReturned(event: { tenantId: string; schemaName?: string; conversationId: string }): Promise<void> {
        try {
            const result = await this.replayWaitingMessages(event);
            if (result.kind === 'skipped') {
                this.logger.log(`[HandoffReplay] ${event?.conversationId} not replayed: ${result.reason}`);
            }
        } catch (error: any) {
            // The customer is not told anything went wrong; the sweep's catch-up
            // pass tries again until the claims run out.
            this.logger.error(`[HandoffReplay] ${event?.conversationId} could not be replayed: ${error?.message}`);
        }
    }

    /** The conversation orchestrator, found lazily because it imports this module. */
    protected async conversationsService(): Promise<any> {
        const { ConversationsService } = await import('../conversations/conversations.service');
        return this.moduleRef.get(ConversationsService, { strict: false });
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
                SET metadata = jsonb_set(jsonb_set(jsonb_set(COALESCE(c.metadata, '{}'::jsonb),
                        '{handoff,returnReplayFor}', to_jsonb(c.metadata->'handoff'->>'startedAt'), true),
                        '{handoff,returnReplayClaimedAt}',
                        to_jsonb(to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')), true),
                        '{handoff,returnReplayClaims}',
                        to_jsonb(COALESCE((c.metadata->'handoff'->>'returnReplayClaims')::int, 0) + 1), true)
              WHERE c.id = $1::uuid
                AND c.status = 'active'
                AND c.metadata->'handoff'->>'returnedToAi' = 'true'
                AND c.metadata->'handoff'->>'returnNoticePending' = 'true'
                AND c.metadata->'handoff'->>'startedAt' IS NOT NULL
                AND COALESCE(c.metadata->'handoff'->>'returnReplayFor', '') <> c.metadata->'handoff'->>'startedAt'
                AND COALESCE((c.metadata->'handoff'->>'returnReplayClaims')::int, 0) < ${MAX_REPLAY_CLAIMS}
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
            // Every skip below is permanent: retrying cannot change it, so the claim stays taken.
            if (!last) return { kind: 'skipped', reason: 'no_waiting_message' };
            const content = this.foldedWaitingContent(waiting.slice().reverse());

            // ── 3a. The web chat: no queue, no provider ids — run its turn directly ──
            if (episode.channel_type === 'web_widget') {
                const conversations = await this.conversationsService();
                if (!conversations?.processWidgetMessage) throw new Error('widget_turn_unavailable');
                await conversations.processWidgetMessage(
                    tenantId, schemaName, conversationId, String(episode.contact_id), content.text ?? '',
                    {
                        channelAccountId: String(episode.channel_account_id || 'widget'),
                        inboundMessageId: String(last.id),
                        allowHumanHandoff: false,
                        handoffReturnReplay: true,
                    });
                this.logger.log(`[HandoffReplay] Answered ${waiting.length} waiting widget message(s) of ${conversationId}`);
                return { kind: 'answered_in_widget' };
            }

            // ── 3b. Queue channels ──
            if (!last.external_id) return { kind: 'skipped', reason: 'last_message_has_no_provider_id' };
            const [contact] = await run('SELECT external_id FROM contacts WHERE id = $1::uuid', [episode.contact_id]);
            if (!contact?.external_id || !episode.channel_account_id) {
                return { kind: 'skipped', reason: 'sender_unknown' };
            }

            // ── 4. Rebuild the message exactly as the channel delivered it ──
            const metadata = { ...(last.metadata && typeof last.metadata === 'object' ? last.metadata : {}) } as Record<string, unknown>;
            const message: NormalizedMessage = {
                id: randomUUID(),
                tenantId,
                channelType: episode.channel_type,
                channelAccountId: String(episode.channel_account_id),
                contactId: String(contact.external_id),
                conversationId,
                direction: 'inbound',
                content: content as NormalizedMessage['content'],
                timestamp: last.created_at instanceof Date ? last.created_at : new Date(last.created_at),
                status: 'delivered' as NormalizedMessage['status'],
                metadata: { ...metadata, [RETURN_REPLAY_MESSAGE_FLAG]: true },
            };
            // The identity that makes the replay land on the row it already has.
            const pmid = providerMessageId(message);
            if (!pmid || pmid !== String(last.external_id)) {
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
            // Nothing was answered: give the claim back so the catch-up pass can retry.
            await release();
            throw error;
        }
    }

    /**
     * Everything the customer typed while waiting, folded as the burst debounce
     * folds a burst: texts and captions in order, the attachment of the LAST
     * message (when the stored row still names it) carrying them.
     */
    private foldedWaitingContent(ordered: any[]): {
        type: string; text?: string; caption?: string; mediaUrl?: string; mediaId?: string; mimeType?: string; filename?: string;
    } {
        const fragments = ordered.map((row: any): BurstFragment | null => {
            const type = String(row.content_type || 'text');
            const text = typeof row.content_text === 'string' ? row.content_text.trim() : '';
            if (type === 'text' || !MEDIA_TYPES.has(type)) return text ? { kind: 'text', text } : null;
            const meta = (row.metadata && typeof row.metadata === 'object' ? row.metadata : {}) as Record<string, any>;
            return {
                kind: 'media', type,
                mediaUrl: row.media_url ?? meta.mediaUrl ?? null,
                mediaId: meta.mediaId ?? null,
                mimeType: row.media_mime_type ?? null,
                filename: meta.filename ?? null,
                caption: (row.caption || text || null),
            };
        }).filter((fragment): fragment is BurstFragment => !!fragment);
        const merged = mergeBurst(fragments);
        const lastFragment = fragments[fragments.length - 1] ?? null;
        const folded = foldedContent(lastFragment, merged);
        const text = folded.text.slice(-MAX_WAITING_CHARS);
        if (folded.type !== 'text' && lastFragment?.kind === 'media' && (lastFragment.mediaUrl || lastFragment.mediaId)) {
            return {
                type: folded.type,
                ...(text ? { caption: text } : {}),
                ...(lastFragment.mediaUrl ? { mediaUrl: String(lastFragment.mediaUrl) } : {}),
                ...(lastFragment.mediaId ? { mediaId: String(lastFragment.mediaId) } : {}),
                ...(lastFragment.mimeType ? { mimeType: String(lastFragment.mimeType) } : {}),
                ...(lastFragment.filename ? { filename: String(lastFragment.filename) } : {}),
            };
        }
        // An attachment the stored row no longer names cannot be fetched again: what
        // the customer wrote around it is still answered.
        return { type: 'text', text };
    }
}
