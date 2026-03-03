import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { PersonaService } from '../persona/persona.service';
import { LLMRouterService } from '../ai/router/llm-router.service';
import { ChannelGatewayService } from '../channels/channel-gateway.service';
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

        if (conversation.isHandoff) {
            this.logger.log(`Conversation ${conversation.id} is in HUMAN HANDOFF mode. Skipping AI.`);
            // TODO: Forward to human CRM (e.g., Chatwoot)
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
            `SELECT * FROM contact WHERE identifier = $1 AND channel = $2`,
            [contactId, channelType]
        ).then(res => res[0]);

        if (!contact) {
            contact = await this.prisma.executeInTenantSchema<any[]>(schemaName,
                `INSERT INTO contact (id, identifier, channel, name) VALUES (uuid_generate_v4(), $1, $2, $3) RETURNING *`,
                [contactId, channelType, msg.metadata?.contactName || 'Unknown']
            ).then(res => res[0]);
        }

        // Find active conversation or create new
        let conversation = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `SELECT * FROM conversation WHERE contact_id = $1 AND status = 'active' ORDER BY created_at DESC LIMIT 1`,
            [contact.id]
        ).then(res => res[0]);

        if (!conversation) {
            conversation = await this.prisma.executeInTenantSchema<any[]>(schemaName,
                `INSERT INTO conversation (id, contact_id, status, stage) VALUES (uuid_generate_v4(), $1, 'active', 'greeting') RETURNING *`,
                [contact.id]
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
        const schemaName = `tenant_${tenantId.replace(/-/g, '_')}`; // simplification
        // Save to DB (Skipped full SQL for brevity in scaffolding)
        this.logger.log(`Saved user message to DB: ${msg.content.text}`);
    }

    private async saveAiMessage(tenantId: string, conversationId: string, text: string) {
        const schemaName = `tenant_${tenantId.replace(/-/g, '_')}`; // simplification
        this.logger.log(`Saved AI message to DB: ${text}`);
    }

    private async sendResponse(tenantId: string, text: string, inboundMsg: NormalizedMessage) {
        const outbound: OutboundMessage = {
            tenantId,
            channelType: inboundMsg.channelType,
            channelAccountId: inboundMsg.channelAccountId,
            to: inboundMsg.contactId,
            content: { type: 'text', text }
        };

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

        // 2. Decide Model
        const decision = this.llmRouter.selectModel({
            ticketValue: 50000, // mock
            complexity,
            conversationStage: stageScore,
            sentiment,
            intentType: 50 // mock
        });

        this.logger.log(`Routing: ${decision.reasoning}`);

        // 3. Build Prompt
        const systemPrompt = this.personaService.buildSystemPrompt(config);

        // 4. Call Model (Mocking the actual LangChain/OpenAI call for this scaffold)
        // In reality, we'd use decision.selectedModel.id to initialize the correct LangChain LLM

        // MOCK RESPONSE
        return `[Generado via ${decision.selectedTier} - ${decision.selectedModel.id}]\n\n¡Hola! Esta es una respuesta de prueba basada en tu persona ${config.persona.name}. (Complejidad: ${complexity}, Sentimiento: ${sentiment})`;
    }
}
