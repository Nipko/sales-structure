import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { CronLockService } from '../redis/cron-lock.service';
import { EmailService } from '../email/email.service';
import { EmailTemplatesService } from '../email-templates/email-templates.service';
import { LLMRouterService } from '../ai/router/llm-router.service';
import { AiResolutionService } from '../analytics/ai-resolution.service';
import {
    ConversationAssignedEvent,
    NormalizedMessage,
    StructuredHandoffSummary,
    TenantConfig,
} from '@parallext/shared';
import { handoffAgentI18n } from './handoff-i18n';
import {
    buildDeterministicHandoffSummary,
    formatLegacyHandoffSummary,
    HandoffMessageEvidence,
    HandoffSummaryContext,
    HandoffTraceEvidence,
    parseLlmHandoffSummary,
    sanitizeHandoffText,
} from './handoff-summary.util';

/**
 * How long an escalated conversation may sit with nobody answering before the
 * agent is allowed to speak again. Long enough that a team on a normal shift is
 * never interrupted; short enough that a customer is not left in silence for a
 * day because a handoff fired at closing time.
 */
const UNATTENDED_HANDOFF_MINUTES = 180;

export interface HandoffResult {
    handoffId: string;
    assignedTo?: string;
    summary: string;
    structuredSummary: StructuredHandoffSummary;
    reason: string;
}

export interface HandoffEscalatedEvent {
    tenantId: string;
    conversationId: string;
    reason: string;
    summary: string;
    structuredSummary: StructuredHandoffSummary;
    traceId: string;
    schemaName: string;
    assignedTo: string | null;
    assignedAgentName?: string;
    contactName?: string;
    contactPhone?: string;
    lastMessage?: string;
    handoffTriggeredAt: string;
}

interface AutoAssignment {
    agentId: string;
    contactId?: string;
    phone?: string;
}

@Injectable()
export class HandoffService {
    private readonly logger = new Logger(HandoffService.name);
    private readonly handoffSchemaReady = new Set<string>();

