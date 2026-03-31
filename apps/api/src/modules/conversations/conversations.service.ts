import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { PersonaService } from '../persona/persona.service';
import { LLMRouterService } from '../ai/router/llm-router.service';
import { ChannelGatewayService } from '../channels/channel-gateway.service';
import { OutboundQueueService } from '../channels/outbound-queue.service';
import { ChannelTokenService } from '../channels/channel-token.service';
import { ConversationsGateway } from './conversations.gateway';
import { HandoffService } from '../handoff/handoff.service';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { LeadScoringService } from '../crm/services/lead-scoring/lead-scoring.service';
import { PipelineService } from '../pipeline/pipeline.service';
import { NurturingService } from '../automation/nurturing.service';
import { NormalizedMessage, OutboundMessage, TenantConfig } from '@parallext/shared';

/** Max characters of history to send to the LLM to avoid exceeding context window */
const MAX_HISTORY_CHARS = 12_000;

@Injectable()
export class ConversationsService {
    private readonly logger = new Logger(ConversationsService.name);

    constructor(
        private prisma: PrismaService,
        private redis: RedisService,
        private personaService: PersonaService,
        private llmRouter: LLMRouterService,
        private channelGateway: ChannelGatewayService,
        private outboundQueue: OutboundQueueService,
        private channelToken: ChannelTokenService,
        private gateway: ConversationsGateway,
        private handoffService: HandoffService,
        private knowledgeService: KnowledgeService,
        private leadScoring: LeadScoringService,
        private pipelineService: PipelineService,
        private eventEmitter: EventEmitter2,
        private nurturingService: NurturingService,
    ) {}

    /**
     * Main entry point for incoming messages from any channel
     */
    async processIncomingMessage(normalizedMsg: NormalizedMessage): Promise<void> {
        const { tenantId, contactId, channelType, content } = normalizedMsg;
        this.logger.log(`Processing inbound message from ${contactId} on ${channelType} for tenant ${tenantId}`);

        // 1. Resolve Contact & Conversation
        const { contact, lead, conversation } = await this.resolveConversation(tenantId, contactId, channelType, normalizedMsg);
        normalizedMsg.conversationId = conversation.id;

        // Cancel any pending nurturing follow-ups — customer responded
        this.nurturingService.cancelFollowUp(tenantId, conversation.id).catch(e =>
            this.logger.warn(`Nurturing cancel failed (non-fatal): ${e.message}`),
        );

        // Auto-progress stage from 'nuevo' to 'respondio' upon user message
        const schemaName = await this.tenantSchema(tenantId);
        await this.prisma.executeInTenantSchema(schemaName,
            `UPDATE opportunities SET stage = 'respondio' WHERE conversation_id = $1 AND stage = 'nuevo'`,
            [conversation.id],
        );
        await this.prisma.executeInTenantSchema(schemaName,
            `UPDATE leads
             SET stage = 'respondio'
             WHERE id = (SELECT lead_id FROM opportunities WHERE conversation_id = $1 LIMIT 1)
               AND stage = 'nuevo'`,
            [conversation.id],
        );

        // 2. Load Persona & Check Business Hours
        const config = await this.personaService.getActivePersona(tenantId);
        if (!config) {
            this.logger.error(`No active persona found for tenant ${tenantId}`);
            return;
        }

        if (!this.isWithinBusinessHours(config)) {
            await this.sendAfterHoursMessage(tenantId, normalizedMsg, config);
            return;
        }

        // 3. Check if in human handoff mode — skip AI, just save message
        if (conversation.status === 'waiting_human' || conversation.status === 'with_human') {
            this.logger.log(`Conversation ${conversation.id} is in HUMAN HANDOFF mode. Skipping AI.`);
            await this.saveMessage(tenantId, conversation.id, normalizedMsg);
            return;
        }

        // 4. Save User Message
        await this.saveMessage(tenantId, conversation.id, normalizedMsg);

        // 5. Check handoff triggers BEFORE generating AI response
        const handoffReason = this.handoffService.shouldHandoff(
            content?.text || '', conversation, config,
        );
        if (handoffReason) {
            this.logger.warn(`HANDOFF TRIGGERED for conversation ${conversation.id}: ${handoffReason}`);
            await this.handoffService.executeHandoff(tenantId, conversation.id, normalizedMsg, handoffReason);
            // Send a message to the customer
            const handoffMsg = `Entiendo. Te comunicaré ahora mismo con nuestro equipo de asistencia humana. En un momento te responderán.`;
            await this.sendResponse(tenantId, handoffMsg, normalizedMsg);
            await this.saveAiMessage(tenantId, conversation.id, handoffMsg);
            return;
        }

        // 6. Generate AI Response
        const complexity = this.llmRouter.analyzeComplexity(content?.text || '');
        const sentiment = this.llmRouter.analyzeSentiment(content?.text || '');
        const response = await this.generateResponse(tenantId, conversation, normalizedMsg, config);

        // 7. Send Response via Channel Gateway
        if (response) {
            await this.sendResponse(tenantId, response, normalizedMsg);
            await this.saveAiMessage(tenantId, conversation.id, response);
        }

        // 8. Auto-progress pipeline stage based on conversation signals
        this.pipelineService.autoProgressFromConversation(tenantId, conversation.id, {
            complexity,
            sentiment,
            messageText: content?.text || '',
            isFirstAiResponse: !!response,
            isCustomerReply: true,
        }).catch(e =>
            this.logger.warn(`Pipeline auto-progress failed (non-fatal): ${e.message}`),
        );

        // 9. Fire-and-forget scoring update
        this.leadScoring.scoreAfterMessage(tenantId, conversation.id).catch(e =>
            this.logger.warn(`Scoring update failed: ${e.message}`),
        );

        // 10. Schedule nurturing follow-up in case customer doesn't respond
        if (response) {
            this.nurturingService.scheduleFollowUp(tenantId, conversation.id, lead.id).catch(e =>
                this.logger.warn(`Nurturing schedule failed (non-fatal): ${e.message}`),
            );
        }
    }

