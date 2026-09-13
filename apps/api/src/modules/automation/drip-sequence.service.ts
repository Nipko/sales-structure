import { Injectable, Logger, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
import { ChannelTokenService } from '../channels/channel-token.service';
import { PersonaService } from '../persona/persona.service';
import { LLMRouterService } from '../ai/router/llm-router.service';
import { ComplianceService } from '../analytics/compliance.service';
import { SegmentsService } from '../crm/services/segments/segments.service';
import { NURTURING_QUEUE } from './nurturing.service';
import { LANG_NAME } from './nurturing-i18n';
import { whatsappSenderFrom } from '../channels/whatsapp-sender-origin';
import {
    ProactiveDispatchService, producerMayAdvance, type ProactiveSendResult,
} from '../channels/proactive-dispatch.service';

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
        private readonly channelToken: ChannelTokenService,
        private readonly personaService: PersonaService,
        private readonly llmRouter: LLMRouterService,
        private readonly compliance: ComplianceService,
        private readonly segmentsService: SegmentsService,
        /**
         * The durable lane, which a drip step could not use before.
         *
         * The template branch went straight to the adapter and the two text
         * branches went onto the legacy queue, where Redis is the only record
         * and nothing carries an identity: a restart lost the step, and a retry
         * sent it twice. Both also wrote a history row saying `delivered`
         * before anything had left.
         */
        private readonly proactive: ProactiveDispatchService,
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
            await query(`SELECT pg_advisory_xact_lock(hashtextextended('drip-sequences', 0))::text AS lock_acquired`);
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
            // ═══ THE CLOSING PASS, WHICH IS NOW A PASS OF ITS OWN ═══
            //
            // Completing the enrolment used to happen in the same breath as
            // sending the last step. On the durable lane that is fatal: the
            // enrolment's revision includes its `status`, the policy reads
            // anything other than `active` as "the journey is over and its next
            // step is not owed", and the last step — already committed and
            // waiting for a lease — would be suppressed at admission. The
            // customer would never receive the final message of any sequence.
            //
            // So the last step schedules this pass instead, and it waits for
            // that effect to be admitted before closing the journey. Once a
            // lease is granted the revision has already been checked and the
            // POST no longer depends on it.
            if (await this.lastEffectAwaitingAdmission(schemaName, enrollmentId, steps.length - 1)) {
                throw new Error(`drip_last_step_awaiting_admission:${enrollmentId}`);
            }
            await this.prisma.executeInTenantSchema(
                schemaName,
                `UPDATE drip_enrollments SET status = 'completed', completed_at = NOW() WHERE id = $1::uuid`,
                [enrollmentId],
            );
            this.logger.log(`Drip enrollment ${enrollmentId} completed (all steps done)`);
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

        // ═══ THE ENROLMENT MOVES FIRST, AND IS PUT BACK IF NOTHING WAS OWED ═══
        //
        // Not an inversion of "the flag follows the effect" but the only way to
        // honour it here. `current_step` is part of the enrolment's revision —
        // deliberately, so that somebody moved to another step does not receive
        // the one they left — and the effect sits on the lane for as long as it
        // takes to get a lease. Advancing AFTER preparing would make every step
        // stale at admission and nothing would ever be delivered.
        //
        // So the enrolment is advanced, the authority is read from the advanced
        // state, and the advance is UNDONE when no durable effect exists. The
        // end state is the one the invariant asks for: the enrolment never
        // stands advanced over a step the customer was not owed.
        // ── AND THE ADVANCE IS A CLAIM, NOT A WRITE ─────────────────────────
        //
        // An unconditional `SET current_step = next` does not stop a second
        // worker: it stops a second worker from sending the SAME step, and
        // nothing more. Two crons on one enrolment read steps 0 and 1 — the
        // second reading the first's own advance — and each prepares a
        // different message. Two rows, two charges, and the customer receives
        // two steps of the journey at once.
        //
        // Compare-and-set on the step this worker actually read makes the
        // advance the CLAIM: exactly one worker moves 0 → 1, and the loser
        // affects no rows and returns without preparing anything. The race test
        // for this passed on a quiet machine and failed in a full suite run,
        // which is the only reason it was found.
        const nextStep = stepIndex + 1;
        if (!(await this.claimEnrolmentStep(schemaName, enrollmentId, stepIndex, nextStep))) {
            this.logger.log(`Drip enrollment ${enrollmentId} step ${stepIndex} was claimed by `
                + 'another worker; this one sends nothing');
            return;
        }
        let outcome: ProactiveSendResult;
        try {
            outcome = await this.executeStepAction(tenantId, schemaName, enrollment, step, stepIndex);
        } catch (e: any) {
            this.logger.error(`Drip step execution failed for enrollment ${enrollmentId}: ${e.message}`);
            outcome = { kind: 'deferred', reason: String(e?.message ?? e).slice(0, 200) };
        }
        if (!producerMayAdvance(outcome)) {
            // Nothing was committed, and the reason may pass. The enrolment goes
            // back to the step it was on so the next attempt sends it, instead
            // of the journey silently skipping a message nobody received.
            //
            // Conditional on the claim still being ours, for the same reason it
            // was taken that way: an unconditional rewind would drag an
            // enrolment a later worker has legitimately advanced back to a step
            // the customer already received.
            await this.claimEnrolmentStep(schemaName, enrollmentId, nextStep, stepIndex);
            throw new Error(`drip_step_not_dispatched:${outcome.kind}`
                + `:${'reason' in outcome ? outcome.reason : ''}`);
        }

        const terminal = nextStep >= steps.length;
        const delayMs = terminal
            // The closing pass. It waits for the last effect to be admitted, and
            // BullMQ's own backoff is what gives it something to wait with.
            ? 30_000
            : (steps[nextStep].delay_seconds || 0) * 1000;
        await this.nurturingQueue.add('drip-step', {
            tenantId,
            enrollmentId,
            sequenceId: enrollment.sequence_id,
            stepIndex: nextStep,
        } as DripStepJobData, {
            jobId: `drip_${tenantId}_${enrollmentId}_${nextStep}`,
            delay: delayMs,
            attempts: terminal ? 5 : 2,
            backoff: { type: 'fixed', delay: 30_000 },
            removeOnComplete: { age: 3600 },
            removeOnFail: { age: 86400 },
        });

        this.logger.log(`Drip enrollment ${enrollmentId} ${outcome.kind} step ${stepIndex}; `
            + `${terminal ? 'closing pass' : `step ${nextStep}`} scheduled in ${delayMs / 1000}s`);
    }

    /**
     * Move the enrolment from one step to another, and say whether it worked.
     *
     * Conditional on `from`, so it is a claim rather than a write: two workers
     * on one enrolment cannot both move it, and the loser is told so instead of
     * quietly proceeding with a step somebody else is already sending. Used
     * forwards to claim and backwards to release.
     */
    private async claimEnrolmentStep(schemaName: string, enrollmentId: string,
        from: number, to: number): Promise<boolean> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `UPDATE drip_enrollments SET current_step = $3, last_step_at = NOW()
              WHERE id = $1::uuid AND current_step = $2
              RETURNING id`,
            [enrollmentId, from, to],
        );
        return (rows?.length ?? 0) > 0;
    }

    /**
     * Is the last step's effect still waiting for a lease?
     *
     * `prepared` and `queued` are the two states in which the admission has not
     * happened yet, and the admission is where the enrolment's revision is
     * checked. Completing the enrolment before then turns the final message into
     * a suppression; after then the lease is granted and the POST no longer
     * depends on the enrolment's status.
     *
     * A tenant whose schema has never dispatched has no table, and that is an
     * answer rather than an error: nothing is in flight.
     */
    private async lastEffectAwaitingAdmission(
        schemaName: string, enrollmentId: string, lastStepIndex: number,
    ): Promise<boolean> {
        if (lastStepIndex < 0) return false;
        const originId = ProactiveDispatchService.originId(
            `drip_step:${enrollmentId}:${lastStepIndex}`);
        try {
            // Asked separately: a missing table is a PARSE failure, so it
            // cannot be guarded inside the query that reads it.
            const [present] = await this.prisma.executeInTenantSchema<any[]>(
                schemaName, 'SELECT to_regclass($1)::text AS relation',
                [`${schemaName}.agent_dispatch_outbox`]);
            if (!present?.relation) return false;
            const rows = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT state FROM agent_dispatch_outbox
                  WHERE inbound_message_id = $1::uuid AND state IN ('prepared','queued')
                  LIMIT 1`,
                [originId],
            );
            return !!rows?.length;
        } catch (e: any) {
            // Never read an outage as "nothing is in flight": that is exactly
            // the reading that would complete the enrolment and suppress the
            // final message. The closing pass retries.
            this.logger.warn(`Could not read the last drip effect of ${enrollmentId}: ${e.message}`);
            return true;
        }
    }

    // ─── Private Helpers ─────────────────────────────────────────

    private async executeStepAction(
        tenantId: string,
        schemaName: string,
        enrollment: any,
        step: DripStep,
        stepIndex: number,
    ): Promise<ProactiveSendResult> {
        const contact = await this.getContact(schemaName, enrollment.contact_id);
        if (!contact) {
            // Gone, and not coming back. Suppressed rather than deferred: the
            // journey moves on instead of retrying a contact that was deleted.
            this.logger.warn(`Contact ${enrollment.contact_id} not found — skipping drip step`);
            return { kind: 'suppressed', reason: 'contact_gone' };
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
            return { kind: 'suppressed', reason: 'no_whatsapp_phone' };
        }

        const channelType = 'whatsapp';
        // The connection this enrolment belongs to, taken from its conversation.
        //
        // Every send below is billable from 1 October 2026 and every one of them
        // was going out unnamed: `resolveChannelCredentials` asked for the
        // tenant's token without saying which number, so the resolver returned
        // the oldest connection and that account paid — a property of row order,
        // not of a decision. Naming it here fixes all three branches at once,
        // because they all read from this.
        const connection = await this.connectionOfEnrolment(schemaName, enrollment.conversation_id);
        if (!connection) {
            // Refused, not guessed. A durable row names the account it will be
            // billed to before the processor picks it up, and there is nobody
            // to pick a number on the business's behalf. The enrolment stays on
            // this step until somebody names one.
            this.logger.warn(`Drip enrolment ${enrollment.id} has no WhatsApp connection `
                + '— nothing dispatched');
            return { kind: 'refused', reason: 'no_connection' };
        }
        const conversationId = String(enrollment.conversation_id ?? '');
        if (!conversationId) {
            // The connection came FROM a conversation, so this cannot normally
            // happen; if it ever does, there is no thread to write the history
            // row into and therefore no receipt and no way back.
            return { kind: 'refused', reason: 'no_conversation' };
        }

        const item = await this.stepItem(tenantId, contact, phone, step);
        if (!item) return { kind: 'suppressed', reason: 'step_has_nothing_to_say' };

        // ── THE AUTHORITY, READ FROM THE ENROLMENT ──────────────────────────
        //
        // Built by reading `drip_enrollments`, so the revision describes the
        // journey as it IS — active, on this step, for this contact. The store
        // revalidates it inside the transaction that grants the lease, which is
        // what stops somebody who replied, unenrolled or was moved on from
        // receiving a step they left behind.
        const operationalScope = await this.proactive.policyAuthority(schemaName, {
            tenantId, producer: 'drip_step', channelType,
            channelAccountId: connection, entityId: String(enrollment.id),
        });
        if (!operationalScope) {
            this.logger.log(`Drip enrolment ${enrollment.id} no longer justifies a step — suppressed`);
            return { kind: 'suppressed', reason: 'enrolment_no_longer_active' };
        }

        return this.proactive.send(tenantId, {
            // The step index, not the current step: a retry of step 3 has to
            // find step 3's own row, and the enrolment has already moved on.
            originKey: `drip_step:${enrollment.id}:${stepIndex}`,
            conversationId,
            contactId: String(enrollment.contact_id),
            channelType,
            channelAccountId: connection,
            recipient: phone,
            items: [item],
            operationalScope,
        });
    }

    /**
     * What this step actually sends, or nothing.
     *
     * The three branches used to differ in far more than their content: the
     * template went straight to the adapter and the two texts went onto the
     * legacy queue, so "which lane, which record, which identity" depended on
     * what the tenant had typed into the step. They differ only in the item now.
     */
    private async stepItem(tenantId: string, contact: any, phone: string, step: DripStep):
        Promise<{ kind: 'template' | 'text'; payload: Record<string, any> } | null> {
        if (step.message_type === 'template') {
            // An approved Meta template is the ONLY compliant way to open a cold
            // conversation outside the 24h window. The literal `[Template: x]`
            // this once put on the queue was never a template at all.
            return {
                kind: 'template',
                payload: {
                    templateName: step.template_name || 'follow_up',
                    language: step.template_language || 'es',
                    components: [
                        { type: 'body', parameters: [{ type: 'text', text: contact.name || 'cliente' }] },
                    ],
                },
            };
        }
        if (step.message_type === 'custom') {
            const text = String(step.content || '')
                .replace(/\{name\}/g, contact.name || 'cliente')
                .replace(/\{phone\}/g, phone);
            if (!text.trim()) {
                this.logger.warn('Empty custom message in drip step — skipping');
                return null;
            }
            return { kind: 'text', payload: { text } };
        }
        if (step.message_type === 'ai_generated') {
            // The agent "opens" the prospecting conversation in the tenant's
            // persona voice. `step.content` (optional) is the angle.
            const text = await this.generateOpener(tenantId, contact, step.content);
            if (!text?.trim()) {
                this.logger.warn('AI opener returned empty — skipping drip step');
                return null;
            }
            return { kind: 'text', payload: { text } };
        }
        return null;
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

    // `saveOutboundMessage` used to live here. It wrote the history row itself,
    // as `delivered`, before anything had left the process — so a step that the
    // queue dropped, or that Meta refused, appeared in the customer's thread as
    // a message they had received and ignored. The durable lane writes that row
    // in the same transaction as the effect, and it says `pending` until a
    // provider accepts it.

    /**
     * The connection an enrolment belongs to: the number the customer wrote to.
     *
     * `conversations.channel_account_id` is NOT NULL, so a drip enrolled from a
     * conversation always has one. An enrolment created without a conversation
     * does not, and that is left as `undefined` rather than filled in — the
     * resolver then serves it on a single-number tenant and refuses on a
     * multi-number one, which is the only honest answer when nobody said who pays.
     */
    private async connectionOfEnrolment(schemaName: string, conversationId?: string | null): Promise<string | undefined> {
        if (!conversationId) return undefined;
        try {
            const rows = await this.prisma.executeInTenantSchema<any[]>(schemaName,
                `SELECT channel_account_id, channel_type FROM conversations
                  WHERE id = $1::uuid LIMIT 1`,
                [conversationId]);
            // The channel comes back with the account because apart they are
            // two indistinguishable strings. A drip enrolled from an Instagram
            // conversation lends nothing to a WhatsApp send.
            return whatsappSenderFrom({
                channelType: rows?.[0]?.channel_type,
                channelAccountId: rows?.[0]?.channel_account_id,
            });
        } catch (e: any) {
            // A lookup that failed is not a connection that is absent. Returning
            // undefined here lets the resolver refuse on a multi-number tenant
            // instead of this method choosing one by accident.
            this.logger.warn(`Could not read the connection of conversation ${conversationId}: ${e.message}`);
            return undefined;
        }
    }

    private async resolveChannelCredentials(tenantId: string, channelType = 'whatsapp', accountId?: string):
        Promise<{ accessToken: string; accountId: string }> {
        try {
            const creds = await this.channelToken.getChannelToken(tenantId, channelType, accountId);
            return { accessToken: creds.accessToken, accountId: creds.accountId };
        } catch (e: any) {
            // Kept as a warning rather than a throw: the caller's other branches
            // still have work to do. What changed is that the refusal is now
            // reachable — asking unnamed on a multi-number tenant used to answer
            // with the oldest connection instead of refusing.
            this.logger.warn(`Could not resolve ${channelType} token for tenant ${tenantId}: ${e.message}`);
            return { accessToken: '', accountId: '' };
        }
    }

    private async tenantSchema(tenantId: string): Promise<string> {
        return this.prisma.getTenantSchemaName(tenantId);
    }
}
