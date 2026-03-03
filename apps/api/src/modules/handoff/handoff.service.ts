import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { NormalizedMessage, TenantConfig } from '@parallext/shared';

export interface HandoffResult {
    handoffId: string;
    externalConversationId?: string;
    assignedTo?: string;
    summary: string;
}

@Injectable()
export class HandoffService {
    private readonly logger = new Logger(HandoffService.name);

    constructor(
        private prisma: PrismaService,
        private redis: RedisService,
        private configService: ConfigService,
    ) { }

    /**
     * Evaluate if a conversation should be escalated to a human agent.
     * Checks trigger conditions from the tenant's persona config.
     */
    shouldHandoff(message: string, conversation: any, config: TenantConfig): boolean {
        const triggers = config.behavior?.handoffTriggers || [];
        const text = message.toLowerCase();

        // 1. Explicit request for human
        const humanKeywords = [
            'hablar con un humano', 'agente humano', 'persona real',
            'hablar con alguien', 'operador', 'asesor humano',
            'quiero hablar con una persona', 'talk to a human', 'human agent',
        ];
        if (humanKeywords.some(kw => text.includes(kw))) {
            this.logger.log('Handoff triggered: explicit human request');
            return true;
        }

        // 2. Frustration / complaint detection
        const frustrationKeywords = [
            'queja', 'reclamo', 'molesto', 'furioso', 'inaceptable',
            'devolucion', 'reembolso', 'pésimo', 'horrible', 'terrible',
            'no funciona', 'estafa', 'demanda', 'abogado',
        ];
        if (frustrationKeywords.some(kw => text.includes(kw))) {
            this.logger.log('Handoff triggered: frustration/complaint detected');
            return true;
        }

        // 3. Too many failed AI attempts (tracked via conversation metadata)
        const failedAttempts = conversation.metadata?.failedAttempts || 0;
        if (failedAttempts >= 3) {
            this.logger.log('Handoff triggered: 3+ failed AI attempts');
            return true;
        }

        // 4. Custom triggers from YAML config
        for (const trigger of triggers) {
            if (text.includes(trigger.toLowerCase())) {
                this.logger.log(`Handoff triggered: custom trigger "${trigger}"`);
                return true;
            }
        }

        return false;
    }

    /**
     * Execute the handoff: mark conversation, create Chatwoot ticket, notify
     */
    async executeHandoff(
        tenantId: string,
        conversationId: string,
        message: NormalizedMessage,
        aiSummary: string,
    ): Promise<HandoffResult> {
        const schemaName = `tenant_${tenantId.replace(/-/g, '_')}`;

        // 1. Mark conversation as waiting for human
        await this.prisma.executeInTenantSchema(schemaName,
            `UPDATE conversation SET status = 'waiting_human', updated_at = NOW() WHERE id = $1`,
            [conversationId]
        );

        // 2. Create handoff record
        const handoff = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `INSERT INTO conversation (id, contact_id, status, stage, metadata)
       SELECT gen_random_uuid(), contact_id, 'with_human', stage, 
              jsonb_build_object('handoff_reason', $2, 'ai_summary', $3, 'original_conversation', $1)
       FROM conversation WHERE id = $1
       RETURNING *`,
            [conversationId, 'auto_escalation', aiSummary]
        ).then(res => res?.[0]);

        // 3. Create Chatwoot conversation (if configured)
        const chatwootResult = await this.createChatwootConversation(
            tenantId, message.contactId, aiSummary
        );

        // 4. Store handoff state in Redis for fast lookup
        await this.redis.set(
            `handoff:${tenantId}:${conversationId}`,
            JSON.stringify({
                handoffId: handoff?.id || 'unknown',
                startedAt: new Date().toISOString(),
                contactId: message.contactId,
                chatwootId: chatwootResult?.conversationId,
            }),
            86400 // 24h TTL
        );

        this.logger.log(
            `Handoff executed for conversation ${conversationId} → Chatwoot: ${chatwootResult?.conversationId || 'N/A'}`
        );

        return {
            handoffId: handoff?.id || 'unknown',
            externalConversationId: chatwootResult?.conversationId,
            summary: aiSummary,
        };
    }

    /**
     * Create a conversation in Chatwoot via API
     */
    private async createChatwootConversation(
        tenantId: string,
        contactId: string,
        summary: string,
    ): Promise<{ conversationId: string } | null> {
        const chatwootUrl = this.configService.get<string>('CHATWOOT_URL');
        const chatwootToken = this.configService.get<string>('CHATWOOT_API_TOKEN');

        if (!chatwootUrl || !chatwootToken) {
            this.logger.warn('Chatwoot not configured, skipping external handoff');
            return null;
        }

        try {
            const accountId = this.configService.get<string>('CHATWOOT_ACCOUNT_ID') || '1';

            // Create contact in Chatwoot if not exists
            const response = await fetch(`${chatwootUrl}/api/v1/accounts/${accountId}/conversations`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'api_access_token': chatwootToken,
                },
                body: JSON.stringify({
                    source_id: contactId,
                    inbox_id: 1, // TODO: Map to tenant's inbox
                    contact_id: null, // Will auto-create
                    status: 'open',
                    additional_attributes: {
                        tenant_id: tenantId,
                        ai_summary: summary,
                        source: 'parallext_handoff',
                    },
                }),
            });

            if (!response.ok) {
                this.logger.error(`Chatwoot API error: ${response.status} ${response.statusText}`);
                return null;
            }

            const data = await response.json();

            // Send summary as first message
            await fetch(`${chatwootUrl}/api/v1/accounts/${accountId}/conversations/${data.id}/messages`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'api_access_token': chatwootToken,
                },
                body: JSON.stringify({
                    content: `🤖 **Resumen de IA (Handoff Automático)**\n\n${summary}`,
                    message_type: 'outgoing',
                    private: true,
                }),
            });

            return { conversationId: String(data.id) };
        } catch (error) {
            this.logger.error(`Failed to create Chatwoot conversation: ${error}`);
            return null;
        }
    }

    /**
     * Complete handoff: return conversation back to AI
     */
    async completeHandoff(tenantId: string, conversationId: string): Promise<void> {
        const schemaName = `tenant_${tenantId.replace(/-/g, '_')}`;

        await this.prisma.executeInTenantSchema(schemaName,
            `UPDATE conversation SET status = 'active', updated_at = NOW() WHERE id = $1`,
            [conversationId]
        );

        await this.redis.del(`handoff:${tenantId}:${conversationId}`);
        this.logger.log(`Handoff completed for conversation ${conversationId}, returned to AI`);
    }

    /**
     * Check if a conversation is currently in handoff
     */
    async isInHandoff(tenantId: string, conversationId: string): Promise<boolean> {
        const data = await this.redis.get(`handoff:${tenantId}:${conversationId}`);
        return !!data;
    }

    /**
     * Build a concise AI summary for the human agent
     */
    buildSummary(messages: Array<{ role: string; content: string }>): string {
        const lastMessages = messages.slice(-10);
        const lines = lastMessages.map(m => {
            const prefix = m.role === 'user' ? '👤 Cliente' : '🤖 IA';
            return `${prefix}: ${m.content.substring(0, 150)}`;
        });

        return `**Últimos ${lastMessages.length} mensajes antes del handoff:**\n${lines.join('\n')}`;
    }
}
