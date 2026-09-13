import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { PersonaService } from '../persona/persona.service';
import { LLMRouterService } from '../ai/router/llm-router.service';
import { ChannelTokenService } from '../channels/channel-token.service';
import { ProactiveSendConnection } from '../channels/proactive-connection';
import { ComplianceService } from '../analytics/compliance.service';
import type { DispatchItem } from '../channels/agent-dispatch-outbox';
import { ProactiveDispatchService, effectIsDurable } from '../channels/proactive-dispatch.service';
import { nurtureMsg, LANG_NAME } from './nurturing-i18n';
import { CronLockService } from '../redis/cron-lock.service';
import { PipelineService } from '../pipeline/pipeline.service';
import { mutateTenantSettingsBranchAtomic } from '../../common/utils/tenant-settings-branch.util';

export const NURTURING_QUEUE = 'nurturing';

export interface NurturingJobData {
    tenantId: string;
    conversationId: string;
    leadId: string;
    attempt: number;
}

/** Default delay per attempt in seconds: 4h, 24h, 72h */
const DEFAULT_DELAYS = [14400, 86400, 259200];
const DEFAULT_MAX_ATTEMPTS = 3;

export interface NurturingConfig {
    enabled: boolean;
    maxAttempts: number;
    delays: number[];
    allowedChannels: string[];
    finalAction: 'mark_not_interested' | 'create_task';
    /** WhatsApp template name to use outside 24h window. If empty, no message sent outside window */
    whatsappTemplateName?: string;
    /** Max 1 nurturing message per conversation per day */
    maxPerDay: number;
}

@Injectable()
export class NurturingService {
    private readonly logger = new Logger(NurturingService.name);

    constructor(
        @InjectQueue(NURTURING_QUEUE)
        private readonly nurturingQueue: Queue<NurturingJobData>,
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
        private readonly personaService: PersonaService,
        private readonly llmRouter: LLMRouterService,
        private readonly channelToken: ChannelTokenService,
        // A follow-up inherits its conversation's number when there is one and
        // raises a task for the business when there is not. Never the oldest.
        private readonly connections: ProactiveSendConnection,
        private readonly compliance: ComplianceService,
        /**
         * The durable lane, which a nudge could not use before.
         *
         * The in-window text went onto the legacy queue, where Redis is the
         * only record and nothing carries an identity; the out-of-window
         * template went straight to the adapter. Neither could be re-checked
         * against the conversation, so a nudge asking whether anybody was still
         * there could arrive a minute after the customer wrote — the most
         * irritating thing this lane can do, and billed.
         */
        private readonly proactive: ProactiveDispatchService,
        private readonly cronLock: CronLockService,
        private readonly pipelineService: PipelineService,
    ) {}

    // ─── Public API ──────────────────────────────────────────────────

    /**
     * Schedule a follow-up check for a conversation.
     * Called after AI sends a response, so we can follow up if the customer goes silent.
     */
    async scheduleFollowUp(tenantId: string, conversationId: string, leadId: string): Promise<void> {
        const config = await this.getNurturingConfig(tenantId);
        if (!config.enabled) return;

        const attempt = 1;
        const delayMs = (config.delays[0] ?? DEFAULT_DELAYS[0]) * 1000;
        const jobId = this.buildJobId(tenantId, conversationId, attempt);

        // Only schedule if no job already pending for attempt 1
        const existing = await this.nurturingQueue.getJob(jobId);
        if (existing) {
            const state = await existing.getState();
            if (state === 'waiting' || state === 'delayed') {
                this.logger.debug(`Follow-up already scheduled for conversation ${conversationId} attempt ${attempt}`);
                return;
            }
        }

        await this.nurturingQueue.add('follow-up', {
            tenantId,
            conversationId,
            leadId,
            attempt,
        }, {
            jobId,
            delay: delayMs,
            attempts: 2,
            backoff: { type: 'fixed', delay: 30_000 },
            removeOnComplete: { age: 3600 },
            removeOnFail: { age: 86400 },
        });

        this.logger.log(
            `Scheduled nurturing follow-up for conversation ${conversationId} ` +
            `attempt ${attempt} in ${delayMs / 1000}s`,
        );
    }

    /**
     * Cancel ALL pending follow-up jobs for a conversation.
     * Called when a customer responds — we no longer need to nudge them.
     */
    async cancelFollowUp(tenantId: string, conversationId: string): Promise<void> {
        const config = await this.getNurturingConfig(tenantId);
        const maxAttempts = config.maxAttempts || DEFAULT_MAX_ATTEMPTS;

        let cancelled = 0;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            const jobId = this.buildJobId(tenantId, conversationId, attempt);
            try {
                const job = await this.nurturingQueue.getJob(jobId);
                if (job) {
                    const state = await job.getState();
                    if (state === 'waiting' || state === 'delayed') {
                        await job.remove();
                        cancelled++;
                    }
                }
            } catch (e: any) {
                this.logger.warn(`Could not cancel nurturing job ${jobId}: ${e.message}`);
            }
        }