    /**
     * Resolve or create contact, lead, conversation, and opportunity
     */
    private async resolveConversation(tenantId: string, contactId: string, channelType: string, msg: NormalizedMessage) {
        const schemaName = await this.tenantSchema(tenantId);

        // 1. Find or create contact
        let contact = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `SELECT * FROM contacts WHERE external_id = $1 AND channel_type = $2`,
            [contactId, channelType],
        ).then(res => res[0]);

        if (!contact) {
            contact = await this.prisma.executeInTenantSchema<any[]>(schemaName,
                `INSERT INTO contacts (external_id, channel_type, name) VALUES ($1, $2, $3) RETURNING *`,
                [contactId, channelType, msg.metadata?.contactName || 'Unknown'],
            ).then(res => res[0]);
        }

        // 2. Find or create lead
        const contactIdStr = String(contact.id);
        let lead = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `SELECT * FROM leads WHERE contact_id = $1::uuid LIMIT 1`,
            [contactIdStr],
        ).then(res => res[0]);

        let isNewLead = false;
        if (!lead) {
            const contactName = (msg.metadata as any)?.contactName as string || '';
            const nameParts = contactName.split(' ');
            const firstName = nameParts[0] || 'Unknown';
            const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : null;

            lead = await this.prisma.executeInTenantSchema<any[]>(schemaName,
                `INSERT INTO leads (contact_id, first_name, last_name, phone, stage, score) VALUES ($1::uuid, $2, $3, $4, 'nuevo', 10) RETURNING *`,
                [contactIdStr, firstName, lastName, contactId],
            ).then(res => res[0]);
            isNewLead = true;
        }

        // 3. Find active conversation or create new
        let conversation = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `SELECT * FROM conversations WHERE contact_id = $1::uuid AND status IN ('active', 'waiting_human', 'with_human') ORDER BY created_at DESC LIMIT 1`,
            [contactIdStr],
        ).then(res => res[0]);

        if (!conversation) {
            conversation = await this.prisma.executeInTenantSchema<any[]>(schemaName,
                `INSERT INTO conversations (contact_id, channel_type, channel_account_id, status, stage) VALUES ($1::uuid, $2, $3, 'active', 'greeting') RETURNING *`,
                [contactIdStr, msg.channelType, msg.channelAccountId],
            ).then(res => res[0]);

            // Create an active opportunity tied to this new conversation
            await this.prisma.executeInTenantSchema(schemaName,
                `INSERT INTO opportunities (lead_id, conversation_id, stage, score) VALUES ($1::uuid, $2::uuid, 'nuevo', 10)`,
                [String(lead.id), String(conversation.id)],
            );
        }

        // Emit lead.captured event for new leads so automation rules can fire
        if (isNewLead) {
            this.eventEmitter.emit('lead.captured', {
                tenantId,
                schemaName,
                leadId: lead.id,
                contactId: contact.id,
                conversationId: conversation.id,
                phone: contactId,
                name: contact.name,
                channel: channelType,
                source: 'whatsapp_inbound',
            });
            this.logger.log(`Emitted lead.captured for new lead ${lead.id}`);
        }

        return { contact, lead, conversation };
    }

    private isWithinBusinessHours(config: TenantConfig): boolean {
        if (!config.hours || !config.hours.schedule) return true;

        const now = new Date();
        const timezone = config.hours.timezone || 'America/Bogota';

        const localTime = new Intl.DateTimeFormat('en-US', {
            timeZone: timezone,
            weekday: 'short',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        }).formatToParts(now);

        const dayPart = localTime.find(p => p.type === 'weekday')?.value?.toLowerCase();
        const hourPart = localTime.find(p => p.type === 'hour')?.value || '0';
        const minutePart = localTime.find(p => p.type === 'minute')?.value || '0';
        const currentMinutes = parseInt(hourPart) * 60 + parseInt(minutePart);

        const schedule: Record<string, { start: string; end: string } | string> = config.hours.schedule as any;
        const todaySchedule = schedule[dayPart || ''];

        if (!todaySchedule || typeof todaySchedule === 'string') return false;

        const [startH, startM] = todaySchedule.start.split(':').map(Number);
        const [endH, endM] = todaySchedule.end.split(':').map(Number);
        const startMinutes = startH * 60 + startM;
        const endMinutes = endH * 60 + endM;

        return currentMinutes >= startMinutes && currentMinutes < endMinutes;
    }

    private async sendAfterHoursMessage(tenantId: string, msg: NormalizedMessage, config: TenantConfig) {
        if (!config.hours?.afterHoursMessage) return;

        this.logger.log(`Sending after hours message to ${msg.contactId}`);

        const outbound: OutboundMessage = {
            tenantId,
            channelType: msg.channelType,
            channelAccountId: msg.channelAccountId,
            to: msg.contactId,
            content: { type: 'text', text: config.hours.afterHoursMessage },
        };

        const accessToken = await this.resolveAccessToken(tenantId);
        await this.outboundQueue.enqueue(outbound, accessToken);
    }

    private async saveMessage(tenantId: string, conversationId: string, msg: NormalizedMessage) {
        const schemaName = await this.tenantSchema(tenantId);
        const metadataJson = JSON.stringify(msg.metadata || {});

        const result = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `INSERT INTO messages (conversation_id, direction, content_type, content_text, status, metadata)
             VALUES ($1, 'inbound', $2, $3, 'delivered', $4::jsonb) RETURNING *`,
            [conversationId, msg.content.type, msg.content.text, metadataJson],
        );
        this.gateway.emitNewMessage(tenantId, result[0], conversationId);
    }

    private async saveAiMessage(tenantId: string, conversationId: string, text: string) {
        const schemaName = await this.tenantSchema(tenantId);

        const result = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `INSERT INTO messages (conversation_id, direction, content_type, content_text, status)
             VALUES ($1, 'outbound', 'text', $2, 'delivered') RETURNING *`,
            [conversationId, text],
        );
        this.gateway.emitNewMessage(tenantId, result[0], conversationId);
    }

    private async sendResponse(tenantId: string, text: string, inboundMsg: NormalizedMessage) {
        const outbound: OutboundMessage = {
            tenantId,
            channelType: inboundMsg.channelType,
            channelAccountId: inboundMsg.channelAccountId,
            to: inboundMsg.contactId,
            content: { type: 'text', text },
        };

        const accessToken = await this.resolveAccessToken(tenantId);
        // Use BullMQ queue for retry resilience (3 attempts, exponential backoff)
        await this.outboundQueue.enqueue(outbound, accessToken);
    }

    /**
     * Resolve real Meta access token for a given tenantId.
     */
    private async resolveAccessToken(tenantId: string): Promise<string> {
        try {
            const creds = await this.channelToken.getWhatsAppToken(tenantId);
            return creds.accessToken;
        } catch (e: any) {
            this.logger.warn(`Could not resolve WhatsApp token for tenant ${tenantId}: ${e.message}`);
            return '';
        }
    }

    /**
     * Orchestrate the LLM call using the Router and Persona System Prompt.
     * Includes smart history truncation to stay within context window limits.
     */
    private async generateResponse(tenantId: string, conversation: any, msg: NormalizedMessage, config: TenantConfig): Promise<string> {
        if (msg.content.type !== 'text') {
            return `He recibido tu mensaje multimedia, pero por ahora solo puedo procesar texto. ¿Puedes describirlo?`;
        }

        const userText = msg.content.text || '';

        // 1. Analyze routing factors
        const complexity = this.llmRouter.analyzeComplexity(userText);
        const sentiment = this.llmRouter.analyzeSentiment(userText);
        const stageScore = this.llmRouter.stageToScore(conversation.stage);

        this.logger.log(`Routing Factors - Complexity: ${complexity}, Sentiment: ${sentiment}, Stage: ${stageScore}`);

        // 2. Build Prompt (with optional RAG context)
        let systemPrompt = this.personaService.buildSystemPrompt(config);

        // 2b. Inject knowledge base context if available
        try {
            const hasKnowledge = await this.knowledgeService.tenantHasKnowledge(tenantId);
            if (hasKnowledge) {
                const ragResults = await this.knowledgeService.searchRelevant(tenantId, userText, 5);
                if (ragResults.length > 0) {
                    const contextBlock = ragResults.map(r => r.chunk_text).join('\n\n');
                    systemPrompt = `${systemPrompt}\n\n[Contexto de base de conocimiento]\n${contextBlock}\n[Fin del contexto]`;
                    this.logger.log(`RAG: Injected ${ragResults.length} chunks for tenant ${tenantId}`);
                }
            }
        } catch (ragError: any) {
            this.logger.warn(`RAG search failed (non-fatal): ${ragError.message}`);
        }

        // 3. Get Conversation History with smart truncation
        const schemaName = await this.tenantSchema(tenantId);
        const history = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `SELECT direction, content_text FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC LIMIT 30`,
            [conversation.id],
        );

        const messages = this.truncateHistory(history || [], userText);

        // 4. Execute LLM Call using Router
        try {
            const response = await this.llmRouter.execute({
                model: 'gpt-4o-mini',
                messages: messages as any[],
                systemPrompt,
                temperature: 0.7,
                routingFactors: {
                    ticketValue: 50,
                    complexity,
                    conversationStage: stageScore,
                    sentiment,
                    intentType: complexity,
                },
            });

            return response.content || '[Error Generating AI Response]';
        } catch (e: any) {
            this.logger.error(`LLM call failed: ${e.message}`);

            // Increment failed attempts for handoff threshold
            await this.prisma.executeInTenantSchema(schemaName,
                `UPDATE conversations
                 SET metadata = jsonb_set(
                     COALESCE(metadata, '{}'::jsonb),
                     '{failedAttempts}',
                     (COALESCE((metadata->>'failedAttempts')::int, 0) + 1)::text::jsonb
                 )
                 WHERE id = $1`,
                [conversation.id],
            );

            return 'Disculpa, tuve un problema procesando tu mensaje. ¿Podrías repetirlo?';
        }
    }

    /**
     * Truncate conversation history to stay within MAX_HISTORY_CHARS.
     * Keeps the most recent messages and always includes the current user message.
     */
    private truncateHistory(history: any[], currentMessage: string): Array<{ role: string; content: string }> {
        const messages: Array<{ role: string; content: string }> = [];
        let totalChars = currentMessage.length;

        // Build from newest to oldest, then reverse
        for (let i = history.length - 1; i >= 0; i--) {
            const h = history[i];
            const content = h.content_text || '';
            if (totalChars + content.length > MAX_HISTORY_CHARS) break;
            totalChars += content.length;
            messages.unshift({
                role: h.direction === 'inbound' ? 'user' : 'assistant',
                content,
            });
        }

        // Add current message
        messages.push({ role: 'user', content: currentMessage });

        return messages;
    }

    /** Helper to resolve tenant schema name (cached in Redis) */
    private async tenantSchema(tenantId: string): Promise<string> {
        const cacheKey = `tenant:${tenantId}:schema`;
        const cached = await this.redis.get(cacheKey);
        if (cached) return cached;
        const schema = await this.prisma.getTenantSchemaName(tenantId);
        await this.redis.set(cacheKey, schema, 600);
        return schema;
    }
}
