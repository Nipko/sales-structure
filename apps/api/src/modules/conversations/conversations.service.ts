import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { PersonaService } from '../persona/persona.service';
import { LLMRouterService } from '../ai/router/llm-router.service';
import { ChannelGatewayService } from '../channels/channel-gateway.service';
import { ConversationsGateway } from './conversations.gateway';
import { WhatsappConnectionService } from '../whatsapp/services/whatsapp-connection.service';
import { NormalizedMessage, OutboundMessage, TenantConfig } from '@parallext/shared';

@Injectable()
export class ConversationsService {
    private readonly logger = new Logger(ConversationsService.name);

    constructor(
        private prisma: PrismaService,
        private redis: RedisService,
        private personaService: PersonaService,
        private llmRouter: LLMRouterService,
        private channelGateway: ChannelGatewayService,
        private gateway: ConversationsGateway,
        @Inject(forwardRef(() => WhatsappConnectionService))
        private whatsappConnection: WhatsappConnectionService,
    ) { }

    /**
     * Main entry point for incoming messages from any channel
     */
    async processIncomingMessage(normalizedMsg: NormalizedMessage): Promise<void> {
        const { tenantId, contactId, channelType, content } = normalizedMsg;
        this.logger.log(`Processing inbound message from ${contactId} on ${channelType} for tenant ${tenantId}`);
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);

        // 1. Resolve Contact & Conversation
        const { contact, conversation } = await this.resolveConversation(schemaName, contactId, channelType, normalizedMsg);
        normalizedMsg.conversationId = conversation.id;

        // Auto-progress stage from 'nuevo' to 'respondio' upon user message
        await this.prisma.executeInTenantSchema(schemaName,
            `UPDATE opportunities SET stage = 'respondio' WHERE conversation_id = $1 AND stage = 'nuevo'`,
            [conversation.id]
        );
        await this.prisma.executeInTenantSchema(schemaName,
            `UPDATE leads 
             SET stage = 'respondio' 
             WHERE id = (SELECT lead_id FROM opportunities WHERE conversation_id = $1 LIMIT 1) 
               AND stage = 'nuevo'`,
            [conversation.id]
        );

        // 2. Load Persona & Check Business Hours
        const config = await this.personaService.getActivePersona(tenantId);
        if (!config) {
            this.logger.error(`No active persona found for tenant ${tenantId}`);
            return;
        }

        if (!this.isWithinBusinessHours(config)) {
            await this.sendAfterHoursMessage(tenantId, schemaName, normalizedMsg, config);
            return;
        }

        if (conversation.is_handoff || conversation.status === 'waiting_human' || conversation.status === 'with_human') {
            this.logger.log(`Conversation ${conversation.id} is in HUMAN HANDOFF mode. Skipping AI.`);
            
            // Just save the message, don't generate AI response
            await this.saveMessage(schemaName, tenantId, conversation.id, normalizedMsg);
            
            // TODO: Ensure notification is sent to WebSockets for live chat
            return;
        }

        // 3. Save User Message
        await this.saveMessage(schemaName, tenantId, conversation.id, normalizedMsg);

        // 4. Generate AI Response
        const response = await this.generateResponse(schemaName, tenantId, conversation, normalizedMsg, config);

