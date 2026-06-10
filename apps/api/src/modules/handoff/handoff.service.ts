import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { EmailService } from '../email/email.service';
import { EmailTemplatesService } from '../email-templates/email-templates.service';
import { LLMRouterService } from '../ai/router/llm-router.service';
import { AiResolutionService } from '../analytics/ai-resolution.service';
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
        private emailTemplates: EmailTemplatesService,
        private llmRouter: LLMRouterService,
        private aiResolutionService: AiResolutionService,
    ) {}

    /**
     * Evaluate if a conversation should be escalated to a human agent.
     * Returns the reason string if handoff should trigger, null otherwise.
     */
    shouldHandoff(message: string, conversation: any, config: TenantConfig): string | null {
        const triggers = config.behavior?.handoffTriggers || [];
        const text = message.toLowerCase();

        // Decision categories — each can be toggled per tenant via
        // config.behavior.handoffCategories ({ complaint:false } disables it).
        // Absent config = all enabled (previous behavior). The returned reason IS
        // the category, so the console can route (manager for discounts, support
        // for complaints, etc.).
        const categoriesCfg = (config.behavior as any)?.handoffCategories as Record<string, boolean> | undefined;
        const enabled = (cat: string) => !categoriesCfg || categoriesCfg[cat] !== false;

        // 1. Explicit request for a human
        const humanKeywords = [
            'hablar con un humano', 'agente humano', 'persona real',
            'hablar con alguien', 'operador', 'asesor humano',
            'quiero hablar con una persona', 'talk to a human', 'human agent',
        ];
        if (enabled('human_request') && humanKeywords.some(kw => text.includes(kw))) {
            return 'human_request';
        }

        // 2. Complaint / frustration
        const complaintKeywords = [
            'queja', 'reclamo', 'molesto', 'furioso', 'inaceptable',
            'devolucion', 'devolución', 'reembolso', 'pésimo', 'pesimo', 'horrible', 'terrible',
            'no funciona', 'estafa', 'demanda', 'abogado',
        ];
        if (enabled('complaint') && complaintKeywords.some(kw => text.includes(kw))) {
            return 'complaint';
        }

        // 3. Out-of-policy discount / price negotiation — route to someone who can
        // approve, instead of letting the AI improvise a discount.
        const discountKeywords = [
            'descuento', 'rebaja', 'mas barato', 'más barato', 'precio especial',
            'me lo dejas', 'me lo deja en', 'oferta especial', 'mejor precio', 'hacer precio',
        ];
        if (enabled('discount_request') && discountKeywords.some(kw => text.includes(kw))) {
            return 'discount_request';
        }

        // 4. VIP customer (flagged on the contact/lead/memory) — best-effort from
        // what the conversation row carries.
        const isVip = conversation?.metadata?.vip === true || conversation?.is_vip === true
            || conversation?.lead?.is_vip === true || conversation?.contact?.is_vip === true;
        if (enabled('vip') && isVip) {
            return 'vip';
        }

        // 5. Too many failed AI attempts
        const failedAttempts = conversation.metadata?.failedAttempts || 0;
        if (enabled('max_failed_attempts') && failedAttempts >= 3) {
            return 'max_failed_attempts';
        }

        // 6. Custom triggers from persona config
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
             WHERE conversation_id = $1::uuid ORDER BY created_at DESC LIMIT 20`,
            [conversationId],
        );
        const summary = await this.generateAISummary(recentMessages || [], reason, tenantId);

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

        // 2b. Mark conversation as handed off for AI resolution tracking
        await this.aiResolutionService.ensureResolutionColumns(schemaName);
        await this.prisma.executeInTenantSchema(schemaName,
            `UPDATE conversations SET was_handed_off = true, handoff_at = NOW() WHERE id = $1::uuid`,
            [conversationId],
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

        // 5. Try to auto-assign to an available agent (skill-based routing)
        const assignedTo = await this.tryAutoAssign(tenantId, schemaName, conversationId, reason);

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

            // Create conversation assignment
            await this.prisma.executeInTenantSchema(schemaName,
                `INSERT INTO conversation_assignments (conversation_id, agent_id, assigned_at)
                 VALUES ($1::uuid, $2::uuid, NOW())
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

        // 9. Send email to assigned agent via template (fire-and-forget)
        if (assignedAgentEmail) {
            const contactName = contact.contact_name || 'Cliente';
            const contactPhone = contact.contact_phone || 'N/A';
            const lastMessage = (contact.last_message || '').substring(0, 200);

            try {
                const sent = await this.emailTemplates.renderAndSend(schemaName, 'handoff_notification', assignedAgentEmail, {
                    agent_name: assignedAgentName || 'Agente',
                    contact_name: contactName,
                    contact_phone: contactPhone,
                    reason,
                    last_message: lastMessage,
                    inbox_url: 'https://admin.parallly-chat.cloud/admin/inbox',
                });
                if (!sent) throw new Error('Template not found or inactive');
            } catch (e: any) {
                // Fallback to direct email if template is not yet seeded
                this.emailService.send({
                    to: assignedAgentEmail,
                    subject: `🔴 Handoff: ${contactName} necesita atención`,
                    html: `
                        <div style="font-family: sans-serif; max-width: 500px;">
                            <h2 style="color: #e74c3c;">Conversación escalada</h2>
                            <p><strong>Cliente:</strong> ${contactName}</p>
                            <p><strong>Teléfono:</strong> ${contactPhone}</p>
                            <p><strong>Razón:</strong> ${reason}</p>
                            <p><strong>Último mensaje:</strong></p>
                            <blockquote style="border-left: 3px solid #e74c3c; padding-left: 12px; color: #555;">
                                ${lastMessage}
                            </blockquote>
                            <p style="margin-top: 20px;">
                                <a href="https://admin.parallly-chat.cloud/admin/inbox" style="background: #6366f1; color: white; padding: 10px 20px; text-decoration: none; border-radius: 8px;">
                                    Abrir Inbox
                                </a>
                            </p>
                        </div>
                    `,
                }).catch(fe => this.logger.warn(`Handoff fallback email failed: ${fe.message}`));
            }
        } else {
            // Unassigned case: fetch tenant's billingEmail or fallback to active tenant_admin email
            let fallbackEmail: string | undefined;
            try {
                const tenant = await this.prisma.tenant.findUnique({
                    where: { id: tenantId },
                    select: { billingEmail: true },
                });
                fallbackEmail = tenant?.billingEmail || undefined;
            } catch (e: any) {
                this.logger.warn(`Failed to fetch tenant billing email: ${e.message}`);
            }

            if (!fallbackEmail) {
                try {
                    const adminUser = await this.prisma.user.findFirst({
                        where: { tenantId, role: 'tenant_admin', isActive: true },
                        select: { email: true },
                    });
                    fallbackEmail = adminUser?.email || undefined;
                } catch (e: any) {
                    this.logger.warn(`Failed to fetch fallback tenant admin email: ${e.message}`);
                }
            }

            if (fallbackEmail) {
                const contactName = contact.contact_name || 'Cliente';
                const contactPhone = contact.contact_phone || 'N/A';
                const lastMessage = (contact.last_message || '').substring(0, 200);

                try {
                    const sent = await this.emailTemplates.renderAndSend(schemaName, 'handoff_notification_unassigned', fallbackEmail, {
                        contact_name: contactName,
                        contact_phone: contactPhone,
                        reason,
                        last_message: lastMessage,
                        inbox_url: 'https://admin.parallly-chat.cloud/admin/inbox',
                    });
                    if (!sent) throw new Error('Template not found or inactive');
                } catch (e: any) {
                    // Fallback to direct email
                    this.emailService.send({
                        to: fallbackEmail,
                        subject: `🔴 URGENTE: Lead esperando atención humana en cola de Parallly`,
                        html: `
                            <div style="font-family: sans-serif; max-width: 500px; padding: 20px; border: 1px solid #eee; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
                                <h2 style="color: #e67e22; margin-top: 0;">🔴 Lead Esperando Atención Humana</h2>
                                <p style="font-size: 14px; color: #555;">Hay un nuevo lead esperando en la cola sin asignar y requiere atención humana urgente.</p>
                                <hr style="border: 0; border-top: 1px solid #eee; margin: 15px 0;" />
                                <p style="font-size: 14px; margin: 5px 0;"><strong>Cliente:</strong> ${contactName}</p>
                                <p style="font-size: 14px; margin: 5px 0;"><strong>Teléfono:</strong> ${contactPhone}</p>
                                <p style="font-size: 14px; margin: 5px 0;"><strong>Razón:</strong> ${reason}</p>
                                <p style="font-size: 14px; margin: 15px 0 5px 0;"><strong>Último mensaje del cliente:</strong></p>
                                <blockquote style="border-left: 3px solid #e67e22; padding: 5px 12px; margin: 5px 0; color: #666; background: #fafafa; font-style: italic;">
                                    ${lastMessage}
                                </blockquote>
                                <div style="margin-top: 25px; text-align: center;">
                                    <a href="https://admin.parallly-chat.cloud/admin/inbox" style="background: linear-gradient(135deg, #6366f1, #4f46e5); color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block; box-shadow: 0 2px 4px rgba(99,102,241,0.2);">
                                        Abrir Agent Console (Inbox)
                                    </a>
                                </div>
                            </div>
                        `,
                    }).catch(fe => this.logger.warn(`Handoff fallback unassigned email failed: ${fe.message}`));
                }
            }
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
            `UPDATE conversations
             SET status = 'active',
                 assigned_to = NULL,
                 metadata = COALESCE(metadata, '{}'::jsonb) - 'bookingState' - 'bookingStateUpdatedAt' - 'toolContext' - 'toolContextUpdatedAt',
                 updated_at = NOW()
             WHERE id = $1::uuid`,
            [conversationId],
        );

        await this.redis.del(`booking:${conversationId}`).catch(() => {});
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
    private async tryAutoAssign(tenantId: string, schemaName: string, conversationId: string, reason?: string): Promise<string | null> {
        try {
            // 1. Get contact_id from the conversation
            const convRows = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT contact_id FROM conversations WHERE id = $1::uuid`,
                [conversationId]
            );
            const contactId = convRows?.[0]?.contact_id;
            
            // 2. Fetch the lead score (default to 0 if not found)
            let leadScore = 0;
            if (contactId) {
                const leadRows = await this.prisma.executeInTenantSchema<any[]>(
                    schemaName,
                    `SELECT score FROM leads WHERE contact_id = $1::uuid LIMIT 1`,
                    [contactId]
                );
                leadScore = leadRows?.[0]?.score || 0;
            }

            // 3. Fetch the vertical configuration for this tenant
            const tenantRows = await this.prisma.$queryRawUnsafe(
                `SELECT settings FROM public.tenants WHERE id = $1::uuid LIMIT 1`,
                tenantId
            ) as any[];
            const settings = tenantRows?.[0]?.settings || {};
            const vertical = settings.verticalConfig?.industry || '';

            // 4. Map handoff CATEGORY to skill tag for routing (the typed reason
            // from shouldHandoff lets us send each kind to the right person).
            const skillMap: Record<string, string> = {
                complaint: 'complaints',
                human_request: 'general',
                discount_request: 'sales',   // someone who can approve a price/discount
                vip: 'senior',
                max_failed_attempts: 'technical',
                // legacy reason strings (back-compat with any in-flight conversations)
                frustration_detected: 'complaints',
                explicit_human_request: 'general',
            };
            const preferredSkill = reason ? skillMap[reason] || null : null;

            // 5. Build prioritized skills array
            const targetSkills: string[] = [];

            // A. VIP Lead (Score >= 80) -> route to senior or supervisor agents
            if (leadScore >= 80) {
                targetSkills.push('senior', 'supervisor');
                this.logger.log(`[AutoAssign] VIP Lead detected (Score=${leadScore}) for conversation ${conversationId}. Prioritizing senior/supervisor agents.`);
            }

            // B. Health Vertical -> route to clinical or doctor agents
            const isHealthVertical = ['salud', 'health', 'clinica', 'odontologia', 'medicina', 'bienestar'].some(v => 
                vertical.toLowerCase().includes(v)
            );
            if (isHealthVertical) {
                targetSkills.push('clinical', 'doctor');
                this.logger.log(`[AutoAssign] Health vertical detected ("${vertical}") for conversation ${conversationId}. Prioritizing clinical/doctor agents.`);
            }

            // C. Fallback to mapped handoff reason skill tag
            if (preferredSkill) {
                targetSkills.push(preferredSkill);
            }

            // Prefer agents with the highest overlap of target skills, then fallback to least-loaded
            const agents = await this.prisma.$queryRawUnsafe(`
                SELECT u.id, TRIM(u.first_name || ' ' || u.last_name) as name,
                    u.skill_tags,
                    (SELECT COUNT(*) FROM "${schemaName}".conversations c
                     WHERE c.assigned_to = u.id::text AND c.status = 'with_human') as active_count,
                    (SELECT COUNT(*)::int FROM unnest(u.skill_tags) x WHERE x = ANY($2::text[])) as matching_skills_count
                FROM public.users u
                WHERE u.tenant_id = $1::uuid
                  AND u.is_active = true
                  AND u.role IN ('tenant_admin', 'tenant_supervisor', 'tenant_agent')
                  AND u.availability_status = 'online'
                  AND (SELECT COUNT(*) FROM "${schemaName}".conversations c
                       WHERE c.assigned_to = u.id::text AND c.status = 'with_human') < u.max_capacity
                ORDER BY matching_skills_count DESC, active_count ASC
                LIMIT 1
            `, tenantId, targetSkills) as any[];

            if (agents?.length) {
                const agent = agents[0];
                await this.prisma.executeInTenantSchema(schemaName,
                    `UPDATE conversations SET assigned_to = $2::uuid, status = 'with_human' WHERE id = $1::uuid`,
                    [conversationId, agent.id],
                );
                this.logger.log(`[AutoAssign] Automatically assigned conversation ${conversationId} to agent "${agent.name}" (Active Count=${agent.active_count}, Matching Skills=${agent.matching_skills_count})`);
                return agent.id;
            }
        } catch (e: any) {
            this.logger.warn(`Auto-assign failed: ${e.message}`);
        }
        return null;
    }

    private async generateAISummary(
        messages: Array<{ direction: string; content_text: string }>,
        reason: string,
        tenantId: string,
    ): Promise<string> {
        const reversed = [...messages].reverse();
        if (reversed.length === 0) return 'Sin mensajes previos.';

        const transcript = reversed.map(m => {
            const role = m.direction === 'inbound' ? 'Cliente' : 'Asistente';
            return `${role}: ${(m.content_text || '').substring(0, 300)}`;
        }).join('\n');

        try {
            const response = await this.llmRouter.execute({
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: transcript }],
                systemPrompt: [
                    'You are an internal tool that creates brief handoff summaries for human agents.',
                    'Analyze the conversation and produce a structured summary in Spanish with:',
                    '1. **Tema**: What the customer wants (1 sentence)',
                    '2. **Contexto**: Key facts mentioned (2-3 bullets)',
                    '3. **Estado**: Where the conversation left off',
                    `4. **Razón de escalación**: ${reason}`,
                    'Be concise — max 150 words. No greetings, no filler.',
                ].join('\n'),
                temperature: 0.2,
                maxTokens: 400,
                tenantId,
            });

            if (response.content) return response.content;
        } catch (err: any) {
            this.logger.warn(`AI summary failed, using fallback: ${err.message}`);
        }

        return this.buildFallbackSummary(reversed);
    }

    private buildFallbackSummary(messages: Array<{ direction: string; content_text: string }>): string {
        const lines = messages.map(m => {
            const prefix = m.direction === 'inbound' ? 'Cliente' : 'IA';
            return `${prefix}: ${(m.content_text || '').substring(0, 150)}`;
        });
        return `**Últimos ${messages.length} mensajes antes del handoff:**\n${lines.join('\n')}`;
    }
}