        if (cancelled > 0) {
            this.logger.log(`Cancelled ${cancelled} nurturing job(s) for conversation ${conversationId}`);
        }
    }

    /**
     * Execute a follow-up attempt. Called by the queue processor.
     */
    async executeFollowUp(tenantId: string, conversationId: string, leadId: string, attempt: number): Promise<void> {
        const schemaName = await this.tenantSchema(tenantId);
        const config = await this.getNurturingConfig(tenantId);
        const maxAttempts = config.maxAttempts || DEFAULT_MAX_ATTEMPTS;

        this.logger.log(`Executing nurturing follow-up: tenant=${tenantId} conv=${conversationId} attempt=${attempt}`);

        // 1. Check if customer has responded since we scheduled
        const hasResponded = await this.hasCustomerRespondedSince(schemaName, conversationId, attempt);
        if (hasResponded) {
            this.logger.log(`Customer responded in conversation ${conversationId} — skipping follow-up`);
            return;
        }

        // 2. Check if conversation is in human handoff
        const conversation = await this.getConversation(schemaName, conversationId);
        if (!conversation) {
            this.logger.warn(`Conversation ${conversationId} not found — skipping follow-up`);
            return;
        }
        if (conversation.status === 'waiting_human' || conversation.status === 'with_human') {
            this.logger.log(`Conversation ${conversationId} is in handoff — skipping follow-up`);
            return;
        }
        if (conversation.status === 'resolved' || conversation.status === 'archived') {
            this.logger.log(`Conversation ${conversationId} is ${conversation.status} — skipping follow-up`);
            return;
        }

        // 3. Past the last attempt: this is the CLOSING PASS, not a nudge.
        //
        // The final action used to run in the same breath as the farewell, and
        // resolving the conversation makes its own revision `gone` — the policy
        // reads a resolved thread as one nobody should be writing into. The
        // farewell, still waiting for a lease, would have been suppressed. So
        // the closure is a pass of its own and it waits for that effect.
        if (attempt > maxAttempts) {
            await this.closeAfterFinalFollowUp(tenantId, schemaName, conversationId, maxAttempts, config);
            return;
        }

        // 4. Load conversation context for follow-up generation
        const contact = await this.getContact(schemaName, conversationId);
        const lastMessages = await this.getRecentMessages(schemaName, conversationId, 5);

        // ═══ THE ATTEMPT IS RECORDED FIRST, AND UNRECORDED IF NOTHING LEFT ═══
        //
        // `nurturing_last_attempt` is part of this conversation's revision — so
        // that a nudge prepared under one attempt cannot be delivered as
        // another — and the effect sits on the lane until it gets a lease.
        // Recording the attempt AFTER preparing would make every nudge stale at
        // admission and none would ever arrive.
        //
        // So it is written first and restored when no durable effect exists.
        // The end state is the invariant: the conversation never records an
        // attempt the customer was never sent.
        const previousAttempt = await this.readAttemptMarker(schemaName, conversationId);
        await this.recordAttempt(schemaName, conversationId, attempt);
        let delivered = false;
        try {
            if (attempt === 1) {
                delivered = await this.executeAttempt1(
                    tenantId, schemaName, conversationId, contact, lastMessages, attempt);
            } else if (attempt === 2) {
                delivered = await this.executeAttempt2(
                    tenantId, schemaName, conversationId, contact, attempt);
            } else if (attempt >= 3) {
                delivered = await this.executeAttempt3(
                    tenantId, schemaName, conversationId, leadId, contact, config, attempt);
            }
        } finally {
            if (!delivered) {
                await this.restoreAttemptMarker(schemaName, conversationId, previousAttempt);
            }
        }

        // 7. Schedule what comes next: another nudge, or the closing pass.
        if (attempt < maxAttempts) {
            await this.scheduleNextFollowUp(tenantId, conversationId, leadId, attempt + 1, config);
        } else if (delivered && (config.finalAction || 'mark_not_interested') === 'mark_not_interested') {
            await this.nurturingQueue.add('follow-up',
                { tenantId, conversationId, leadId, attempt: maxAttempts + 1 }, {
                    jobId: this.buildJobId(tenantId, conversationId, maxAttempts + 1),
                    // Long enough for the lane to admit the farewell, and
                    // BullMQ's own backoff is what it waits with when it is not.
                    delay: 30_000,
                    attempts: 5,
                    backoff: { type: 'fixed', delay: 30_000 },
                    removeOnComplete: { age: 3600 },
                    removeOnFail: { age: 86400 },
                });
        }
    }

    /**
     * Close the conversation after the last nudge, once that nudge is out.
     *
     * `prepared` and `queued` are the two states in which the admission — and
     * with it the revalidation of this conversation — has not happened yet.
     * Resolving the thread before then turns the farewell into a suppression;
     * afterwards the lease is granted and the POST no longer depends on it.
     */
    private async closeAfterFinalFollowUp(
        tenantId: string, schemaName: string, conversationId: string,
        maxAttempts: number, config: NurturingConfig,
    ): Promise<void> {
        if ((config.finalAction || 'mark_not_interested') !== 'mark_not_interested') return;
        if (await this.followUpAwaitingAdmission(schemaName, conversationId, maxAttempts)) {
            throw new Error(`nurturing_farewell_awaiting_admission:${conversationId}`);
        }
        await this.prisma.executeInTenantSchema(schemaName,
            `UPDATE conversations SET status = 'resolved', resolved_at = NOW() WHERE id = $1::uuid`,
            [conversationId]);
        this.logger.log(`Conversation ${conversationId} resolved after the final follow-up`);
    }

    /** Is the last nudge still waiting for a lease? An outage answers "yes". */
    private async followUpAwaitingAdmission(
        schemaName: string, conversationId: string, attempt: number,
    ): Promise<boolean> {
        const originId = ProactiveDispatchService.originId(
            `nurturing_followup:${conversationId}:attempt:${attempt}`);
        try {
            // Asked separately: a missing table is a PARSE failure, so it
            // cannot be guarded inside the query that reads it.
            const [present] = await this.prisma.executeInTenantSchema<any[]>(
                schemaName, 'SELECT to_regclass($1)::text AS relation',
                [`${schemaName}.agent_dispatch_outbox`]);
            if (!present?.relation) return false;
            const rows = await this.prisma.executeInTenantSchema<any[]>(schemaName,
                `SELECT state FROM agent_dispatch_outbox
                  WHERE inbound_message_id = $1::uuid AND state IN ('prepared','queued')
                  LIMIT 1`, [originId]);
            return !!rows?.length;
        } catch (e: any) {
            this.logger.warn(`Could not read the last follow-up of ${conversationId}: ${e.message}`);
            return true;
        }
    }

    /** What the conversation currently claims about its last nurturing attempt. */
    private async readAttemptMarker(schemaName: string, conversationId: string): Promise<string | null> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `SELECT metadata->>'nurturing_last_attempt' AS attempt
               FROM conversations WHERE id = $1::uuid`, [conversationId]);
        return rows?.[0]?.attempt ?? null;
    }

    /** Put it back. A record of an attempt that never left is a lie in the file. */
    private async restoreAttemptMarker(
        schemaName: string, conversationId: string, previous: string | null,
    ): Promise<void> {
        await this.prisma.executeInTenantSchema(schemaName,
            previous === null
                ? `UPDATE conversations
                      SET metadata = (COALESCE(metadata, '{}'::jsonb) - 'nurturing_last_attempt')
                    WHERE id = $1::uuid`
                : `UPDATE conversations
                      SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb),
                          '{nurturing_last_attempt}', $2::text::jsonb)
                    WHERE id = $1::uuid`,
            previous === null ? [conversationId] : [conversationId, previous]);
    }

    /**
     * Cron: every 6 hours, auto-resolve conversations with no message in 72 hours.
     */
    @Cron('0 */6 * * *')
    async autoResolveStale(): Promise<void> {
        this.logger.log('[Cron] Auto-resolving stale conversations (72h no activity)...');

        try {
            const tenants = await this.prisma.$queryRaw<any[]>`
                SELECT id, schema_name FROM tenants WHERE is_active = true
            `;
            if (!tenants || tenants.length === 0) return;

            let totalResolved = 0;
            for (const tenant of tenants) {
                try {
                    // `waiting_human` was excluded, so a conversation escalated to
                    // a person nobody ever picked up stayed open forever with the
                    // AI muted: every later message from that customer was stored
                    // in silence. Three days without a human is not a handoff in
                    // progress, it is an abandoned one — resolving it hands the
                    // customer back to an agent that will at least answer.
                    const result = await this.prisma.executeInTenantSchema<any[]>(
                        tenant.schema_name,
                        `UPDATE conversations
                         SET status = 'resolved', resolved_at = NOW()
                         WHERE status IN ('active', 'waiting_human')
                           AND updated_at < NOW() - INTERVAL '72 hours'
                           AND id NOT IN (
                               SELECT DISTINCT conversation_id FROM messages
                               WHERE created_at > NOW() - INTERVAL '72 hours'
                           )
                         RETURNING id`,
                        [],
                        { timeout: 30000 },
                    );

                    // Mark auto-resolved conversations for AI resolution tracking
                    if (result?.length) {
                        const ids = result.map((r: any) => r.id);
                        await this.prisma.executeInTenantSchema(
                            tenant.schema_name,
                            `UPDATE conversations SET resolution_type = 'auto_resolved' WHERE id = ANY($1::uuid[])`,
                            [ids],
                        ).catch(() => {}); // Column may not exist yet on older tenants
                    }
                    const count = result?.length || 0;
                    if (count > 0) {
                        this.logger.log(`Auto-resolved ${count} stale conversation(s) for tenant ${tenant.id}`);
                        totalResolved += count;
                    }
                } catch (e: any) {
                    this.logger.warn(`Auto-resolve failed for tenant ${tenant.id}: ${e.message}`);
                }
            }

            this.logger.log(`[Cron] Auto-resolve complete: ${totalResolved} conversation(s) resolved`);
        } catch (e: any) {
            this.logger.error(`[Cron] Auto-resolve stale failed: ${e.message}`);
        }
    }

    /**
     * Cron: every 2 hours, scan for stale conversations that need follow-up.
     */
    @Cron('0 */2 * * *')
    async checkStaleConversationsAllTenants(): Promise<void> {
        this.logger.log('[Cron] Checking stale conversations across all tenants...');

        try {
            const tenants = await this.prisma.$queryRaw<any[]>`
                SELECT id, schema_name FROM tenants WHERE is_active = true
            `;
            if (!tenants || tenants.length === 0) return;

            for (const tenant of tenants) {
                try {
                    await this.checkStaleConversations(tenant.id, tenant.schema_name);
                } catch (e: any) {
                    this.logger.warn(`Stale check failed for tenant ${tenant.id}: ${e.message}`);
                }
            }
        } catch (e: any) {
            this.logger.error(`[Cron] Stale conversations check failed: ${e.message}`);
        }
    }

    /**
     * Find active conversations with no customer message in last 4 hours
     * that don't already have a follow-up scheduled.
     */
    async checkStaleConversations(tenantId: string, schemaName?: string): Promise<void> {
        const schema = schemaName || await this.tenantSchema(tenantId);
        const config = await this.getNurturingConfig(tenantId);
        if (!config.enabled) return;

        // Find conversations where the last message is outbound and older than the first delay
        const staleThresholdSeconds = config.delays[0] ?? DEFAULT_DELAYS[0];

        const staleConversations = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `SELECT c.id AS conversation_id, l.id AS lead_id
             FROM conversations c
             JOIN contacts ct ON ct.id = c.contact_id
             JOIN leads l ON l.contact_id = ct.id
             WHERE c.status = 'active'
               AND c.updated_at < NOW() - INTERVAL '1 second' * $1
               AND NOT EXISTS (
                   SELECT 1 FROM messages m
                   WHERE m.conversation_id = c.id
                     AND m.direction = 'inbound'
                     AND m.created_at > NOW() - INTERVAL '1 second' * $1
               )
               AND EXISTS (
                   SELECT 1 FROM messages m2
                   WHERE m2.conversation_id = c.id
                     AND m2.direction = 'outbound'
               )
             LIMIT 50`,
            [staleThresholdSeconds],
            { timeout: 30000 },
        );

        if (!staleConversations || staleConversations.length === 0) return;

        this.logger.log(`Found ${staleConversations.length} stale conversations for tenant ${tenantId}`);

        for (const row of staleConversations) {
            try {
                await this.scheduleFollowUp(tenantId, row.conversation_id, row.lead_id);
            } catch (e: any) {
                this.logger.warn(`Failed to schedule follow-up for stale conv ${row.conversation_id}: ${e.message}`);
            }
        }
    }

    // ─── Abandoned booking follow-ups (#11 — "sales agent") ──────────

    /** Mid-flow booking steps worth recovering (everything except idle/booked). */
    private static readonly MID_FLOW_BOOKING_STEPS = ['show_services', 'ask_date', 'show_slots', 'ask_name', 'ask_email', 'confirm'];

    /**
     * Cron: every 2h, recover bookings abandoned mid-flow. Unlike the generic
     * stale follow-up, this references WHAT the customer was booking (service/date)
     * for a far more compelling nudge — the highest-ROI "sales agent" behavior.
     */
    // Corre en UNA sola instancia: la API y el worker cargan el mismo
    // AppModule con ScheduleModule, asi que sin esto el cuerpo se
    // ejecuta dos veces. Ver CronLockService.
    @Cron('30 */2 * * *')
    async checkAbandonedBookingsAllTenantsCron() {
        await this.cronLock.runExclusive('nurturing.checkAbandonedBookingsAllTenants', 3600, () => this.checkAbandonedBookingsAllTenants());
    }

    async checkAbandonedBookingsAllTenants(): Promise<void> {
        this.logger.log('[Cron] Checking abandoned bookings across all tenants...');
        try {
            const tenants = await this.prisma.$queryRaw<any[]>`
                SELECT id, schema_name FROM tenants WHERE is_active = true
            `;
            for (const tenant of tenants || []) {
                try {
                    await this.checkAbandonedBookings(tenant.id, tenant.schema_name);
                } catch (e: any) {
                    this.logger.warn(`Abandoned-booking check failed for tenant ${tenant.id}: ${e.message}`);
                }
            }
        } catch (e: any) {
            this.logger.error(`[Cron] Abandoned bookings check failed: ${e.message}`);
        }
    }

    /**
     * Find conversations stuck mid-booking (2-24h, no customer reply since) that
     * we haven't nudged for this abandonment cycle, and send a booking-aware
     * follow-up. Gated on nurturing being enabled.
     */
    async checkAbandonedBookings(tenantId: string, schemaName?: string): Promise<void> {
        const schema = schemaName || await this.tenantSchema(tenantId);
        const config = await this.getNurturingConfig(tenantId);
        if (!config.enabled) return;

        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `SELECT c.id AS conversation_id, c.metadata->'bookingState' AS booking_state,
                    c.metadata->>'bookingStateUpdatedAt' AS booking_cycle
             FROM conversations c
             WHERE c.status = 'active'
               AND (c.metadata->'bookingState'->>'step') = ANY($1::text[])
               AND (c.metadata->>'bookingStateUpdatedAt') IS NOT NULL
               AND (c.metadata->>'bookingStateUpdatedAt')::timestamptz < NOW() - INTERVAL '2 hours'
               AND (c.metadata->>'bookingStateUpdatedAt')::timestamptz > NOW() - INTERVAL '24 hours'
               AND (
                   c.metadata->>'bookingFollowUpAt' IS NULL
                   OR (c.metadata->>'bookingFollowUpAt')::timestamptz < (c.metadata->>'bookingStateUpdatedAt')::timestamptz
               )
               AND NOT EXISTS (
                   SELECT 1 FROM messages m
                   WHERE m.conversation_id = c.id AND m.direction = 'inbound'
                     AND m.created_at > (c.metadata->>'bookingStateUpdatedAt')::timestamptz
               )
             LIMIT 50`,
            [NurturingService.MID_FLOW_BOOKING_STEPS],
            { timeout: 30000 },
        );

        if (!rows || rows.length === 0) return;
        this.logger.log(`Found ${rows.length} abandoned booking(s) for tenant ${tenantId}`);

        for (const row of rows) {
            try {
                await this.sendBookingFollowUp(tenantId, schema, row.conversation_id,
                    row.booking_state, String(row.booking_cycle ?? ''));
            } catch (e: any) {
                this.logger.warn(`Booking follow-up failed for conv ${row.conversation_id}: ${e.message}`);
            }
        }
    }

    private async sendBookingFollowUp(tenantId: string, schemaName: string, conversationId: string,
        bookingState: any, bookingCycle: string): Promise<void> {
        const contact = await this.getContact(schemaName, conversationId);
        if (!contact) return;

        const lang = await this.resolveFollowUpLanguage(schemaName, conversationId, tenantId);
        const text = await this.generateBookingFollowUpText(tenantId, contact, bookingState, lang);
        // Reuse the generic sender — it enforces opt-out, the 24h window, allowed
        // channels, the once-per-day cap, and commits the effect. Returns whether a
        // durable effect now exists.
        //
        // The abandonment CYCLE is what makes this nudge this nudge:
        // `bookingStateUpdatedAt` is the instant the customer stopped, it is
        // what the query filters on, and it is durable. Two attempts at the
        // same abandonment collide on one row; a customer who abandons again
        // next week is a different effect.
        const sent = await this.sendFollowUpText(tenantId, schemaName, conversationId, contact, text,
            `booking:${bookingCycle || 'unknown'}`);

        // Mark this abandonment cycle as nudged ONLY if we actually sent — otherwise a
        // skip (opt-out / outside window / cap) would "burn" the follow-up without
        // delivering it, and a later tick (e.g. once the window reopens) could retry.
        if (!sent) return;
        await this.prisma.executeInTenantSchema(schemaName,
            `UPDATE conversations
             SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{bookingFollowUpAt}', to_jsonb(NOW()::text))
             WHERE id = $1::uuid`,
            [conversationId],
        );
    }

    /** Booking-aware follow-up copy — LLM in the agent's voice, with a safe fallback. */
    private async generateBookingFollowUpText(tenantId: string, contact: any, bookingState: any, lang = 'es'): Promise<string> {
        const name = contact?.name ? ` ${String(contact.name).split(' ')[0]}` : '';
        const svc = bookingState?.serviceName;
        const date = bookingState?.date;
        const time = bookingState?.time;
        const i18n = nurtureMsg(lang);
        const fallback = svc
            ? i18n.bookingFollowUpWithService(name, svc, date, time)
            : i18n.bookingFollowUpNoService(name);

        try {
            const persona = await this.personaService.getActivePersona(tenantId);
            if (!persona) return fallback;
            const ctx = [svc && `servicio: ${svc}`, date && `fecha: ${date}`, time && `hora: ${time}`].filter(Boolean).join(', ') || 'sin detalles';
            const langName = LANG_NAME[lang as keyof typeof LANG_NAME] || LANG_NAME.es;
            const response = await this.llmRouter.execute({
                task: 'conversation',
                messages: [{
                    role: 'user',
                    content: `Un cliente${name ? ` (${name.trim()})` : ''} empezó a agendar una cita pero la dejó a medias (${ctx}). ` +
                        `Genera UN mensaje breve, cálido y en ${langName} para invitarlo a retomar y completar la reserva, sin presionar. ` +
                        `Menciona naturalmente el servicio/fecha si los hay. Devuelve SOLO el mensaje.`,
                }],
                systemPrompt: this.personaService.buildSystemPrompt(persona),
                temperature: 0.8,
                tenantId,
            });
            return response.content?.trim() || fallback;
        } catch {
            return fallback;
        }
    }

    // ─── Private: Attempt Implementations ────────────────────────────

    /**
     * Attempt 1: Generate a contextual, gentle reminder via LLM.
     */
    private async executeAttempt1(
        tenantId: string,
        schemaName: string,
        conversationId: string,
        contact: any,
        lastMessages: any[],
        attempt: number,
    ): Promise<boolean> {
        const lang = await this.resolveFollowUpLanguage(schemaName, conversationId, tenantId);
        const i18n = nurtureMsg(lang);
        const effectKey = `attempt:${attempt}`;

        const personaConfig = await this.personaService.getActivePersona(tenantId);
        if (!personaConfig) {
            this.logger.warn(`No persona config for tenant ${tenantId} — sending default follow-up`);
            return this.sendFollowUpText(tenantId, schemaName, conversationId, contact,
                i18n.attempt1Default, effectKey);
        }

        // Build context for follow-up generation
        const historyContext = lastMessages
            .map(m => `${m.direction === 'inbound' ? 'Cliente' : 'Asistente'}: ${m.content_text}`)
            .join('\n');

        const langName = LANG_NAME[lang as keyof typeof LANG_NAME] || LANG_NAME.es;
        const followUpPrompt = `Eres un asistente de ventas amable y profesional. ` +
            `Genera un mensaje de seguimiento breve y natural en ${langName} para un cliente que no ha respondido. ` +
            `El mensaje debe ser gentil, no agresivo, y ofrecer valor. ` +
            `NO uses frases genéricas como "solo quería saber". Personaliza basándote en la conversación previa.\n\n` +
            `Contexto de la conversación:\n${historyContext}\n\n` +
            `Nombre del contacto: ${contact?.name || 'cliente'}\n` +
            `Genera SOLO el mensaje de seguimiento, sin explicaciones adicionales.`;

        try {
            const response = await this.llmRouter.execute({
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: followUpPrompt }],
                systemPrompt: this.personaService.buildSystemPrompt(personaConfig),
                temperature: 0.8,
                tenantId,
                routingFactors: {
                    ticketValue: 30,
                    complexity: 1,
                    conversationStage: 2,
                    sentiment: 0,
                    intentType: 1,
                },
            });

            const followUpText = response.content || i18n.attempt1SuccessFallback;
            return await this.sendFollowUpText(tenantId, schemaName, conversationId, contact,
                followUpText, effectKey);
        } catch (e: any) {
            this.logger.warn(`LLM follow-up generation failed, using fallback: ${e.message}`);
            return this.sendFollowUpText(tenantId, schemaName, conversationId, contact,
                i18n.attempt1CatchFallback, effectKey);
        }
    }

    /**
     * Attempt 2: Send a pre-approved template message with value proposition.
     */
    private async executeAttempt2(
        tenantId: string,
        schemaName: string,
        conversationId: string,
        contact: any,
        attempt = 2,
    ): Promise<boolean> {
        // ═══ THIS USED TO BYPASS EVERY GUARD THE OTHER TWO ATTEMPTS USE ═══
        //
        // It built its own outbound and put it on the queue directly, which
        // skipped, in order: the opt-out check, the allowed-channel list, the
        // one-per-day cap, and the 24-hour window. Then it logged "Attempt 2:
        // Template sent" — for a free-form text.
        //
        // Attempt 2 fires a day after the customer stopped replying, so it is
        // OUTSIDE the window almost by definition, and a free-form message
        // outside the window is refused by Meta. The whole attempt failed
        // silently, its catch sent another text that failed the same way, and
        // the conversation log said a template had gone out.
        //
        // It now goes through `sendFollowUpText`, like attempts 1 and 3 —
        // which, outside the window, sends the tenant's configured APPROVED
        // TEMPLATE and skips when there is none. The config field for that
        // template already existed and nothing had ever read it.
        const lang = await this.resolveFollowUpLanguage(schemaName, conversationId, tenantId);
        const i18n = nurtureMsg(lang);
        const sent = await this.sendFollowUpText(tenantId, schemaName, conversationId, contact,
            i18n.attempt2TemplateText(contact?.name || 'estimado cliente'), `attempt:${attempt}`);
        this.logger.log(`Attempt 2 for conversation ${conversationId}: `
            + `${sent ? 'sent' : 'not sent (opted out, capped, or no template outside the window)'}`);
        return sent;
    }

    /**
     * Attempt 3: Create a task for human agent + send final message.
     * If still no response after this, mark lead as not interested.
     */
    private async executeAttempt3(
        tenantId: string,
        schemaName: string,
        conversationId: string,
        leadId: string,
        contact: any,
        config: NurturingConfig,
        attempt = 3,
    ): Promise<boolean> {
        const lang = await this.resolveFollowUpLanguage(schemaName, conversationId, tenantId);
        const i18n = nurtureMsg(lang);

        // Send final "we're here if you need us" message
        const sent = await this.sendFollowUpText(tenantId, schemaName, conversationId, contact,
            i18n.attempt3FinalText(contact?.name || ''), `attempt:${attempt}`);

        // Create a task for human agent to review
        await this.prisma.executeInTenantSchema(schemaName,
            `INSERT INTO tasks (lead_id, title, description, type, status, due_at)
             VALUES ($1::uuid, $2, $3, 'follow_up', 'pending', NOW() + INTERVAL '24 hours')`,
            [
                leadId,
                `Seguimiento manual requerido — sin respuesta`,
                `El cliente ${contact?.name || '(sin nombre)'} no ha respondido después de 3 intentos automáticos de seguimiento. ` +
                `Conversación: ${conversationId}. Se recomienda contacto telefónico o revisar si el lead sigue activo.`,
            ],
        );

        this.logger.log(`Attempt 3: Task created for conversation ${conversationId}, lead ${leadId}`);

        // Apply final action: mark as not interested or just leave the task.
        //
        // The lead's stage is not part of the conversation's revision, so it
        // moves here. CLOSING THE CONVERSATION is — a resolved thread reads as
        // one nobody should be writing into — so it waits for the farewell to
        // be admitted and happens in `closeAfterFinalFollowUp`, scheduled by
        // the caller. Doing it here suppressed the very message it follows.
        const finalAction = config.finalAction || 'mark_not_interested';
        if (finalAction === 'mark_not_interested') {
            const write = await this.pipelineService.writeLeadStage(
                tenantId,
                leadId,
                'no_interesado',
                { schemaName, onlyActiveOpportunities: true },
            );
            this.logger.log(`Final action: marked lead ${leadId} as ${write.stage.slug}; `
                + 'the thread closes once the farewell has left');
        }
        return sent;
    }

    // ─── Private Helpers ─────────────────────────────────────────────

    /**
     * Resolve the language to use for customer-facing follow-up messages.
     *
     * Priority order:
     *   1. conversation.metadata->>'detectedLanguage'  (what the customer actually wrote in)
     *   2. tenant.language                             (fallback: tenant configured language)
     *   3. 'es'                                        (hard default)
     */
    private async resolveFollowUpLanguage(schemaName: string, conversationId: string, tenantId: string): Promise<string> {
        // 1. Conversation-detected language
        try {
            const rows = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT metadata->>'detectedLanguage' AS lang FROM conversations WHERE id = $1::uuid LIMIT 1`,
                [conversationId],
            );
            const detected = rows?.[0]?.lang;
            if (detected) return String(detected).slice(0, 2).toLowerCase();
        } catch {
            // fall through
        }

        // 2. Tenant language
        try {
            const tenant = await this.prisma.tenant.findUnique({
                where: { id: tenantId },
                select: { language: true },
            });
            if (tenant?.language) return String(tenant.language).slice(0, 2).toLowerCase();
        } catch {
            // fall through
        }

        return 'es';
    }

    /**
     * One nudge, on the durable lane, whatever it turns out to be.
     *
     * `effectKey` is what makes this effect THIS effect in the conversation's
     * own terms — the attempt number, or the abandonment cycle a booking nudge
     * belongs to. Without it two nudges for one thread would derive the same
     * origin, collide on one row, and the second would never be sent while the
     * record said it had been.
     */
    private async sendFollowUpText(
        tenantId: string,
        schemaName: string,
        conversationId: string,
        contact: any,
        text: string,
        effectKey: string,
    ): Promise<boolean> {
        const phone = contact?.external_id || contact?.phone;
        if (!phone) {
            this.logger.warn(`No phone for contact — cannot send follow-up`);
            return false;
        }

        // Opt-out gate (compliance): NEVER send a proactive message to a contact who
        // confirmed opt-out. isBlocked has a Redis fast-path (~0 cost) and applies to
        // BOTH the free-form and the WhatsApp-template path below.
        if (await this.compliance.isBlocked(tenantId, phone)) {
            this.logger.log(`[Nurturing] Contact opted-out — skipping proactive follow-up for conv ${conversationId}`);
            return false;
        }

        // ── THE OTHER HALF OF "BAJA", WHICH `isBlocked` DOES NOT SEE ────────
        //
        // `drip-sequence.service.ts:327-330` checks BOTH and says why: the
        // public-form unsubscribe sets `leads.opted_out`, which never becomes
        // an `opt_out_records` row, and it also sidesteps the E.164 `+`/no-`+`
        // mismatch that can make a confirmed opt-out invisible to a phone
        // lookup. Nurturing checked only the first, so a customer who used the
        // unsubscribe link went on being nudged — by the one producer whose
        // entire purpose is messaging people who have stopped replying.
        //
        // A failure to READ this is not permission to send: an unreadable
        // answer stops the nudge, because the cost of a missed follow-up is a
        // follow-up, and the cost of the other mistake is a message somebody
        // explicitly asked us never to send again.
        try {
            const [lead] = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT l.opted_out
                   FROM leads l
                   JOIN contacts ct ON ct.id = l.contact_id
                  WHERE ct.id = $1::uuid
                  ORDER BY l.updated_at DESC NULLS LAST
                  LIMIT 1`,
                [contact.id],
            );
            if (lead?.opted_out === true) {
                this.logger.log(`[Nurturing] Contact unsubscribed via the public form — `
                    + `skipping proactive follow-up for conv ${conversationId}`);
                return false;
            }
        } catch (error: any) {
            this.logger.warn(`[Nurturing] could not read the unsubscribe flag for conv `
                + `${conversationId} (${error?.message}); standing down rather than guessing`);
            return false;
        }

        const conversation = await this.getConversation(schemaName, conversationId);
        const channelType = conversation?.channel_type || 'whatsapp';

        const config = await this.getNurturingConfig(tenantId);

        // Check allowed channels
        if (config.allowedChannels && config.allowedChannels.length > 0) {
            if (!config.allowedChannels.includes(channelType)) {
                this.logger.debug(`[Nurturing] Channel ${channelType} not in allowed list — skipping`);
                return false;
            }
        }

        // Rate limit: max 1 nurturing message per conversation per day
        const alreadySentToday = await this.hasNurturingSentToday(schemaName, conversationId);
        if (alreadySentToday) {
            this.logger.debug(`[Nurturing] Already sent nurturing message today for conv ${conversationId} — skipping`);
            return false;
        }

        // 24h messaging window applies to ALL channels (WhatsApp, IG, Messenger)
        const withinWindow = await this.isWithinMessagingWindow(schemaName, conversationId);

        if (!withinWindow) {
            // Outside 24h window — IG/Messenger cannot send anything
            if (channelType === 'instagram' || channelType === 'messenger') {
                this.logger.warn(
                    `[Nurturing] Skipping ${channelType} for conv ${conversationId} — outside 24h window, no template option`,
                );
                return false;
            }

            // WhatsApp: can ONLY send approved template (HSM)
            if (channelType === 'whatsapp') {
                if (!config.whatsappTemplateName) {
                    this.logger.warn(
                        `[Nurturing] Outside 24h window for conv ${conversationId} — no WhatsApp template configured, skipping`,
                    );
                    return false;
                }
                return this.sendWhatsAppTemplate(tenantId, schemaName, conversationId, contact,
                    config.whatsappTemplateName, effectKey);
            }

            // Other channels outside window: skip
            this.logger.warn(`[Nurturing] Outside 24h window for ${channelType} conv ${conversationId} — skipping`);
            return false;
        }

        // Within the window: free-form text, on the same lane as everything else.
        return this.dispatch(tenantId, schemaName, conversationId, conversation, contact, {
            effectKey, channelType, recipient: String(phone),
            item: { kind: 'text', payload: { text } },
        });
    }

    /**
     * Commit one nudge and say whether a durable effect now exists.
     *
     * ── THE SENDER IS THE THREAD'S OWN, OR THERE IS NONE ────────────────────
     *
     * The outbox refuses a binding whose conversation does not belong to the
     * connection the row names, and this producer's authority is ABOUT that
     * conversation. So the account is the one on the thread — never "the
     * tenant's first WhatsApp number", which on a two-number tenant opened the
     * follow-up from a number the customer had never seen. A thread that names
     * none cannot be billed to anybody; the resolver is still asked, because it
     * is what raises the configuration task the business has to act on.
     */
    private async dispatch(
        tenantId: string, schemaName: string, conversationId: string, conversation: any,
        contact: any, input: {
            readonly effectKey: string;
            readonly channelType: string;
            readonly recipient: string;
            readonly item: DispatchItem;
        },
    ): Promise<boolean> {
        const sender = String(conversation?.channel_account_id ?? '').trim();
        if (!sender) {
            await this.resolveChannelCredentials(tenantId, schemaName, input.channelType, null);
            this.logger.warn(`[Nurturing] conv ${conversationId} names no connection `
                + '— nothing dispatched');
            return false;
        }
        const contactId = String(conversation?.contact_id ?? contact?.id ?? '').trim();
        if (!contactId) {
            this.logger.warn(`[Nurturing] conv ${conversationId} has no contact — nothing dispatched`);
            return false;
        }
        // ── THE AUTHORITY, READ FROM THE CONVERSATION ───────────────────────
        //
        // Its revision carries the time of the last inbound message, so a
        // customer who writes between preparing this nudge and sending it makes
        // it stale — and a nudge asking whether anybody is still there,
        // arriving a minute after they wrote, is the worst thing this lane can
        // do. It is also billed.
        const operationalScope = await this.proactive.policyAuthority(schemaName, {
            tenantId, producer: 'nurturing_followup', channelType: input.channelType,
            channelAccountId: sender, entityId: conversationId,
        });
        if (!operationalScope) {
            this.logger.log(`[Nurturing] conv ${conversationId} no longer justifies a nudge — suppressed`);
            return false;
        }
        const result = await this.proactive.send(tenantId, {
            originKey: `nurturing_followup:${conversationId}:${input.effectKey}`,
            conversationId, contactId,
            channelType: input.channelType, channelAccountId: sender,
            recipient: input.recipient,
            items: [input.item],
            operationalScope,
        });
        if (effectIsDurable(result)) {
            // The once-a-day cap used to count history rows carrying
            // `metadata.source = 'nurturing'`, and the lane writes that row
            // itself without any metadata of ours. Left alone, the cap would
            // have silently stopped capping. It is a mark on the conversation
            // now, written only over a durable effect.
            await this.prisma.executeInTenantSchema(schemaName,
                `UPDATE conversations
                    SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb),
                        '{nurturing_last_sent_at}', to_jsonb(NOW()::text))
                  WHERE id = $1::uuid`, [conversationId]);
        }
        this.logger.log(`[Nurturing] ${result.kind} a ${input.item.kind} nudge for conv ${conversationId}`);
        // `suppressed` is deliberately NOT a send here. The two markers this
        // answer gates — the attempt and the booking cycle — say "the customer
        // was nudged", and a policy that refused the nudge did not nudge them.
        return effectIsDurable(result);
    }

    /**
     * Send a WhatsApp approved template for a follow-up outside the 24h window.
     *
     * ── WHY THIS DOES NOT GO THROUGH THE QUEUE ──────────────────────────────
     *
     * It used to. It built an outbound whose `content.text` was the literal
     * string `[Template: nurture_followup]` and put the real template name in
     * `metadata.isTemplate`/`templateName` — which is read by NOTHING. No
     * adapter, no processor, no sink. So either the customer received that
     * literal marker, or Meta refused it for being free-form outside the
     * window; both end with the follow-up never arriving and the conversation
     * log saying it did.
     *
     * The drip sequence hit the same bug and its fix is the one used here:
     * `WhatsappMessagingService.sendTemplate`, which is the only road that
     * builds a real template payload — and the road that asks the money
     * authority first.
     */
    private async sendWhatsAppTemplate(
        tenantId: string,
        schemaName: string,
        conversationId: string,
        contact: any,
        templateName: string,
        effectKey: string,
    ): Promise<boolean> {
        const phone = contact?.external_id || contact?.phone;
        if (!phone) return false;

        const conversation = await this.getConversation(schemaName, conversationId);
        // Approved IN a language. Meta refuses a template in one it was not
        // approved for, and `'es'` was hardcoded while every other line of this
        // follow-up already resolved the conversation's own language.
        const language = await this.resolveFollowUpLanguage(schemaName, conversationId, tenantId);
        return this.dispatch(tenantId, schemaName, conversationId, conversation, contact, {
            effectKey, channelType: 'whatsapp', recipient: String(phone),
            item: { kind: 'template', payload: {
                templateName, language,
                components: [
                    { type: 'body', parameters: [{ type: 'text', text: contact?.name || 'cliente' }] },
                ],
            } },
        });
    }

    /**
     * Check if a nurturing message was already sent today for this conversation.
     */
    private async hasNurturingSentToday(schemaName: string, conversationId: string): Promise<boolean> {
        // Two sources, because the cap has to keep working across the move.
        //
        // It used to count history rows carrying `metadata.source =
        // 'nurturing'`, and the durable lane writes that row itself with no
        // metadata of ours — so on its own the old test would have started
        // answering "no" for ever and the once-a-day cap would have stopped
        // capping. The mark on the conversation is written only over a durable
        // effect; the message query stays for threads nudged before this.
        const result = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `SELECT (
                COALESCE((SELECT (metadata->>'nurturing_last_sent_at')::timestamptz
                            FROM conversations WHERE id = $1::uuid),
                         '1970-01-01'::timestamptz) > CURRENT_DATE
                OR EXISTS(
                    SELECT 1 FROM messages
                    WHERE conversation_id = $1::uuid
                      AND direction = 'outbound'
                      AND metadata->>'source' = 'nurturing'
                      AND created_at > CURRENT_DATE)
            ) AS sent_today`,
            [conversationId],
        );
        return result?.[0]?.sent_today === true;
    }

    /**
     * Check if the last inbound message from the customer was within 24 hours.
     * Required by Meta policy for Instagram and Messenger channels.
     */
    private async isWithinMessagingWindow(schemaName: string, conversationId: string): Promise<boolean> {
        const result = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `SELECT EXISTS(
                SELECT 1 FROM messages
                WHERE conversation_id = $1::uuid
                  AND direction = 'inbound'
                  AND created_at > NOW() - INTERVAL '24 hours'
            ) AS within_window`,
            [conversationId],
        );
        return result?.[0]?.within_window === true;
    }

    // `saveOutboundMessage` used to live here, and the comment above it argued
    // about which status was honest for a message the producer had handed to a
    // queue. The durable lane settles that: it writes the history row in the
    // same transaction as the effect, as `pending`, and the receipt reaches it
    // when a provider actually accepts the thing it describes.

    private async hasCustomerRespondedSince(schemaName: string, conversationId: string, attempt: number): Promise<boolean> {
        // Check if there's any inbound message after the last outbound nurturing message
        const result = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `SELECT EXISTS(
                SELECT 1 FROM messages
                WHERE conversation_id = $1::uuid
                  AND direction = 'inbound'
                  AND created_at > (
                      SELECT COALESCE(MAX(created_at), '1970-01-01')
                      FROM messages
                      WHERE conversation_id = $1::uuid
                        AND direction = 'outbound'
                        AND created_at < NOW() - INTERVAL '30 seconds'
                  )
             ) AS responded`,
            [conversationId],
        );
        return result?.[0]?.responded === true;
    }

    private async getConversation(schemaName: string, conversationId: string): Promise<any> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `SELECT * FROM conversations WHERE id = $1::uuid`,
            [conversationId],
        );
        return rows?.[0] || null;
    }

    private async getContact(schemaName: string, conversationId: string): Promise<any> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `SELECT ct.* FROM contacts ct
             JOIN conversations c ON c.contact_id = ct.id
             WHERE c.id = $1::uuid`,
            [conversationId],
        );
        return rows?.[0] || null;
    }

    private async getRecentMessages(schemaName: string, conversationId: string, limit: number): Promise<any[]> {
        return this.prisma.executeInTenantSchema<any[]>(schemaName,
            `SELECT direction, content_text, created_at
             FROM messages
             WHERE conversation_id = $1::uuid
             ORDER BY created_at DESC
             LIMIT $2`,
            [conversationId, limit],
        ) || [];
    }

    private async recordAttempt(schemaName: string, conversationId: string, attempt: number): Promise<void> {
        await this.prisma.executeInTenantSchema(schemaName,
            `UPDATE conversations
             SET metadata = jsonb_set(
                 jsonb_set(
                     COALESCE(metadata, '{}'::jsonb),
                     '{nurturing_last_attempt}',
                     $2::text::jsonb
                 ),
                 '{nurturing_last_attempt_at}',
                 to_jsonb(NOW()::text)
             )
             WHERE id = $1::uuid`,
            [conversationId, attempt],
        );
    }

    private async scheduleNextFollowUp(
        tenantId: string,
        conversationId: string,
        leadId: string,
        nextAttempt: number,
        config: NurturingConfig,
    ): Promise<void> {
        const delayIndex = nextAttempt - 1;
        const delaySec = config.delays[delayIndex] ?? DEFAULT_DELAYS[delayIndex] ?? DEFAULT_DELAYS[DEFAULT_DELAYS.length - 1];
        const delayMs = delaySec * 1000;
        const jobId = this.buildJobId(tenantId, conversationId, nextAttempt);

        await this.nurturingQueue.add('follow-up', {
            tenantId,
            conversationId,
            leadId,
            attempt: nextAttempt,
        }, {
            jobId,
            delay: delayMs,
            attempts: 2,
            backoff: { type: 'fixed', delay: 30_000 },
            removeOnComplete: { age: 3600 },
            removeOnFail: { age: 86400 },
        });

        this.logger.log(
            `Scheduled next follow-up for conversation ${conversationId} ` +
            `attempt ${nextAttempt} in ${delaySec}s`,
        );
    }

    async getNurturingConfig(tenantId: string): Promise<NurturingConfig> {
        const defaults: NurturingConfig = {
            enabled: false,
            maxAttempts: DEFAULT_MAX_ATTEMPTS,
            delays: DEFAULT_DELAYS,
            allowedChannels: ['whatsapp'],
            finalAction: 'create_task',
            whatsappTemplateName: '',
            maxPerDay: 1,
        };

        // 1. Read from tenant.settings.nurturing (set by tenant admin)
        try {
            const cacheKey = `nurturing:config:${tenantId}`;
            const cached = await this.redis.getJson<NurturingConfig>(cacheKey);
            if (cached) return { ...defaults, ...cached };

            const rows = await this.prisma.$queryRaw<any[]>`
                SELECT settings FROM tenants WHERE id = ${tenantId}::uuid
            `;
            const settings = rows?.[0]?.settings;
            const nurturing = settings?.nurturing;
            if (nurturing) {
                const config: NurturingConfig = {
                    enabled: nurturing.enabled ?? defaults.enabled,
                    maxAttempts: nurturing.maxAttempts || defaults.maxAttempts,
                    delays: nurturing.delays || defaults.delays,
                    allowedChannels: nurturing.allowedChannels || defaults.allowedChannels,
                    finalAction: nurturing.finalAction || defaults.finalAction,
                    whatsappTemplateName: nurturing.whatsappTemplateName || defaults.whatsappTemplateName,
                    maxPerDay: nurturing.maxPerDay ?? defaults.maxPerDay,
                };
                await this.redis.setJson(cacheKey, config, 120);
                return config;
            }
        } catch {
            // fallback to persona
        }

        // 2. Fallback: read from persona config (legacy)
        try {
            const personaConfig = await this.personaService.getActivePersona(tenantId);
            const nurturing = (personaConfig as any)?.nurturing;
            if (nurturing) {
                return {
                    enabled: nurturing.enabled !== false,
                    maxAttempts: nurturing.maxAttempts || defaults.maxAttempts,
                    delays: nurturing.delays || defaults.delays,
                    allowedChannels: nurturing.allowedChannels || defaults.allowedChannels,
                    finalAction: nurturing.finalAction || defaults.finalAction,
                    whatsappTemplateName: nurturing.whatsappTemplateName || defaults.whatsappTemplateName,
                    maxPerDay: nurturing.maxPerDay ?? defaults.maxPerDay,
                };
            }
        } catch {
            // ignore
        }

        return defaults;
    }

    async updateNurturingConfig(tenantId: string, config: Partial<NurturingConfig>): Promise<NurturingConfig> {
        // The legacy/persona value is only a fallback for a tenant that has no
        // branch yet. Once the row is locked, a concurrent first save wins and
        // becomes the merge base for this patch.
        const fallback = await this.getNurturingConfig(tenantId);
        const updated = await mutateTenantSettingsBranchAtomic<NurturingConfig>(
            this.prisma,
            tenantId,
            'nurturing',
            (raw) => {
                const current = raw && typeof raw === 'object' && !Array.isArray(raw)
                    ? { ...fallback, ...(raw as Partial<NurturingConfig>) }
                    : fallback;
                return {
                    enabled: config.enabled ?? current.enabled,
                    maxAttempts: Math.min(Math.max(config.maxAttempts || current.maxAttempts, 1), 5),
                    delays: config.delays || current.delays,
                    allowedChannels: config.allowedChannels || current.allowedChannels,
                    finalAction: config.finalAction || current.finalAction,
                    whatsappTemplateName: config.whatsappTemplateName ?? current.whatsappTemplateName,
                    maxPerDay: Math.min(Math.max(config.maxPerDay ?? current.maxPerDay, 1), 3),
                };
            },
        );

        // Invalidate cache
        await this.redis.del(`nurturing:config:${tenantId}`);

        return updated;
    }

    /**
     * The connection this follow-up leaves from, or nothing.
     *
     * ── IT USED TO RETURN AN EMPTY TOKEN ────────────────────────────────────
     *
     * On any refusal it logged a warning and returned
     * `{ accessToken: '', accountId: '' }`, which its callers then enqueued: an
     * outbound message with no credential and no sender, travelling to a
     * transport that could only fail. The customer got nothing, the tenant was
     * told nothing, and the failure surfaced as a provider error about an
     * invalid token rather than as "you have two numbers and have not said
     * which one your follow-ups come from".
     *
     * `null` now, and the resolver raises the configuration task on the way.
     *
     * An INFRASTRUCTURE failure is a different thing and is deliberately not
     * caught here: the resolver raises `ProactiveConnectionUnavailable` and it
     * propagates to the BullMQ job that called this, which retries. Swallowing
     * it would turn a database that was busy for ten seconds into a follow-up
     * that never happens — the message is dropped, the sequence moves on, and
     * nothing in the product says a step was skipped.
     */
    private async resolveChannelCredentials(tenantId: string, schemaName: string,
        channelType = 'whatsapp', channelAccountId?: string | null,
    ): Promise<{ accessToken: string; accountId: string } | null> {
        return this.connections.resolve({
            tenantId, schemaName, channelType, channelAccountId,
            purpose: 'los seguimientos automáticos',
        });
    }

    private buildJobId(tenantId: string, conversationId: string, attempt: number): string {
        return `nurturing_${tenantId}_${conversationId}_${attempt}`;
    }

    private async tenantSchema(tenantId: string): Promise<string> {
        return this.prisma.getTenantSchemaName(tenantId);
    }
}