    constructor(
        private prisma: PrismaService,
        private redis: RedisService,
        private eventEmitter: EventEmitter2,
        private emailService: EmailService,
        private emailTemplates: EmailTemplatesService,
        private llmRouter: LLMRouterService,
        private aiResolutionService: AiResolutionService,
        private cronLock: CronLockService,
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
        await this.ensureStructuredHandoffColumns(schemaName);
        // Tenant language drives the email template variant (fallback 'es').
        // These are agent/admin-facing notifications, so tenant language is the
        // right choice. TODO(i18n): for customer-facing emails use the
        // conversation's detected language instead.
        const lang = await this.getTenantLanguage(tenantId);

        // 1. Build a bounded, evidence-linked summary. The legacy string is
        // retained for existing inbox/email consumers.
        const recentMessages = await this.prisma.executeInTenantSchema<HandoffMessageEvidence[]>(schemaName,
            `SELECT id::text, direction, content_text, metadata, created_at FROM messages
             WHERE conversation_id = $1::uuid ORDER BY created_at DESC LIMIT 20`,
            [conversationId],
        );
        const traceEvidence = await this.loadHandoffTraceEvidence(schemaName, conversationId);
        const structuredSummary = await this.generateStructuredSummary({
            tenantId,
            conversationId,
            reason,
            language: lang,
            messages: recentMessages || [],
            messageMetadata: message.metadata,
            ...traceEvidence,
            generatedAt: new Date().toISOString(),
        });
        const summary = formatLegacyHandoffSummary(structuredSummary);
        const handoffTriggeredAt = structuredSummary.generatedAt;

        // 2. Update conversation status to waiting_human
        await this.prisma.executeInTenantSchema(schemaName,
            `UPDATE conversations
             SET status = 'waiting_human',
                 metadata = jsonb_set(
                     COALESCE(metadata, '{}'::jsonb),
                     '{handoff}',
                     $2::jsonb
                 ),
                 handoff_summary = $3::jsonb,
                 handoff_trace_id = $4,
                 handoff_summary_generated_at = $5::timestamptz,
                 updated_at = NOW()
             WHERE id = $1::uuid`,
            [conversationId, JSON.stringify({
                reason,
                summary,
                structuredSummary,
                traceId: structuredSummary.traceId,
                startedAt: handoffTriggeredAt,
                contactId: message.contactId,
            }), JSON.stringify(structuredSummary), structuredSummary.traceId, structuredSummary.generatedAt],
        );

        // 2b. Mark conversation as handed off for AI resolution tracking
        await this.aiResolutionService.ensureResolutionColumns(schemaName);
        await this.prisma.executeInTenantSchema(schemaName,
            `UPDATE conversations SET was_handed_off = true, handoff_at = NOW() WHERE id = $1::uuid`,
            [conversationId],
        );

        // 3. Create internal note documenting the handoff
        const i18n = handoffAgentI18n(lang);
        await this.prisma.executeInTenantSchema(schemaName,
            `INSERT INTO internal_notes (conversation_id, agent_id, content, created_at)
             VALUES ($1::uuid, NULL, $2, NOW())`,
            [conversationId, i18n.noteText(reason, summary)],
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
        const autoAssignment = await this.tryAutoAssign(tenantId, schemaName, conversationId, reason);
        const assignedTo = autoAssignment?.agentId || null;

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

        }

        // 7. Store handoff state in Redis for fast lookup
        const handoffId = `hoff_${Date.now()}`;
        await this.redis.set(
            `handoff:${tenantId}:${conversationId}`,
            JSON.stringify({
                handoffId,
                reason,
                startedAt: handoffTriggeredAt,
                contactId: message.contactId,
                assignedTo,
                summary,
                structuredSummary,
                traceId: structuredSummary.traceId,
            }),
            86400,
        );

        // 8. Emit event with full context for notifications
        this.eventEmitter.emit('handoff.escalated', {
            tenantId,
            conversationId,
            reason,
            summary,
            structuredSummary,
            traceId: structuredSummary.traceId,
            schemaName,
            assignedTo,
            assignedAgentName,
            contactName: contact.contact_name || message.contactId,
            contactPhone: contact.contact_phone || '',
            lastMessage: (contact.last_message || '').substring(0, 100),
            handoffTriggeredAt,
        } as HandoffEscalatedEvent);

        // 9. Send email to assigned agent via template (fire-and-forget)
        if (assignedAgentEmail) {
            const contactName = contact.contact_name || i18n.contactFallback;
            const contactPhone = contact.contact_phone || 'N/A';
            const lastMessage = (contact.last_message || '').substring(0, 200);

            try {
                const sent = await this.emailTemplates.renderAndSend(schemaName, 'handoff_notification', assignedAgentEmail, {
                    agent_name: assignedAgentName || i18n.agentFallback,
                    contact_name: contactName,
                    contact_phone: contactPhone,
                    reason,
                    last_message: lastMessage,
                    inbox_url: 'https://admin.parallly-chat.cloud/admin/inbox',
                }, lang);
                if (!sent) throw new Error('Template not found or inactive');
            } catch (e: any) {
                // Fallback to direct email if template is not yet seeded
                this.emailService.send({
                    to: assignedAgentEmail,
                    subject: i18n.assignedSubject(contactName),
                    html: i18n.assignedHtml({ contactName, contactPhone, reason, lastMessage }),
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
                const contactName = contact.contact_name || i18n.contactFallback;
                const contactPhone = contact.contact_phone || 'N/A';
                const lastMessage = (contact.last_message || '').substring(0, 200);

                try {
                    const sent = await this.emailTemplates.renderAndSend(schemaName, 'handoff_notification_unassigned', fallbackEmail, {
                        contact_name: contactName,
                        contact_phone: contactPhone,
                        reason,
                        last_message: lastMessage,
                        inbox_url: 'https://admin.parallly-chat.cloud/admin/inbox',
                    }, lang);
                    if (!sent) throw new Error('Template not found or inactive');
                } catch (e: any) {
                    // Fallback to direct email
                    this.emailService.send({
                        to: fallbackEmail,
                        subject: i18n.unassignedSubject(),
                        html: i18n.unassignedHtml({ contactName, contactPhone, reason, lastMessage }),
                    }).catch(fe => this.logger.warn(`Handoff fallback unassigned email failed: ${fe.message}`));
                }
            }
        }

        this.logger.log(
            `Handoff executed: conversation=${conversationId}, reason=${reason}, assignedTo=${assignedTo || 'unassigned'}`,
        );

        return {
            handoffId,
            assignedTo: assignedTo || undefined,
            summary,
            structuredSummary,
            reason,
        };
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
     * Hands back to the AI the conversations a person never picked up.
     *
     * `waiting_human` mutes the agent, and nothing but a human action ever
     * cleared it. The 72h auto-resolve could not help either: it only fires when
     * NOBODY has written in three days, so a customer who keeps writing into an
     * unattended handoff was silenced indefinitely — every message stored, none
     * answered, no alert anywhere.
     *
     * Only conversations where the customer is still writing and no agent ever
     * replied are returned. A handoff a person is actually working is left alone.
     */
    @Cron('*/10 * * * *')
    async returnUnattendedHandoffsCron(): Promise<void> {
        await this.cronLock.runExclusive(
            'handoff.returnUnattendedHandoffs',
            300,
            () => this.returnUnattendedHandoffs(),
            { prefer: 'api' },
        );
    }

    async returnUnattendedHandoffs(): Promise<void> {
        try {
            const tenants = await this.prisma.tenant.findMany({
                where: { isActive: true },
                select: { id: true, schemaName: true },
            });
            for (const tenant of tenants) {
                try {
                    await this.returnUnattendedHandoffsForTenant(tenant.id, tenant.schemaName);
                } catch (e: any) {
                    this.logger.warn(`[Handoff] Unattended sweep failed for ${tenant.id}: ${e.message}`);
                }
            }
        } catch (e: any) {
            this.logger.warn(`[Handoff] Unattended sweep failed: ${e.message}`);
        }
    }

    private async returnUnattendedHandoffsForTenant(tenantId: string, schemaName: string): Promise<void> {
        const stranded = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `SELECT c.id
               FROM conversations c
              WHERE c.status = 'waiting_human'
                AND c.metadata->'handoff'->>'startedAt' IS NOT NULL
                AND (c.metadata->'handoff'->>'startedAt')::timestamptz
                    < NOW() - ($1 || ' minutes')::interval
                AND COALESCE(c.metadata->'handoff'->>'returnedToAi', 'false') <> 'true'
                -- nobody from the team ever answered
                AND NOT EXISTS (
                    SELECT 1 FROM messages m
                     WHERE m.conversation_id = c.id
                       AND m.direction = 'outbound'
                       AND m.metadata->>'source' = 'agent'
                       AND m.created_at > (c.metadata->'handoff'->>'startedAt')::timestamptz
                )
                -- ...and the customer is still waiting on an answer
                AND EXISTS (
                    SELECT 1 FROM messages m
                     WHERE m.conversation_id = c.id
                       AND m.direction = 'inbound'
                       AND m.created_at > (c.metadata->'handoff'->>'startedAt')::timestamptz
                )
              LIMIT 50`,
            [String(UNATTENDED_HANDOFF_MINUTES)],
        );
        if (!stranded?.length) return;

        for (const row of stranded) {
            await this.prisma.executeInTenantSchema(schemaName,
                `UPDATE conversations
                    SET status = 'active',
                        assigned_to = NULL,
                        metadata = jsonb_set(
                            COALESCE(metadata, '{}'::jsonb),
                            '{handoff,returnedToAi}', 'true'::jsonb, true
                        ),
                        updated_at = NOW()
                  WHERE id = $1::uuid AND status = 'waiting_human'`,
                [row.id],
            );
            await this.redis.del(`handoff:${tenantId}:${row.id}`).catch(() => {});
            this.eventEmitter.emit('handoff.returned_unattended', { tenantId, conversationId: row.id });
        }
        this.logger.warn(`[Handoff] Returned ${stranded.length} unattended conversation(s) to the AI in tenant ${tenantId}`);
    }

    /**
     * Tenant's configured language as a short code (es/en/pt/fr), falling back
     * to 'es'. `tenant.language` is stored as a full locale (e.g. 'es-CO'), so
     * we strip the region — matching the convention in persona.service.
     */
    private async getTenantLanguage(tenantId: string): Promise<string> {
        try {
            const tenant = await this.prisma.tenant.findUnique({
                where: { id: tenantId },
                select: { language: true },
            });
            return (tenant?.language || 'es-CO').split('-')[0];
        } catch {
            return 'es';
        }
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
    private async tryAutoAssign(
        tenantId: string,
        schemaName: string,
        conversationId: string,
        reason?: string,
    ): Promise<AutoAssignment | null> {
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
                const assignedAt = new Date().toISOString();
                const assignment = await this.prisma.transactionInTenantSchema(
                    schemaName,
                    async (query) => {
                        const conversations = await query<Array<{ contact_id: string | null }>>(
                            // assigned_to es VARCHAR, no UUID (ver agent-console.service).
                            `UPDATE conversations
                                SET assigned_to = $2, status = 'with_human', updated_at = NOW()
                              WHERE id = $1::uuid
                              RETURNING contact_id`,
                            [conversationId, agent.id],
                        );
                        if (!conversations[0]) throw new Error(`Conversation ${conversationId} not found`);
                        await query(
                            `UPDATE conversation_assignments
                                SET resolved_at = NOW()
                              WHERE conversation_id = $1::uuid AND resolved_at IS NULL`,
                            [conversationId],
                        );
                        await query(
                            `INSERT INTO conversation_assignments (conversation_id, agent_id, assigned_at)
                             VALUES ($1::uuid, $2::uuid, $3::timestamptz)`,
                            [conversationId, agent.id, assignedAt],
                        );
                        const contactId = conversations[0].contact_id || undefined;
                        const contacts = contactId
                            ? await query<Array<{ phone: string | null }>>(
                                `SELECT phone FROM contacts WHERE id = $1::uuid LIMIT 1`,
                                [contactId],
                            )
                            : [];
                        return {
                            agentId: String(agent.id),
                            contactId,
                            phone: contacts[0]?.phone || undefined,
                        } as AutoAssignment;
                    },
                );
                this.emitConversationAssigned({
                    tenantId,
                    schemaName,
                    conversationId,
                    agentId: assignment.agentId,
                    ...(assignment.contactId ? { contactId: assignment.contactId } : {}),
                    ...(assignment.phone ? { phone: assignment.phone } : {}),
                    assignmentSource: 'auto',
                    assignedAt,
                });
                this.logger.log(`[AutoAssign] Automatically assigned conversation ${conversationId} to agent "${agent.name}" (Active Count=${agent.active_count}, Matching Skills=${agent.matching_skills_count})`);
                return assignment;
            }
        } catch (e: any) {
            this.logger.warn(`Auto-assign failed: ${e.message}`);
        }
        return null;
    }

    private emitConversationAssigned(event: ConversationAssignedEvent): void {
        try {
            this.eventEmitter.emit('conversation.assigned', event);
        } catch (error: any) {
            // The assignment transaction already committed. A listener failure
            // must not make callers retry and create a second assignment row.
            this.logger.error(`conversation.assigned listener failed: ${error.message}`);
        }
    }

    private async ensureStructuredHandoffColumns(schemaName: string): Promise<void> {
        if (this.handoffSchemaReady.has(schemaName)) return;
        const statements = [
            `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS handoff_summary JSONB`,
            `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS handoff_trace_id VARCHAR(128)`,
            `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS handoff_summary_generated_at TIMESTAMPTZ`,
        ];
        for (const statement of statements) {
            await this.prisma.executeInTenantSchema(schemaName, statement);
        }
        this.handoffSchemaReady.add(schemaName);
    }

    private async loadHandoffTraceEvidence(
        schemaName: string,
        conversationId: string,
    ): Promise<{ turnTrace: HandoffTraceEvidence | null; conversationTrace: HandoffTraceEvidence | null }> {
        let turnTrace: HandoffTraceEvidence | null = null;
        let conversationTrace: HandoffTraceEvidence | null = null;
        try {
            const rows = await this.prisma.executeInTenantSchema<HandoffTraceEvidence[]>(
                schemaName,
                `SELECT id::text, steps, created_at
                   FROM turn_traces
                  WHERE conversation_id = $1::uuid
                  ORDER BY created_at DESC LIMIT 1`,
                [conversationId],
            );
            turnTrace = rows?.[0] || null;
        } catch (error: any) {
            this.logger.debug(`No turn trace available for handoff ${conversationId}: ${error.message}`);
        }
        try {
            const rows = await this.prisma.executeInTenantSchema<HandoffTraceEvidence[]>(
                schemaName,
                `SELECT id::text, kb_sources, created_at
                   FROM conversation_traces
                  WHERE conversation_id = $1::uuid
                  ORDER BY created_at DESC LIMIT 1`,
                [conversationId],
            );
            conversationTrace = rows?.[0] || null;
        } catch (error: any) {
            this.logger.debug(`No LLM trace available for handoff ${conversationId}: ${error.message}`);
        }
        return { turnTrace, conversationTrace };
    }

    private async generateStructuredSummary(
        context: HandoffSummaryContext,
    ): Promise<StructuredHandoffSummary> {
        const fallback = buildDeterministicHandoffSummary(context);
        if (context.messages.length === 0) return fallback;

        const i18n = handoffAgentI18n(context.language);
        const { customer, assistant } = i18n.transcriptLabels;
        const transcript = [...context.messages]
            .reverse()
            .map((message) => {
                const role = message.direction === 'inbound' ? customer : assistant;
                return `${role}: ${sanitizeHandoffText(message.content_text, 300)}`;
            })
            .join('\n')
            .slice(0, 6_000);

        try {
            const response = await this.llmRouter.execute({
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: transcript }],
                systemPrompt: [
                    'You create concise internal handoff summaries from the supplied transcript only.',
                    'Return one valid JSON object and no markdown.',
                    'Required keys: customerIntent (string), knownFacts (string[]), pendingActions (string[]), confidence (number 0..1), uncertainty (string[]).',
                    'Do not include secrets, credentials, emails, phone numbers, payment-card or identity-document numbers.',
                    'Do not invent facts, tool outcomes, citations, identifiers, or actions already completed.',
                    `Output language: ${sanitizeHandoffText(context.language, 12)}. Escalation reason: ${sanitizeHandoffText(context.reason, 200)}.`,
                ].join('\n'),
                temperature: 0.1,
                maxTokens: 500,
                tenantId: context.tenantId,
                traceContext: { conversationId: context.conversationId, stage: 'handoff_summary' },
            });
            if (response.content) {
                const parsed = parseLlmHandoffSummary(response.content, fallback);
                if (parsed) return parsed;
            }
        } catch (error: any) {
            this.logger.warn(`AI handoff summary failed, using deterministic fallback: ${error.message}`);
        }
        return fallback;
    }
}
