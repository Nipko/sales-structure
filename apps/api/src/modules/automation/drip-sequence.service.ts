import { Injectable, Logger, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
import { OutboundQueueService } from '../channels/outbound-queue.service';
import { ChannelTokenService } from '../channels/channel-token.service';
import { PersonaService } from '../persona/persona.service';
import { LLMRouterService } from '../ai/router/llm-router.service';
import { ComplianceService } from '../analytics/compliance.service';
import { SegmentsService } from '../crm/services/segments/segments.service';
import { WhatsappMessagingService } from '../whatsapp/services/whatsapp-messaging.service';
import { NURTURING_QUEUE } from './nurturing.service';
import { LANG_NAME } from './nurturing-i18n';
import { OutboundMessage } from '@parallext/shared';

// Cold-prospecting opener fallback (customer-facing) used when the LLM is
// unavailable. Keyed by 2-letter language; falls back to es. A cold prospect has
// no detected language yet, so the tenant's configured language drives this.
const OPENER_FALLBACK: Record<string, (name: string) => string> = {
    es: name => `¡Hola${name}! 👋 Te escribo del equipo. ¿Tienes un minuto para contarte cómo podemos ayudarte?`,
    en: name => `Hi${name}! 👋 I'm reaching out on behalf of the team. Do you have a minute so I can share how we can help?`,
    pt: name => `Olá${name}! 👋 Estou entrando em contato pela equipe. Você tem um minuto para eu te contar como podemos ajudar?`,
    fr: name => `Bonjour${name} ! 👋 Je vous contacte de la part de l'équipe. Avez-vous une minute pour que je vous explique comment nous pouvons vous aider ?`,
};
const openerFallback = (lang?: string) => OPENER_FALLBACK[(lang || 'es').slice(0, 2).toLowerCase()] || OPENER_FALLBACK.es;

export interface DripStep {
    delay_seconds: number;
    message_type: 'template' | 'custom' | 'ai_generated';
    content?: string;
    template_name?: string;
    template_language?: string;
    stop_conditions?: string[];
}

export interface CreateSequenceDto {
    name: string;
    trigger_event: string;
    steps: DripStep[];
    trigger_conditions?: Record<string, any>;
}

export interface DripStepJobData {
    tenantId: string;
    enrollmentId: string;
    sequenceId: string;
    stepIndex: number;
}

@Injectable()
export class DripSequenceService {
    private readonly logger = new Logger(DripSequenceService.name);

    constructor(
        @InjectQueue(NURTURING_QUEUE)
        private readonly nurturingQueue: Queue,
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
        private readonly throttle: TenantThrottleService,
        private readonly outboundQueue: OutboundQueueService,
        private readonly channelToken: ChannelTokenService,
        private readonly personaService: PersonaService,
        private readonly llmRouter: LLMRouterService,
        private readonly compliance: ComplianceService,
        private readonly segmentsService: SegmentsService,
        private readonly whatsappMessaging: WhatsappMessagingService,
    ) {}

    // ─── Lazy Table Migration ────────────────────────────────────

    async ensureDripTables(schemaName: string): Promise<void> {
        const cacheKey = `drip_tables:${schemaName}`;
        const cached = await this.redis.get(cacheKey);
        if (cached) return;

        await this.prisma.executeInTenantSchema(
            schemaName,
            `CREATE TABLE IF NOT EXISTS drip_sequences (
                id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                tenant_id UUID NOT NULL,
                name VARCHAR(255) NOT NULL,
                trigger_event VARCHAR(100) NOT NULL,
                trigger_conditions JSONB DEFAULT '{}',
                steps JSONB NOT NULL DEFAULT '[]',
                is_active BOOLEAN DEFAULT false,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            )`,
            [],
        );

        await this.prisma.executeInTenantSchema(
            schemaName,
            `CREATE TABLE IF NOT EXISTS drip_enrollments (
                id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                sequence_id UUID NOT NULL REFERENCES drip_sequences(id) ON DELETE CASCADE,
                contact_id UUID NOT NULL,
                conversation_id UUID,
                current_step INTEGER DEFAULT 0,
                status VARCHAR(50) DEFAULT 'active',
                enrolled_at TIMESTAMPTZ DEFAULT NOW(),
                last_step_at TIMESTAMPTZ,
                completed_at TIMESTAMPTZ,
                stop_reason TEXT
            )`,
            [],
        );

        await this.prisma.executeInTenantSchema(
            schemaName,
            `CREATE UNIQUE INDEX IF NOT EXISTS uidx_drip_enrollments_active
             ON drip_enrollments (sequence_id, contact_id) WHERE status = 'active'`,
            [],
        );

        await this.redis.set(cacheKey, '1', 86400);
    }

    // ─── CRUD ────────────────────────────────────────────────────

    async listSequences(tenantId: string): Promise<any[]> {
        const schemaName = await this.tenantSchema(tenantId);
        await this.ensureDripTables(schemaName);

        return this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT ds.*,
                    (SELECT COUNT(*) FROM drip_enrollments de WHERE de.sequence_id = ds.id AND de.status = 'active')::int AS active_enrollments
             FROM drip_sequences ds
             WHERE ds.tenant_id = $1::uuid
             ORDER BY ds.created_at DESC`,
            [tenantId],
        );
    }

    async getSequence(tenantId: string, sequenceId: string): Promise<any> {
        const schemaName = await this.tenantSchema(tenantId);
        await this.ensureDripTables(schemaName);

        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT ds.*,
                    (SELECT COUNT(*) FROM drip_enrollments de WHERE de.sequence_id = ds.id AND de.status = 'active')::int AS active_enrollments
             FROM drip_sequences ds
             WHERE ds.id = $1::uuid AND ds.tenant_id = $2::uuid`,
            [sequenceId, tenantId],
        );

        if (!rows?.length) throw new NotFoundException('Sequence not found');
        return rows[0];
    }

    async createSequence(tenantId: string, data: CreateSequenceDto): Promise<any> {
        const schemaName = await this.tenantSchema(tenantId);
        await this.ensureDripTables(schemaName);

        if (!data.name || !data.trigger_event || !Array.isArray(data.steps) || data.steps.length === 0) {
            throw new BadRequestException('name, trigger_event, and at least one step are required');
        }

        return this.prisma.transactionInTenantSchema(schemaName, async (query) => {
            await query(`SELECT pg_advisory_xact_lock(hashtextextended('drip-sequences', 0))`);
            const existing = await query<any[]>(
                `SELECT COUNT(*)::int AS count FROM drip_sequences WHERE tenant_id = $1::uuid`,
                [tenantId],
            );
            await this.throttle.enforcePlanLimit(
                tenantId,
                'maxDripSequences',
                Number(existing?.[0]?.count || 0),
                'secuencias drip',
            );
            const rows = await query<any[]>(
                `INSERT INTO drip_sequences (tenant_id, name, trigger_event, trigger_conditions, steps)
                 VALUES ($1::uuid, $2, $3, $4::jsonb, $5::jsonb)
                 RETURNING *`,
                [tenantId, data.name, data.trigger_event, JSON.stringify(data.trigger_conditions || {}), JSON.stringify(data.steps)],
            );
            return rows?.[0];
        });
    }

    async updateSequence(tenantId: string, sequenceId: string, data: Partial<CreateSequenceDto>): Promise<any> {
        const schemaName = await this.tenantSchema(tenantId);
        await this.ensureDripTables(schemaName);

        const existing = await this.getSequence(tenantId, sequenceId);
        if (!existing) throw new NotFoundException('Sequence not found');

        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `UPDATE drip_sequences
             SET name = COALESCE($3, name),
                 trigger_event = COALESCE($4, trigger_event),
                 trigger_conditions = COALESCE($5::jsonb, trigger_conditions),
                 steps = COALESCE($6::jsonb, steps),
                 updated_at = NOW()
             WHERE id = $1::uuid AND tenant_id = $2::uuid
             RETURNING *`,
            [
                sequenceId,
                tenantId,
                data.name ?? null,
                data.trigger_event ?? null,
                data.trigger_conditions ? JSON.stringify(data.trigger_conditions) : null,
                data.steps ? JSON.stringify(data.steps) : null,
            ],
        );

        return rows?.[0];
    }

    async deleteSequence(tenantId: string, sequenceId: string): Promise<void> {
        const schemaName = await this.tenantSchema(tenantId);
        await this.ensureDripTables(schemaName);

        const result = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `DELETE FROM drip_sequences WHERE id = $1::uuid AND tenant_id = $2::uuid RETURNING id`,
            [sequenceId, tenantId],
        );

        if (!result?.length) throw new NotFoundException('Sequence not found');
    }

    async toggleSequence(tenantId: string, sequenceId: string, isActive: boolean): Promise<any> {
        const schemaName = await this.tenantSchema(tenantId);
        await this.ensureDripTables(schemaName);

        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `UPDATE drip_sequences SET is_active = $3, updated_at = NOW()
             WHERE id = $1::uuid AND tenant_id = $2::uuid
             RETURNING *`,
            [sequenceId, tenantId, isActive],
        );

        if (!rows?.length) throw new NotFoundException('Sequence not found');
        return rows[0];
    }

    // ─── Enrollment ──────────────────────────────────────────────

    async enrollContact(tenantId: string, sequenceId: string, contactId: string, conversationId?: string): Promise<any> {
        const schemaName = await this.tenantSchema(tenantId);
        await this.ensureDripTables(schemaName);

        const sequence = await this.getSequence(tenantId, sequenceId);
        if (!sequence.is_active) throw new BadRequestException('Cannot enroll in an inactive sequence');

        const steps = (typeof sequence.steps === 'string' ? JSON.parse(sequence.steps) : sequence.steps) as DripStep[];
        if (!steps.length) throw new BadRequestException('Sequence has no steps');

        // Opt-out gate — proactive outreach must respect opt-outs.
        const contact = await this.getContact(schemaName, contactId);
        const phone = contact?.external_id || contact?.phone;
        if (phone && await this.compliance.isBlocked(tenantId, phone)) {
            throw new BadRequestException('Contact has opted out — cannot enroll in a sequence');
        }

        const enrollment = await this.enrollOne(tenantId, schemaName, sequenceId, contactId, steps, conversationId || null);
        if (!enrollment) throw new BadRequestException('Contact is already enrolled in this sequence');

        this.logger.log(`Enrolled contact ${contactId} in sequence ${sequenceId}`);
        return enrollment;
    }

    /**
     * Bulk-enroll a CRM SEGMENT into a (prospecting) sequence — the agent opens, the
     * console closes. Resolves the segment's leads, skips opted-out and already-enrolled
     * contacts, and pre-creates a conversation so the opener threads and the reply lands
     * in the inbox. Hard-capped to avoid runaway outreach.
     */
    async enrollSegment(
        tenantId: string,
        sequenceId: string,
        segmentId: string,
        opts?: { cap?: number },
    ): Promise<{ matched: number; enrolled: number; skippedOptOut: number; skippedDuplicate: number; skippedNoContact: number; capped: boolean }> {
        if (!segmentId) throw new BadRequestException('segmentId is required');
        const schemaName = await this.tenantSchema(tenantId);
        await this.ensureDripTables(schemaName);

        const sequence = await this.getSequence(tenantId, sequenceId);
        if (!sequence.is_active) throw new BadRequestException('Cannot enroll into an inactive sequence');
        const steps = (typeof sequence.steps === 'string' ? JSON.parse(sequence.steps) : sequence.steps) as DripStep[];
        if (!steps.length) throw new BadRequestException('Sequence has no steps');
        // WhatsApp only allows APPROVED TEMPLATES to open a cold conversation (24h window).
        // A prospecting sequence's first step MUST be a template — a free-form opener
        // (custom/ai_generated) is rejected by Meta for contacts who never wrote first.
        if (steps[0]?.message_type !== 'template') {
            throw new BadRequestException('For WhatsApp prospecting the first step must be an approved template — cold contacts can only be reached via templates.');
        }

        // No point enrolling against missing credentials — every send would fail silently.
        const { accessToken, accountId } = await this.resolveChannelCredentials(tenantId, 'whatsapp');
        if (!accessToken || !accountId) {
            throw new BadRequestException('Connect WhatsApp before prospecting.');
        }

        const cap = Math.max(1, Math.min(opts?.cap ?? 300, 500));
        // getSegmentContacts returns `leads` rows (with contact_id, phone, opted_out).
        // Fetch cap+1 to detect truncation.
        const leads = await this.segmentsService.getSegmentContacts(tenantId, segmentId, 1, cap + 1);
        const capped = leads.length > cap;
        const targets = leads.slice(0, cap);
        const matched = capped ? cap : leads.length;

        const phoneRe = /^\+?\d{7,15}$/;
        let enrolled = 0, skippedOptOut = 0, skippedDuplicate = 0, skippedNoContact = 0;
        for (const lead of targets) {
            try {
                const contactId = lead.contact_id;
                const phone = String(lead.phone || '');
                if (!contactId || !phoneRe.test(phone)) { skippedNoContact++; continue; }
                // Skip opt-outs: both the confirmed opt_out_records (isBlocked) AND the
                // leads.opted_out flag set by the public-form unsubscribe (which isBlocked
                // doesn't see, and which also sidesteps E.164 +/no-+ mismatches).
                if (lead.opted_out === true || await this.compliance.isBlocked(tenantId, phone)) { skippedOptOut++; continue; }
                const convId = await this.resolveOrCreateConversation(schemaName, contactId, 'whatsapp', accountId);
                const enrollment = await this.enrollOne(tenantId, schemaName, sequenceId, contactId, steps, convId);
                if (enrollment) enrolled++; else skippedDuplicate++;
            } catch (e: any) {
                // A single bad lead must never abort the whole batch.
                this.logger.warn(`[Prospecting] enroll failed for lead ${lead?.id}: ${e.message}`);
                skippedNoContact++;
            }
        }

        this.logger.log(`[Prospecting] Segment ${segmentId} → seq ${sequenceId}: ${enrolled} enrolled / ${skippedOptOut} opt-out / ${skippedDuplicate} dup / ${skippedNoContact} skipped${capped ? ' (capped)' : ''}`);
        return { matched, enrolled, skippedOptOut, skippedDuplicate, skippedNoContact, capped };
    }

    /** Insert one enrollment (dedup via the active unique index) and schedule its first
     *  step. Returns the enrollment row, or null if the contact was already enrolled. */
    private async enrollOne(
        tenantId: string,
        schemaName: string,
        sequenceId: string,
        contactId: string,
        steps: DripStep[],
        conversationId: string | null,
    ): Promise<any | null> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `INSERT INTO drip_enrollments (sequence_id, contact_id, conversation_id, current_step, status)
             VALUES ($1::uuid, $2::uuid, $3::uuid, 0, 'active')
             ON CONFLICT ON CONSTRAINT uidx_drip_enrollments_active DO NOTHING
             RETURNING *`,
            [sequenceId, contactId, conversationId],
        );
        if (!rows?.length) return null;

        const enrollment = rows[0];
        const firstStep = steps[0];
        const delayMs = (firstStep.delay_seconds || 0) * 1000;

        await this.nurturingQueue.add('drip-step', {
            tenantId,
            enrollmentId: enrollment.id,
            sequenceId,
            stepIndex: 0,
        } as DripStepJobData, {
            jobId: `drip_${tenantId}_${enrollment.id}_0`,
            delay: delayMs,
            attempts: 2,
            backoff: { type: 'fixed', delay: 30_000 },
            removeOnComplete: { age: 3600 },
            removeOnFail: { age: 86400 },
        });

        return enrollment;
    }

    /** Reuse the contact's active conversation, or create one so the prospecting opener
     *  threads and the customer's reply lands in the same inbox conversation. */
    private async resolveOrCreateConversation(
        schemaName: string,
        contactId: string,
        channelType: string,
        accountId: string,
    ): Promise<string | null> {
        try {
            const existing = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT id FROM conversations
                 WHERE contact_id = $1::uuid AND channel_type = $2
                   AND status IN ('active', 'waiting_human', 'with_human')
                 ORDER BY created_at DESC LIMIT 1`,
                [contactId, channelType],
            );
            if (existing?.length) return existing[0].id;

            const created = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `INSERT INTO conversations (contact_id, channel_type, channel_account_id, status, stage)
                 VALUES ($1::uuid, $2, $3, 'active', 'greeting') RETURNING id`,
                [contactId, channelType, accountId || ''],
            );
            return created?.[0]?.id || null;
        } catch (e: any) {
            this.logger.warn(`resolveOrCreateConversation failed for ${contactId}: ${e.message}`);
            return null; // enroll still proceeds with a null conversation
        }
    }

    async unenrollContact(tenantId: string, sequenceId: string, contactId: string): Promise<void> {
        const schemaName = await this.tenantSchema(tenantId);
        await this.ensureDripTables(schemaName);

        await this.prisma.executeInTenantSchema(
            schemaName,
            `UPDATE drip_enrollments
             SET status = 'unenrolled', stop_reason = 'manual', completed_at = NOW()
             WHERE sequence_id = $1::uuid AND contact_id = $2::uuid AND status = 'active'`,
            [sequenceId, contactId],
        );
    }

    async getEnrollments(tenantId: string, sequenceId: string, status?: string): Promise<any[]> {
        const schemaName = await this.tenantSchema(tenantId);
        await this.ensureDripTables(schemaName);

        let sql = `SELECT de.*, c.name AS contact_name, c.external_id AS contact_external_id
                    FROM drip_enrollments de
                    LEFT JOIN contacts c ON c.id = de.contact_id
                    WHERE de.sequence_id = $1::uuid`;
        const params: any[] = [sequenceId];

        if (status) {
            sql += ` AND de.status = $2`;
            params.push(status);
        }

        sql += ` ORDER BY de.enrolled_at DESC LIMIT 200`;

        return this.prisma.executeInTenantSchema<any[]>(schemaName, sql, params);
    }

    async stopOnReply(tenantId: string, conversationId: string): Promise<void> {
        const schemaName = await this.tenantSchema(tenantId);

        const tableCheck = await this.redis.get(`drip_tables:${schemaName}`);
        if (!tableCheck) return;

        const contactRows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT contact_id FROM conversations WHERE id = $1::uuid`,
            [conversationId],
        );
        const contactId = contactRows?.[0]?.contact_id;
        if (!contactId) return;

        const updated = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `UPDATE drip_enrollments
             SET status = 'stopped_replied', stop_reason = 'customer_replied', completed_at = NOW()
             WHERE contact_id = $1::uuid AND status = 'active'
             RETURNING id`,
            [contactId],
        );

        if (updated?.length) {
            this.logger.log(`Stopped ${updated.length} drip enrollment(s) for contact ${contactId} (replied in conv ${conversationId})`);
        }
    }

    // ─── Execution ───────────────────────────────────────────────

    async executeStep(tenantId: string, enrollmentId: string): Promise<void> {
        const schemaName = await this.tenantSchema(tenantId);
        await this.ensureDripTables(schemaName);

        const enrollmentRows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT * FROM drip_enrollments WHERE id = $1::uuid`,
            [enrollmentId],
        );
        const enrollment = enrollmentRows?.[0];
        if (!enrollment) {
            this.logger.warn(`Drip enrollment ${enrollmentId} not found`);
            return;
        }

        if (enrollment.status !== 'active') {
            this.logger.debug(`Drip enrollment ${enrollmentId} is ${enrollment.status} — skipping`);
            return;
        }

        const sequenceRows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT * FROM drip_sequences WHERE id = $1::uuid`,
            [enrollment.sequence_id],
        );
        const sequence = sequenceRows?.[0];
        if (!sequence) {
            this.logger.warn(`Drip sequence ${enrollment.sequence_id} not found`);
            return;
        }

        const steps = (typeof sequence.steps === 'string' ? JSON.parse(sequence.steps) : sequence.steps) as DripStep[];
        const stepIndex = enrollment.current_step;

        if (stepIndex >= steps.length) {
            await this.prisma.executeInTenantSchema(
                schemaName,
                `UPDATE drip_enrollments SET status = 'completed', completed_at = NOW() WHERE id = $1::uuid`,
                [enrollmentId],
            );
            return;
        }

        const step = steps[stepIndex];

        if (step.stop_conditions?.includes('replied')) {
            const convId = enrollment.conversation_id;
            if (convId) {
                const recentInbound = await this.prisma.executeInTenantSchema<any[]>(
                    schemaName,
                    `SELECT EXISTS(
                        SELECT 1 FROM messages
                        WHERE conversation_id = $1::uuid
                          AND direction = 'inbound'
                          AND created_at > $2::timestamptz
                    ) AS has_reply`,
                    [convId, enrollment.enrolled_at],
                );
                if (recentInbound?.[0]?.has_reply) {
                    await this.prisma.executeInTenantSchema(
                        schemaName,
                        `UPDATE drip_enrollments SET status = 'stopped_replied', stop_reason = 'customer_replied', completed_at = NOW() WHERE id = $1::uuid`,
                        [enrollmentId],
                    );
                    this.logger.log(`Drip enrollment ${enrollmentId} stopped — customer replied`);
                    return;
                }
            }
        }

        // Opt-out gate — proactive outreach must never reach a contact who opted out.
        // Checked every step (an opt-out can land mid-sequence) and stops the enrollment.
        const optoutContact = await this.getContact(schemaName, enrollment.contact_id);
        const optoutKey = optoutContact?.external_id || optoutContact?.phone;
        if (optoutKey && await this.compliance.isBlocked(tenantId, optoutKey)) {
            await this.prisma.executeInTenantSchema(
                schemaName,
                `UPDATE drip_enrollments SET status = 'stopped_optout', stop_reason = 'opted_out', completed_at = NOW() WHERE id = $1::uuid`,
                [enrollmentId],
            );
            this.logger.log(`Drip enrollment ${enrollmentId} stopped — contact opted out`);
            return;
        }

        try {
            await this.executeStepAction(tenantId, schemaName, enrollment, step);
        } catch (e: any) {
            this.logger.error(`Drip step execution failed for enrollment ${enrollmentId}: ${e.message}`);
        }

        const nextStep = stepIndex + 1;
        if (nextStep >= steps.length) {
            await this.prisma.executeInTenantSchema(
                schemaName,
                `UPDATE drip_enrollments SET current_step = $2, last_step_at = NOW(), status = 'completed', completed_at = NOW() WHERE id = $1::uuid`,
                [enrollmentId, nextStep],
            );
            this.logger.log(`Drip enrollment ${enrollmentId} completed (all steps done)`);
        } else {
            await this.prisma.executeInTenantSchema(
                schemaName,
                `UPDATE drip_enrollments SET current_step = $2, last_step_at = NOW() WHERE id = $1::uuid`,
                [enrollmentId, nextStep],
            );

            const nextStepDef = steps[nextStep];
            const delayMs = (nextStepDef.delay_seconds || 0) * 1000;

            await this.nurturingQueue.add('drip-step', {
                tenantId,
                enrollmentId,
                sequenceId: enrollment.sequence_id,
                stepIndex: nextStep,
            } as DripStepJobData, {
                jobId: `drip_${tenantId}_${enrollmentId}_${nextStep}`,
                delay: delayMs,
                attempts: 2,
                backoff: { type: 'fixed', delay: 30_000 },
                removeOnComplete: { age: 3600 },
                removeOnFail: { age: 86400 },
            });

            this.logger.log(`Drip enrollment ${enrollmentId} advanced to step ${nextStep}, scheduled in ${delayMs / 1000}s`);
        }
    }

    // ─── Private Helpers ─────────────────────────────────────────

    private async executeStepAction(
        tenantId: string,
        schemaName: string,
        enrollment: any,
        step: DripStep,
    ): Promise<void> {
        const contact = await this.getContact(schemaName, enrollment.contact_id);
        if (!contact) {
            this.logger.warn(`Contact ${enrollment.contact_id} not found — skipping drip step`);
            return;
        }

        // The drip sends via WhatsApp, so the recipient MUST be an E.164 phone. For a
        // WhatsApp contact external_id IS the phone; for other channels it's a PSID, so
        // prefer the phone column and require a phone-shaped value — never send to a
        // cross-channel id (it would fail or hit the wrong person).
        const phoneRe = /^\+?\d{7,15}$/;
        const phone = phoneRe.test(String(contact.phone || ''))
            ? String(contact.phone)
            : (phoneRe.test(String(contact.external_id || '')) ? String(contact.external_id) : '');
        if (!phone) {
            this.logger.warn(`No WhatsApp phone for contact ${enrollment.contact_id} — skipping drip step`);
            return;
        }

        const channelType = 'whatsapp';
        const { accessToken, accountId } = await this.resolveChannelCredentials(tenantId, channelType);

        if (step.message_type === 'template') {
            // Approved Meta template — the ONLY compliant way to open a cold conversation
            // outside the 24h window. Sends the real template via WhatsappMessagingService
            // (the broadcast/automation path); the old literal "[Template: x]" never delivered.
            const templateName = step.template_name || 'follow_up';
            const language = step.template_language || 'es';
            const components = [
                { type: 'body', parameters: [{ type: 'text', text: contact.name || 'cliente' }] },
            ];
            try {
                await this.whatsappMessaging.sendTemplate(schemaName, phone, templateName, language, components);
                await this.saveOutboundMessage(schemaName, enrollment.conversation_id, `[Plantilla: ${templateName}]`);
            } catch (e: any) {
                this.logger.error(`Drip template send failed (${templateName}) for ${phone}: ${e.message}`);
            }
        } else if (step.message_type === 'custom') {
            const text = step.content || '';
            if (!text) {
                this.logger.warn(`Empty custom message in drip step — skipping`);
                return;
            }

            const personalizedText = text
                .replace(/\{name\}/g, contact.name || 'cliente')
                .replace(/\{phone\}/g, phone);

            const outbound: OutboundMessage = {
                tenantId,
                channelType,
                channelAccountId: accountId,
                to: phone,
                content: { type: 'text', text: personalizedText },
            };

            await this.outboundQueue.enqueue(outbound, accessToken);
            await this.saveOutboundMessage(schemaName, enrollment.conversation_id, personalizedText);
        } else if (step.message_type === 'ai_generated') {
            // The agent "opens" the prospecting conversation with a personalized message
            // in the tenant's persona voice. step.content (optional) is the angle/reason.
            const text = await this.generateOpener(tenantId, contact, step.content);
            if (!text) {
                this.logger.warn(`AI opener returned empty — skipping drip step`);
                return;
            }
            const outbound: OutboundMessage = {
                tenantId,
                channelType,
                channelAccountId: accountId,
                to: phone,
                content: { type: 'text', text },
            };
            await this.outboundQueue.enqueue(outbound, accessToken);
            await this.saveOutboundMessage(schemaName, enrollment.conversation_id, text);
        }
    }

    /** AI-written prospecting opener in the agent's persona voice, with a safe fallback. */
    private async generateOpener(tenantId: string, contact: any, angle?: string): Promise<string> {
        const name = contact?.name ? ` ${String(contact.name).split(' ')[0]}` : '';
        // Cold prospect: no detected language yet, so the tenant's configured
        // language drives both the fallback copy and the LLM output language.
        let lang = 'es';
        try {
            const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { language: true } });
            if (tenant?.language) lang = String(tenant.language).slice(0, 2).toLowerCase();
        } catch { /* keep es */ }
        const langName = LANG_NAME[lang as keyof typeof LANG_NAME] || LANG_NAME.es;
        const fallback = openerFallback(lang)(name);
        try {
            const persona = await this.personaService.getActivePersona(tenantId);
            if (!persona) return fallback;
            const angleLine = angle && angle.trim()
                ? ` El motivo/ángulo del primer contacto es: "${angle.trim()}".`
                : '';
            const response = await this.llmRouter.execute({
                task: 'conversation',
                messages: [{
                    role: 'user',
                    content: `Escribí un mensaje de PRIMER CONTACTO (prospección) breve, cálido y natural para ` +
                        `${name ? `un cliente llamado${name}` : 'un posible cliente'}.${angleLine} ` +
                        `Presentate de parte del negocio, generá interés en 1-2 líneas y terminá con una pregunta abierta y sin presión. ` +
                        `No inventes datos, precios ni promociones que no te dieron. Escribí el mensaje en ${langName}. Devolvé SOLO el mensaje.`,
                }],
                systemPrompt: this.personaService.buildSystemPrompt(persona),
                temperature: 0.8,
                tenantId,
            });
            return response.content?.trim() || fallback;
        } catch {
            return fallback;
        }
    }

    private async getContact(schemaName: string, contactId: string): Promise<any> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT * FROM contacts WHERE id = $1::uuid`,
            [contactId],
        );
        return rows?.[0] || null;
    }

    private async saveOutboundMessage(schemaName: string, conversationId: string | null, text: string): Promise<void> {
        if (!conversationId) return;
        await this.prisma.executeInTenantSchema(
            schemaName,
            `INSERT INTO messages (conversation_id, direction, content_type, content_text, status, metadata)
             VALUES ($1::uuid, 'outbound', 'text', $2, 'delivered', '{"source":"drip_sequence"}'::jsonb)`,
            [conversationId, text],
        );
    }

    private async resolveChannelCredentials(tenantId: string, channelType = 'whatsapp'): Promise<{ accessToken: string; accountId: string }> {
        try {
            const creds = await this.channelToken.getChannelToken(tenantId, channelType);
            return { accessToken: creds.accessToken, accountId: creds.accountId };
        } catch (e: any) {
            this.logger.warn(`Could not resolve ${channelType} token for tenant ${tenantId}: ${e.message}`);
            return { accessToken: '', accountId: '' };
        }
    }

    private async tenantSchema(tenantId: string): Promise<string> {
        return this.prisma.getTenantSchemaName(tenantId);
    }
}
