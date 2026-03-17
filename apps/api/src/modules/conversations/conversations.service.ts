import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { PersonaService } from '../persona/persona.service';
import { LLMRouterService } from '../ai/router/llm-router.service';
import { ChannelGatewayService } from '../channels/channel-gateway.service';
import { ConversationsGateway } from './conversations.gateway';
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
    ) { }

    /**
     * Main entry point for incoming messages from any channel
     */
    async processIncomingMessage(normalizedMsg: NormalizedMessage): Promise<void> {
        const { tenantId, contactId, channelType, content } = normalizedMsg;
        this.logger.log(`Processing inbound message from ${contactId} on ${channelType} for tenant ${tenantId}`);

        // 1. Resolve Contact & Conversation
        const { contact, conversation } = await this.resolveConversation(tenantId, contactId, channelType, normalizedMsg);
        normalizedMsg.conversationId = conversation.id;

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

        if (conversation.is_handoff || conversation.status === 'waiting_human' || conversation.status === 'with_human') {
            this.logger.log(`Conversation ${conversation.id} is in HUMAN HANDOFF mode. Skipping AI.`);
            
            // Just save the message, don't generate AI response
            await this.saveMessage(tenantId, conversation.id, normalizedMsg);
            
            // TODO: Ensure notification is sent to WebSockets for live chat
            return;
        }

        // 3. Save User Message
        await this.saveMessage(tenantId, conversation.id, normalizedMsg);

        // 4. Generate AI Response
        const response = await this.generateResponse(tenantId, conversation, normalizedMsg, config);

        // 5. Send Response via Channel Gateway
        if (response) {
            await this.sendResponse(tenantId, response, normalizedMsg);
            // Save AI Message
            await this.saveAiMessage(tenantId, conversation.id, response);
        }
    }

    /**
     * Resolve or create contact and conversation
     */
    private async resolveConversation(tenantId: string, contactId: string, channelType: string, msg: NormalizedMessage) {
        // In a real implementation we would do this using the tenant's schema
        const schemaName = `tenant_${tenantId.replace(/-/g, '_')}`; // simplification, should use tenantsService.getSchemaName

        // Find or create contact
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

        // Find active conversation or create new
        let conversation = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `SELECT * FROM conversations WHERE contact_id = $1 AND status = 'active' ORDER BY created_at DESC LIMIT 1`,
            [contact.id]
        ).then(res => res[0]);

        if (!conversation) {
            conversation = await this.prisma.executeInTenantSchema<any[]>(schemaName,
                `INSERT INTO conversations (contact_id, channel_type, channel_account_id, status, stage) VALUES ($1, $2, $3, 'active', 'greeting') RETURNING *`,
                [contact.id, msg.channelType, msg.channelAccountId]
            ).then(res => res[0]);
        }

        return { contact, conversation };
    }

    private isWithinBusinessHours(config: TenantConfig): boolean {
        if (!config.hours || !config.hours.schedule) return true; // Always open if not configured

        // Simplification for the scaffolding. Real logic would use luxon/moment-timezone
        // to check current time against config.hours.timezone and the schedule.
        return true;
    }

    private async sendAfterHoursMessage(tenantId: string, msg: NormalizedMessage, config: TenantConfig) {
        if (!config.hours?.afterHoursMessage) return;

        this.logger.log(`Sending after hours message to ${msg.contactId}`);

        const outbound: OutboundMessage = {
            tenantId,
            channelType: msg.channelType,
            channelAccountId: msg.channelAccountId,
            to: msg.contactId,
            content: { type: 'text', text: config.hours.afterHoursMessage }
        };

        // Need access token logic here - mock for now
        await this.channelGateway.sendMessage(outbound, 'MOCK_TOKEN');
    }

    private async saveMessage(tenantId: string, conversationId: string, msg: NormalizedMessage) {
        const schemaName = `tenant_${tenantId.replace(/-/g, '_')}`;
        
        const metadataJson = JSON.stringify(msg.metadata || {});
        
        const result = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `INSERT INTO messages (conversation_id, direction, content_type, content_text, status, metadata) 
             VALUES ($1, 'inbound', $2, $3, 'delivered', $4::jsonb) RETURNING *`,
            [conversationId, msg.content.type, msg.content.text, metadataJson]
        );
        this.logger.log(`Saved user message to DB: ${msg.content.text}`);
        this.gateway.emitNewMessage(tenantId, result[0], conversationId);
    }

    private async saveAiMessage(tenantId: string, conversationId: string, text: string) {
        const schemaName = `tenant_${tenantId.replace(/-/g, '_')}`;
        
        const result = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `INSERT INTO messages (conversation_id, direction, content_type, content_text, status) 
             VALUES ($1, 'outbound', 'text', $2, 'delivered') RETURNING *`,
            [conversationId, text]
        );
        this.logger.log(`Saved AI message to DB: ${text}`);
        this.gateway.emitNewMessage(tenantId, result[0], conversationId);
    }

    private async sendResponse(tenantId: string, text: string, inboundMsg: NormalizedMessage) {
        const outbound: OutboundMessage = {
            tenantId,
            channelType: inboundMsg.channelType,
            channelAccountId: inboundMsg.channelAccountId,
            to: inboundMsg.contactId,
            content: { type: 'text', text }
        };

        // In a real scenario we'd fetch the channel auth token from the DB. 
        // We'll mock the token or use a default for this scaffold.
        await this.channelGateway.sendMessage(outbound, 'MOCK_TOKEN');
    }

    /**
     * Orchestrate the LLM call using the Router and Persona System Prompt
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

        // Handoff Detection Logic
        if (complexity > 0.85 || sentiment < 0.3 || userText.toLowerCase().includes('humano') || userText.toLowerCase().includes('asesor')) {
            this.logger.warn(`HANDOFF TRIGGERED for Conversation ${conversation.id}. Pausing AI.`);
            
            const schemaName = `tenant_${tenantId.replace(/-/g, '_')}`;
            await this.prisma.executeInTenantSchema(schemaName,
                `UPDATE conversations SET status = 'waiting_human', metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{handoff_reason}', '"Sentiment/Complexity threshold or explicit request"') WHERE id = $1`,
                [conversation.id]
            );

            return `Entiendo. Te comunicaré ahora mismo con nuestro equipo de asistencia humana. En un momento te responderán.`;
        }

        // 2. Build Prompt
        const systemPrompt = this.personaService.buildSystemPrompt(config);

        // 3. Get Conversation History from DB
        const schemaName = `tenant_${tenantId.replace(/-/g, '_')}`;
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
        const response = await this.llmRouter.execute({
            model: 'gpt-4o-mini', // Default fallback model if tier is not determined
            messages: messages as any[],
            systemPrompt: systemPrompt,
            temperature: 0.7,
            routingFactors: {
                ticketValue: 50000, // mock
                complexity,
                conversationStage: stageScore,
                sentiment,
                intentType: 50 // mock
            }
        });

        const reply = response.content;
        
        if (reply) {
            return reply;
        }

        return `[Error Generating AI Response]`;
    }
}
