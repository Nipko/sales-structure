import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { PersonaService } from '../persona/persona.service';
import { LLMRouterService } from '../ai/router/llm-router.service';
import { OutboundQueueService } from '../channels/outbound-queue.service';
import { ChannelTokenService } from '../channels/channel-token.service';
import { OutboundMessage } from '@parallext/shared';

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

interface NurturingConfig {
    enabled: boolean;
    maxAttempts: number;
    delays: number[];
    finalAction: 'mark_not_interested' | 'create_task';
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
        private readonly outboundQueue: OutboundQueueService,
        private readonly channelToken: ChannelTokenService,
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

        // 3. Check attempt count
        if (attempt > maxAttempts) {
            this.logger.log(`Max attempts (${maxAttempts}) reached for conversation ${conversationId}`);
            return;
        }

        // 4. Load conversation context for follow-up generation
        const contact = await this.getContact(schemaName, conversationId);
        const lastMessages = await this.getRecentMessages(schemaName, conversationId, 5);

        // 5. Execute based on attempt number
        if (attempt === 1) {
            await this.executeAttempt1(tenantId, schemaName, conversationId, contact, lastMessages);
        } else if (attempt === 2) {
            await this.executeAttempt2(tenantId, schemaName, conversationId, contact);
        } else if (attempt >= 3) {
            await this.executeAttempt3(tenantId, schemaName, conversationId, leadId, contact, config);
        }

        // 6. Record attempt in conversation metadata
        await this.recordAttempt(schemaName, conversationId, attempt);

