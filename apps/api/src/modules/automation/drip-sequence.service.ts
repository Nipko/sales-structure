import { Injectable, Logger, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
import { OutboundQueueService } from '../channels/outbound-queue.service';
import { ChannelTokenService } from '../channels/channel-token.service';
import { NURTURING_QUEUE } from './nurturing.service';
import { OutboundMessage } from '@parallext/shared';

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

        const existing = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT COUNT(*)::int AS count FROM drip_sequences WHERE tenant_id = $1::uuid`,
            [tenantId],
        );
        const count = existing?.[0]?.count ?? 0;
        await this.throttle.enforcePlanLimit(tenantId, 'maxDripSequences', count, 'secuencias drip');

        if (!data.name || !data.trigger_event || !Array.isArray(data.steps) || data.steps.length === 0) {
            throw new BadRequestException('name, trigger_event, and at least one step are required');
        }

        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `INSERT INTO drip_sequences (tenant_id, name, trigger_event, trigger_conditions, steps)
             VALUES ($1::uuid, $2, $3, $4::jsonb, $5::jsonb)
             RETURNING *`,
            [tenantId, data.name, data.trigger_event, JSON.stringify(data.trigger_conditions || {}), JSON.stringify(data.steps)],
        );

        return rows?.[0];
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

        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `INSERT INTO drip_enrollments (sequence_id, contact_id, conversation_id, current_step, status)
             VALUES ($1::uuid, $2::uuid, $3::uuid, 0, 'active')
             ON CONFLICT ON CONSTRAINT uidx_drip_enrollments_active DO NOTHING
             RETURNING *`,
            [sequenceId, contactId, conversationId || null],
        );

        if (!rows?.length) {
            throw new BadRequestException('Contact is already enrolled in this sequence');
        }

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

        this.logger.log(`Enrolled contact ${contactId} in sequence ${sequenceId}, first step in ${delayMs / 1000}s`);
        return enrollment;
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

        const phone = contact.external_id || contact.phone;
        if (!phone) {
            this.logger.warn(`No phone for contact ${enrollment.contact_id} — skipping drip step`);
            return;
        }

        const channelType = 'whatsapp';
        const { accessToken, accountId } = await this.resolveChannelCredentials(tenantId, channelType);

        if (step.message_type === 'template') {
            const templateName = step.template_name || 'follow_up';
            const outbound: OutboundMessage = {
                tenantId,
                channelType,
                channelAccountId: accountId,
                to: phone,
                content: {
                    type: 'text',
                    text: `[Template: ${templateName}]`,
                },
                metadata: {
                    isTemplate: true,
                    templateName,
                    templateLanguage: step.template_language || 'es',
                    templateComponents: [
                        {
                            type: 'body',
                            parameters: [
                                { type: 'text', text: contact.name || 'cliente' },
                            ],
                        },
                    ],
                },
            };

            await this.outboundQueue.enqueue(outbound, accessToken);
            await this.saveOutboundMessage(schemaName, enrollment.conversation_id,
                `[Drip — Plantilla: ${templateName}] Enviado a ${contact.name || 'cliente'}`);
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
            this.logger.debug(`ai_generated drip step — not yet implemented`);
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