        // 5. Send Response via Channel Gateway
        if (response) {
            const providerMessageId = await this.sendResponse(tenantId, schemaName, response, normalizedMsg);
            // Save AI Message
            await this.saveAiMessage(schemaName, tenantId, conversation.id, response, providerMessageId || undefined);
        }
    }

    /**
     * Resolve or create contact, lead, conversation, and opportunity
     */
    private async resolveConversation(schemaName: string, contactId: string, channelType: string, msg: NormalizedMessage) {
        // 1. Find or create contact
        let contact = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `SELECT * FROM contacts WHERE external_id = $1 AND channel_type = $2`,
            [contactId, channelType]
        ).then(res => res[0]);

        if (!contact) {
            contact = await this.prisma.executeInTenantSchema<any[]>(schemaName,
                `INSERT INTO contacts (external_id, channel_type, name) VALUES ($1, $2, $3) RETURNING *`,
                [contactId, channelType, msg.metadata?.contactName || 'Unknown']
            ).then(res => res[0]);
        }

        // 2. Find or create lead for commercial CRM (Epic 1 integration)
        let lead = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `SELECT * FROM leads WHERE contact_id = $1 LIMIT 1`,
            [contact.id]
        ).then(res => res[0]);

        if (!lead) {
            const contactName = (msg.metadata as any)?.contactName as string || '';
            const nameParts = contactName.split(' ');
            const firstName = nameParts[0] || 'Unknown';
            const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : null;

            lead = await this.prisma.executeInTenantSchema<any[]>(schemaName,
                `INSERT INTO leads (contact_id, first_name, last_name, phone, stage, score) VALUES ($1, $2, $3, $4, 'nuevo', 10) RETURNING *`,
                [contact.id, firstName, lastName, contactId]
            ).then(res => res[0]);
        }

        // 3. Find active conversation or create new
        let conversation = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `SELECT * FROM conversations WHERE contact_id = $1 AND status = 'active' ORDER BY created_at DESC LIMIT 1`,
            [contact.id]
        ).then(res => res[0]);

        if (!conversation) {
            conversation = await this.prisma.executeInTenantSchema<any[]>(schemaName,
                `INSERT INTO conversations (contact_id, channel_type, channel_account_id, status, stage) VALUES ($1, $2, $3, 'active', 'greeting') RETURNING *`,
                [contact.id, msg.channelType, msg.channelAccountId]
            ).then(res => res[0]);

            // 4. Create an active opportunity tied to this new conversation
            await this.prisma.executeInTenantSchema<any[]>(schemaName,
                `INSERT INTO opportunities (lead_id, conversation_id, stage, score) VALUES ($1, $2, 'nuevo', 10)`,
                [lead.id, conversation.id]
            );
        }

        return { contact, lead, conversation };
    }

    private isWithinBusinessHours(config: TenantConfig): boolean {
        if (!config.hours || !config.hours.schedule) return true;

        const now = new Date();
        const timezone = config.hours.timezone || 'America/Bogota';

        // Get current day and time in tenant's timezone
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

        if (!todaySchedule || typeof todaySchedule === 'string') return false; // day not in schedule = closed

        const [startH, startM] = todaySchedule.start.split(':').map(Number);
        const [endH, endM] = todaySchedule.end.split(':').map(Number);
        const startMinutes = startH * 60 + startM;
        const endMinutes = endH * 60 + endM;

        return currentMinutes >= startMinutes && currentMinutes < endMinutes;
    }

    private async sendAfterHoursMessage(tenantId: string, schemaName: string, msg: NormalizedMessage, config: TenantConfig) {
        if (!config.hours?.afterHoursMessage) return;

        this.logger.log(`Sending after hours message to ${msg.contactId}`);

        const outbound: OutboundMessage = {
            tenantId,
            channelType: msg.channelType,
            channelAccountId: msg.channelAccountId,
            to: msg.contactId,
            content: { type: 'text', text: config.hours.afterHoursMessage }
        };

        const accessToken = await this.resolveAccessToken(tenantId, schemaName);
        await this.channelGateway.sendMessage(outbound, accessToken);
    }

    private async saveMessage(schemaName: string, tenantId: string, conversationId: string, msg: NormalizedMessage) {
        const metadataJson = JSON.stringify(msg.metadata || {});
        const externalId = typeof (msg.metadata as any)?.waMessageId === 'string'
            ? (msg.metadata as any).waMessageId
            : null;
        
        const result = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `INSERT INTO messages (conversation_id, direction, content_type, content_text, status, external_id, metadata) 
             VALUES ($1, 'inbound', $2, $3, 'delivered', $4, $5::jsonb) RETURNING *`,
            [conversationId, msg.content.type, msg.content.text || null, externalId, metadataJson]
        );
        this.logger.log(`Saved user message to DB: ${msg.content.text}`);
        this.gateway.emitNewMessage(tenantId, result[0], conversationId);
    }

    private async saveAiMessage(schemaName: string, tenantId: string, conversationId: string, text: string, externalId?: string) {
        const result = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `INSERT INTO messages (conversation_id, direction, content_type, content_text, status, external_id) 
             VALUES ($1, 'outbound', 'text', $2, 'delivered', $3) RETURNING *`,
            [conversationId, text, externalId || null]
        );
        this.logger.log(`Saved AI message to DB: ${text}`);
        this.gateway.emitNewMessage(tenantId, result[0], conversationId);
    }

    private async sendResponse(tenantId: string, schemaName: string, text: string, inboundMsg: NormalizedMessage): Promise<string | null> {
        const outbound: OutboundMessage = {
            tenantId,
            channelType: inboundMsg.channelType,
            channelAccountId: inboundMsg.channelAccountId,
            to: inboundMsg.contactId,
            content: { type: 'text', text }
        };

        const accessToken = await this.resolveAccessToken(tenantId, schemaName);
        return this.channelGateway.sendMessage(outbound, accessToken);
    }

    /**
     * Resolve real Meta access token for a given tenantId.
     * Looks up schema → decrypts token from whatsapp_credentials.
     */
    private async resolveAccessToken(tenantId: string, schemaName: string): Promise<string> {
        try {
            const creds = await this.whatsappConnection.getValidAccessToken(schemaName);
            return creds.accessToken;
        } catch (e: any) {
            this.logger.warn(`Could not resolve WhatsApp token for tenant ${tenantId}: ${e.message}`);
            return '';
        }
    }

    /**
     * Orchestrate the LLM call using the Router and Persona System Prompt
     */
    private async generateResponse(schemaName: string, tenantId: string, conversation: any, msg: NormalizedMessage, config: TenantConfig): Promise<string> {
        if (msg.content.type !== 'text') {
            return `He recibido tu mensaje multimedia, pero por ahora solo puedo procesar texto. ¿Puedes describirlo?`;
        }

        const userText = msg.content.text || '';

        // 1. Analyze routing factors
        const complexity = this.llmRouter.analyzeComplexity(userText);
        const sentiment = this.llmRouter.analyzeSentiment(userText);
        const stageScore = this.llmRouter.stageToScore(conversation.stage);

        this.logger.log(`Routing Factors - Complexity: ${complexity}, Sentiment: ${sentiment}, Stage: ${stageScore}`);

        // Handoff Detection Logic
        const complexityThreshold = 85;
        const frustrationThreshold = 70;

        if (
            complexity >= complexityThreshold ||
            sentiment >= frustrationThreshold ||
            userText.toLowerCase().includes('humano') ||
            userText.toLowerCase().includes('asesor')
        ) {
            this.logger.warn(`HANDOFF TRIGGERED for Conversation ${conversation.id}. Pausing AI.`);
            
            await this.prisma.executeInTenantSchema(schemaName,
                `UPDATE conversations SET status = 'waiting_human', metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{handoff_reason}', '"Sentiment/Complexity threshold or explicit request"') WHERE id = $1`,
                [conversation.id]
            );

            return `Entiendo. Te comunicaré ahora mismo con nuestro equipo de asistencia humana. En un momento te responderán.`;
        }

        // 2. Build Prompt
        const systemPrompt = this.personaService.buildSystemPrompt(config);

        // 3. Get Conversation History from DB
        const history = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC LIMIT 20`,
            [conversation.id]
        );

        const messages = history.map(h => ({
            role: h.direction === 'inbound' ? 'user' : 'assistant',
            content: h.content_text || ''
        }));
        
        // Add current message
        messages.push({ role: 'user', content: userText });

        // 4. Execute LLM Call using Router
        // ticketValue: use default 50 (medium) until CRM integration provides real value
        // intentType: use complexity as proxy until intent classification is implemented
        const response = await this.llmRouter.execute({
            model: 'gpt-4o-mini',
            messages: messages as any[],
            systemPrompt: systemPrompt,
            temperature: 0.7,
            routingFactors: {
                ticketValue: 50,
                complexity,
                conversationStage: stageScore,
                sentiment,
                intentType: complexity, // proxy until dedicated intent classifier
            }
        });

        const reply = response.content;
        
        if (reply) {
            return reply;
        }

        return `[Error Generating AI Response]`;
    }
}
