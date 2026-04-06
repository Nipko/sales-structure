import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { NormalizedMessage, TenantConfig } from '@parallext/shared';

export interface HandoffResult {
    handoffId: string;
    assignedTo?: string;
    summary: string;
    reason: string;
}

export interface HandoffEscalatedEvent {
    tenantId: string;
    conversationId: string;
    reason: string;
    summary: string;
    assignedTo: string | null;
}

@Injectable()
export class HandoffService {
    private readonly logger = new Logger(HandoffService.name);

    constructor(
        private prisma: PrismaService,
        private redis: RedisService,
        private eventEmitter: EventEmitter2,
    ) {}

    /**
     * Evaluate if a conversation should be escalated to a human agent.
     * Returns the reason string if handoff should trigger, null otherwise.
     */
    shouldHandoff(message: string, conversation: any, config: TenantConfig): string | null {
        const triggers = config.behavior?.handoffTriggers || [];
        const text = message.toLowerCase();

        // 1. Explicit request for human
        const humanKeywords = [
            'hablar con un humano', 'agente humano', 'persona real',
            'hablar con alguien', 'operador', 'asesor humano',
            'quiero hablar con una persona', 'talk to a human', 'human agent',
        ];
        if (humanKeywords.some(kw => text.includes(kw))) {
            return 'explicit_human_request';
        }

        // 2. Frustration / complaint detection
        const frustrationKeywords = [
            'queja', 'reclamo', 'molesto', 'furioso', 'inaceptable',
            'devolucion', 'reembolso', 'pésimo', 'horrible', 'terrible',
            'no funciona', 'estafa', 'demanda', 'abogado',
        ];
        if (frustrationKeywords.some(kw => text.includes(kw))) {
            return 'frustration_detected';
        }

        // 3. Too many failed AI attempts
        const failedAttempts = conversation.metadata?.failedAttempts || 0;
        if (failedAttempts >= 3) {
            return 'max_failed_attempts';
        }

        // 4. Custom triggers from persona YAML config
        for (const trigger of triggers) {
            if (text.includes(trigger.toLowerCase())) {
                return `custom_trigger:${trigger}`;
            }
        }

        return null;
    }

    /**
     * Execute handoff: mark conversation, emit event for agent console notification,
     * assign to available agent if possible.
     */
    async executeHandoff(
        tenantId: string,
        conversationId: string,
        message: NormalizedMessage,
        reason: string,
    ): Promise<HandoffResult> {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);

        // 1. Build AI summary from recent messages
        const recentMessages = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `SELECT direction, content_text FROM messages
             WHERE conversation_id = $1::uuid ORDER BY created_at DESC LIMIT 10`,
            [conversationId],
        );
        const summary = this.buildSummary(recentMessages || []);

        // 2. Update conversation status to waiting_human
        await this.prisma.executeInTenantSchema(schemaName,
            `UPDATE conversations
             SET status = 'waiting_human',
                 metadata = jsonb_set(
                     COALESCE(metadata, '{}'::jsonb),
                     '{handoff}',
                     $2::jsonb
                 ),
                 updated_at = NOW()
             WHERE id = $1::uuid`,
            [conversationId, JSON.stringify({
                reason,
                summary,
                startedAt: new Date().toISOString(),
                contactId: message.contactId,
            })],
        );

        // 3. Create internal note documenting the handoff
        await this.prisma.executeInTenantSchema(schemaName,
            `INSERT INTO internal_notes (conversation_id, agent_id, content, created_at)
             VALUES ($1::uuid, NULL, $2, NOW())`,
            [conversationId, `🔄 **Handoff automático** — Razón: ${reason}\n\n${summary}`],
        );

        // 4. Try to auto-assign to an available agent
        const assignedTo = await this.tryAutoAssign(tenantId, schemaName, conversationId);

        // 5. Store handoff state in Redis for fast lookup
        const handoffId = `hoff_${Date.now()}`;
        await this.redis.set(
            `handoff:${tenantId}:${conversationId}`,
            JSON.stringify({
                handoffId,
                reason,
                startedAt: new Date().toISOString(),
                contactId: message.contactId,
                assignedTo,
            }),
            86400,
        );

        // 6. Emit event — AgentConsoleGateway listens for this
        this.eventEmitter.emit('handoff.escalated', {
            tenantId,
            conversationId,
            reason,
            summary,
            assignedTo,
        } as HandoffEscalatedEvent);

        this.logger.log(
            `Handoff executed: conversation=${conversationId}, reason=${reason}, assignedTo=${assignedTo || 'unassigned'}`,
        );

        return { handoffId, assignedTo: assignedTo || undefined, summary, reason };
    }

    /**
     * Complete handoff: return conversation back to AI
     */
    async completeHandoff(tenantId: string, conversationId: string): Promise<void> {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);

        await this.prisma.executeInTenantSchema(schemaName,
            `UPDATE conversations SET status = 'active', assigned_to = NULL, updated_at = NOW() WHERE id = $1::uuid`,
            [conversationId],
        );

        await this.redis.del(`handoff:${tenantId}:${conversationId}`);

        this.eventEmitter.emit('handoff.completed', { tenantId, conversationId });

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
     * Get handoff details from Redis
     */
    async getHandoffDetails(tenantId: string, conversationId: string): Promise<any | null> {
        const data = await this.redis.get(`handoff:${tenantId}:${conversationId}`);
        return data ? JSON.parse(data) : null;
    }

    /**
     * Try to auto-assign to an available agent (least-loaded)
     */
    private async tryAutoAssign(tenantId: string, schemaName: string, conversationId: string): Promise<string | null> {
        try {
            const agents = await this.prisma.$queryRawUnsafe(`
                SELECT u.id, TRIM(u.first_name || ' ' || u.last_name) as name,
                    (SELECT COUNT(*) FROM "${schemaName}".conversations c
                     WHERE c.assigned_to = u.id::text AND c.status = 'with_human') as active_count
                FROM public.users u
                WHERE u.tenant_id = $1::uuid
                  AND u.is_active = true
                  AND u.role IN ('tenant_admin', 'tenant_supervisor', 'tenant_agent')
                ORDER BY active_count ASC
                LIMIT 1
            `, tenantId) as any[];

            if (agents?.length) {
                const agent = agents[0];
                await this.prisma.executeInTenantSchema(schemaName,
                    `UPDATE conversations SET assigned_to = $2, status = 'with_human' WHERE id = $1::uuid`,
                    [conversationId, agent.id],
                );
                return agent.id;
            }
        } catch (e: any) {
            this.logger.warn(`Auto-assign failed: ${e.message}`);
        }
        return null;
    }

    /**
     * Build a concise summary from recent messages for the human agent
     */
    private buildSummary(messages: Array<{ direction: string; content_text: string }>): string {
        const reversed = [...messages].reverse();
        const lines = reversed.map(m => {
            const prefix = m.direction === 'inbound' ? '👤 Cliente' : '🤖 IA';
            const text = (m.content_text || '').substring(0, 150);
            return `${prefix}: ${text}`;
        });

        return `**Últimos ${reversed.length} mensajes antes del handoff:**\n${lines.join('\n')}`;
    }
}
