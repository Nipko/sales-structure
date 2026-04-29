import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { EmailService } from '../email/email.service';
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
    assignedAgentName?: string;
    contactName?: string;
    contactPhone?: string;
    lastMessage?: string;
    handoffTriggeredAt: string;
}

@Injectable()
export class HandoffService {
    private readonly logger = new Logger(HandoffService.name);

    constructor(
        private prisma: PrismaService,
        private redis: RedisService,
        private eventEmitter: EventEmitter2,
        private emailService: EmailService,
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

        // 4. Get contact info for notifications
        const contactInfo = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `SELECT ct.name as contact_name, ct.phone as contact_phone, ct.channel_type,
                    (SELECT content_text FROM messages WHERE conversation_id = $1::uuid ORDER BY created_at DESC LIMIT 1) as last_message
             FROM conversations cv
             LEFT JOIN contacts ct ON ct.id = cv.contact_id
             WHERE cv.id = $1::uuid`,
            [conversationId],
        );
        const contact = contactInfo?.[0] || {};

        // 5. Try to auto-assign to an available agent
        const assignedTo = await this.tryAutoAssign(tenantId, schemaName, conversationId);

        // 6. Get assigned agent name for notifications
        let assignedAgentName: string | undefined;
        let assignedAgentEmail: string | undefined;
        if (assignedTo) {
            const agentRows = await this.prisma.$queryRaw<any[]>`
                SELECT TRIM(first_name || ' ' || last_name) as name, email
                FROM users WHERE id = ${assignedTo}::uuid LIMIT 1
            `;
            assignedAgentName = agentRows?.[0]?.name;
            assignedAgentEmail = agentRows?.[0]?.email;

            // Create conversation assignment with SLA deadline (5 min default)
            await this.prisma.executeInTenantSchema(schemaName,
                `INSERT INTO conversation_assignments (conversation_id, agent_id, assigned_at, sla_deadline)
                 VALUES ($1::uuid, $2::uuid, NOW(), NOW() + interval '5 minutes')
                 ON CONFLICT (conversation_id, agent_id) WHERE resolved_at IS NULL DO NOTHING`,
                [conversationId, assignedTo],
            ).catch(() => {}); // Table might not have unique constraint yet
        }

        // 7. Store handoff state in Redis for fast lookup
        const handoffId = `hoff_${Date.now()}`;
        const handoffTriggeredAt = new Date().toISOString();
        await this.redis.set(
            `handoff:${tenantId}:${conversationId}`,
            JSON.stringify({
                handoffId,
                reason,
                startedAt: handoffTriggeredAt,
                contactId: message.contactId,
                assignedTo,
            }),
            86400,
        );

        // 8. Emit event with full context for notifications
        this.eventEmitter.emit('handoff.escalated', {
            tenantId,
            conversationId,
            reason,
            summary,
            assignedTo,
            assignedAgentName,
            contactName: contact.contact_name || message.contactId,
            contactPhone: contact.contact_phone || '',
            lastMessage: (contact.last_message || '').substring(0, 100),
            handoffTriggeredAt,
        } as HandoffEscalatedEvent);

        // 9. Send email to assigned agent (fire-and-forget)
        if (assignedAgentEmail) {
            this.emailService.send({
                to: assignedAgentEmail,
                subject: `🔴 Handoff: ${contact.contact_name || 'Cliente'} necesita atención`,
                html: `
                    <div style="font-family: sans-serif; max-width: 500px;">
                        <h2 style="color: #e74c3c;">Conversación escalada</h2>
                        <p><strong>Cliente:</strong> ${contact.contact_name || 'Desconocido'}</p>
                        <p><strong>Teléfono:</strong> ${contact.contact_phone || 'N/A'}</p>
                        <p><strong>Razón:</strong> ${reason}</p>
                        <p><strong>Último mensaje:</strong></p>
                        <blockquote style="border-left: 3px solid #e74c3c; padding-left: 12px; color: #555;">
                            ${(contact.last_message || '').substring(0, 200)}
                        </blockquote>
                        <p style="margin-top: 20px;">
                            <a href="https://admin.parallly-chat.cloud/admin/inbox" style="background: #6366f1; color: white; padding: 10px 20px; text-decoration: none; border-radius: 8px;">
                                Abrir Inbox
                            </a>
                        </p>
                    </div>
                `,
            }).catch(e => this.logger.warn(`Handoff email failed: ${e.message}`));
        }

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
                  AND u.availability_status = 'online'
                  AND (SELECT COUNT(*) FROM "${schemaName}".conversations c
                       WHERE c.assigned_to = u.id::text AND c.status = 'with_human') < u.max_capacity
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