        // 7. Schedule next follow-up if not at max
        if (attempt < maxAttempts) {
            await this.scheduleNextFollowUp(tenantId, conversationId, leadId, attempt + 1, config);
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
    ): Promise<void> {
        const personaConfig = await this.personaService.getActivePersona(tenantId);
        if (!personaConfig) {
            this.logger.warn(`No persona config for tenant ${tenantId} — sending default follow-up`);
            await this.sendFollowUpText(tenantId, schemaName, conversationId, contact,
                '¡Hola! Solo quería saber si tienes alguna duda adicional. Estoy aquí para ayudarte.');
            return;
        }

        // Build context for follow-up generation
        const historyContext = lastMessages
            .map(m => `${m.direction === 'inbound' ? 'Cliente' : 'Asistente'}: ${m.content_text}`)
            .join('\n');

        const followUpPrompt = `Eres un asistente de ventas amable y profesional. ` +
            `Genera un mensaje de seguimiento breve y natural en español para un cliente que no ha respondido. ` +
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
                routingFactors: {
                    ticketValue: 30,
                    complexity: 1,
                    conversationStage: 2,
                    sentiment: 0,
                    intentType: 1,
                },
            });

            const followUpText = response.content || '¡Hola! ¿Pudiste revisar la información que te envié? Estoy aquí para resolver cualquier duda.';
            await this.sendFollowUpText(tenantId, schemaName, conversationId, contact, followUpText);
        } catch (e: any) {
            this.logger.warn(`LLM follow-up generation failed, using fallback: ${e.message}`);
            await this.sendFollowUpText(tenantId, schemaName, conversationId, contact,
                '¡Hola! ¿Pudiste revisar la información que te envié? Quedo atento a cualquier pregunta.');
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
    ): Promise<void> {
        const phone = contact?.external_id || contact?.phone;
        if (!phone) {
            this.logger.warn(`No phone for contact in conversation ${conversationId} — cannot send template`);
            return;
        }

        // Try to send a template. If the tenant has a nurturing template configured, use it.
        // Otherwise, fall back to a text message (if within 24h window).
        try {
            const accessToken = await this.resolveAccessToken(tenantId);
            const outbound: OutboundMessage = {
                tenantId,
                channelType: 'whatsapp',
                channelAccountId: '',  // will be resolved by gateway
                to: phone,
                content: {
                    type: 'text' as any,
                    text: `Hola ${contact?.name || 'estimado cliente'}, queríamos recordarte que estamos aquí para ayudarte. ¿Tienes alguna pregunta adicional?`,
                },
            };

            await this.outboundQueue.enqueue(outbound, accessToken);

            // Save as outbound message
            await this.saveOutboundMessage(schemaName, conversationId,
                `[Plantilla de seguimiento enviada] Hola ${contact?.name || 'estimado cliente'}, ¿pudiste revisar nuestra propuesta? Tenemos opciones que pueden interesarte.`);

            this.logger.log(`Attempt 2: Template sent for conversation ${conversationId}`);
        } catch (e: any) {
            this.logger.warn(`Template send failed for attempt 2, falling back to text: ${e.message}`);
            // Fallback: send text if within 24h window
            await this.sendFollowUpText(tenantId, schemaName, conversationId, contact,
                `Hola ${contact?.name || ''}. Quería compartirte que tenemos opciones especiales disponibles. ` +
                `¿Te gustaría que te cuente más? Estoy aquí para ayudarte a encontrar lo que necesitas.`);
        }
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
    ): Promise<void> {
        // Send final "we're here if you need us" message
        await this.sendFollowUpText(tenantId, schemaName, conversationId, contact,
            `Hola ${contact?.name || ''}. Entendemos que estás ocupado/a. ` +
            `Si en algún momento necesitas información o tienes alguna pregunta, no dudes en escribirnos. ` +
            `¡Estamos aquí para ayudarte!`);

        // Create a task for human agent to review
        await this.prisma.executeInTenantSchema(schemaName,
            `INSERT INTO tasks (lead_id, title, description, type, status, due_at)
             VALUES ($1, $2, $3, 'follow_up', 'pending', NOW() + INTERVAL '24 hours')`,
            [
                leadId,
                `Seguimiento manual requerido — sin respuesta`,
                `El cliente ${contact?.name || '(sin nombre)'} no ha respondido después de 3 intentos automáticos de seguimiento. ` +
                `Conversación: ${conversationId}. Se recomienda contacto telefónico o revisar si el lead sigue activo.`,
            ],
        );

        this.logger.log(`Attempt 3: Task created for conversation ${conversationId}, lead ${leadId}`);

        // Apply final action: mark as not interested or just leave the task
        const finalAction = config.finalAction || 'mark_not_interested';
        if (finalAction === 'mark_not_interested') {
            // Mark lead as no_interesado
            await this.prisma.executeInTenantSchema(schemaName,
                `UPDATE leads SET stage = 'no_interesado' WHERE id = $1::uuid`,
                [leadId],
            );
            await this.prisma.executeInTenantSchema(schemaName,
                `UPDATE opportunities SET stage = 'no_interesado' WHERE lead_id = $1::uuid AND stage NOT IN ('ganado', 'perdido', 'no_interesado')`,
                [leadId],
            );
            // Close the conversation
            await this.prisma.executeInTenantSchema(schemaName,
                `UPDATE conversations SET status = 'resolved', resolved_at = NOW() WHERE id = $1::uuid`,
                [conversationId],
            );
            this.logger.log(`Final action: marked lead ${leadId} as no_interesado, conversation resolved`);
        }
    }

    // ─── Private Helpers ─────────────────────────────────────────────

    private async sendFollowUpText(
        tenantId: string,
        schemaName: string,
        conversationId: string,
        contact: any,
        text: string,
    ): Promise<void> {
        const phone = contact?.external_id || contact?.phone;
        if (!phone) {
            this.logger.warn(`No phone for contact — cannot send follow-up`);
            return;
        }

        const conversation = await this.getConversation(schemaName, conversationId);
        const accessToken = await this.resolveAccessToken(tenantId);

        const outbound: OutboundMessage = {
            tenantId,
            channelType: conversation?.channel_type || 'whatsapp',
            channelAccountId: conversation?.channel_account_id || '',
            to: phone,
            content: { type: 'text', text },
        };

        await this.outboundQueue.enqueue(outbound, accessToken);
        await this.saveOutboundMessage(schemaName, conversationId, text);
    }

    private async saveOutboundMessage(schemaName: string, conversationId: string, text: string): Promise<void> {
        await this.prisma.executeInTenantSchema(schemaName,
            `INSERT INTO messages (conversation_id, direction, content_type, content_text, status, metadata)
             VALUES ($1::uuid, 'outbound', 'text', $2, 'delivered', '{"source":"nurturing"}'::jsonb)`,
            [conversationId, text],
        );
    }

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

    private async getNurturingConfig(tenantId: string): Promise<NurturingConfig> {
        // Try to read from persona config
        try {
            const personaConfig = await this.personaService.getActivePersona(tenantId);
            const nurturing = (personaConfig as any)?.nurturing;
            if (nurturing) {
                return {
                    enabled: nurturing.enabled !== false,
                    maxAttempts: nurturing.maxAttempts || DEFAULT_MAX_ATTEMPTS,
                    delays: nurturing.delays || DEFAULT_DELAYS,
                    finalAction: nurturing.finalAction || 'mark_not_interested',
                };
            }
        } catch {
            // ignore — use defaults
        }

        return {
            enabled: true,
            maxAttempts: DEFAULT_MAX_ATTEMPTS,
            delays: DEFAULT_DELAYS,
            finalAction: 'mark_not_interested',
        };
    }

    private async resolveAccessToken(tenantId: string): Promise<string> {
        try {
            const creds = await this.channelToken.getWhatsAppToken(tenantId);
            return creds.accessToken;
        } catch (e: any) {
            this.logger.warn(`Could not resolve WhatsApp token for tenant ${tenantId}: ${e.message}`);
            return '';
        }
    }

    private buildJobId(tenantId: string, conversationId: string, attempt: number): string {
        return `nurturing_${tenantId}_${conversationId}_${attempt}`;
    }

    private async tenantSchema(tenantId: string): Promise<string> {
        return this.prisma.getTenantSchemaName(tenantId);
    }
}
