import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { CONVERSATIONAL_CHANNELS } from '@parallext/shared';
import { PrismaService } from '../prisma/prisma.service';
import { QUALITY_QUEUE, type QualityJob } from '../quality/quality.service';
import { WATCHTOWER_SCHEMA, watchtowerWindow } from './watchtower-schema';

const FRACTION = 0.05;
const SAMPLE_CAP = 50;
const MAX_DISPATCH_ATTEMPTS = 5;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Samples inactive conversations regardless of resolution; SQL owns selection, BullMQ owns scoring delivery. */
@Injectable()
export class WatchtowerService {
    private readonly logger = new Logger(WatchtowerService.name);
    private readonly initialized = new Map<string, Promise<void>>();
    private sweepRunning = false;
    constructor(private readonly prisma: PrismaService,
        @InjectQueue(QUALITY_QUEUE) private readonly queue: Queue<QualityJob>) {}

    private async schema(tenantId: string): Promise<string> {
        if (!UUID.test(tenantId)) throw new BadRequestException({ error: 'invalid_tenant' });
        const schema = await this.prisma.getTenantSchemaName(tenantId);
        if (!this.initialized.has(schema)) {
            const pending = this.prisma.transactionInTenantSchema(schema, async query => {
                await query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text', [`quality-sampling-schema:${schema}`]);
                for (const statement of WATCHTOWER_SCHEMA) await query(statement);
            });
            this.initialized.set(schema, pending);
            pending.catch(() => this.initialized.delete(schema));
        }
        await this.initialized.get(schema);
        return schema;
    }

    /** A daily sample is captured once, including its denominator, in the same database snapshot. */
    async capture(tenantId: string, now = new Date()): Promise<void> {
        const schema = await this.schema(tenantId);
        const window = watchtowerWindow(now);
        await this.prisma.transactionInTenantSchema(schema, async query => {
            // Existing message/activity columns are UTC timestamps without timezone.
            await query("SELECT set_config('TimeZone','UTC',true)");
            await query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))::text', [`agent-privacy:${schema}`]);
            await query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text', [`quality-sampling:${schema}:${window.day}`]);
            const prior = await query<any[]>('SELECT id FROM quality_sampling_runs WHERE sample_day=$1::date', [window.day]);
            if (prior.length) return;
            // Complete previous UTC day; no resolution filter. Selection includes
            // abandoned and handed-off conversations and never uses a judge score.
            const rows = await query<any[]>(`WITH eligible AS MATERIALIZED (
                SELECT c.id, c.contact_id FROM conversations c
                JOIN LATERAL (SELECT COUNT(*) FILTER(WHERE direction='inbound')::int AS inbound_messages, MAX(created_at) AS last_message
                    FROM messages WHERE conversation_id=c.id AND direction IN ('inbound','outbound')
                        AND content_text IS NOT NULL AND BTRIM(content_text) <> '' AND content_text <> '[REDACTED]') m ON true
                WHERE c.contact_id IS NOT NULL AND c.channel_type::text=ANY($3::text[])
                    AND m.inbound_messages>=1 AND m.last_message >= $1::timestamptz AND m.last_message < $2::timestamptz
                    AND c.updated_at < $2::timestamptz
                    AND NOT EXISTS(SELECT 1 FROM customer_memory_erasure e WHERE e.contact_id=c.contact_id)
            ), total AS (SELECT COUNT(*)::int AS n FROM eligible), selected AS (
                SELECT id,contact_id FROM eligible ORDER BY encode(sha256(convert_to(id::text || $2::text,'UTF8')),'hex'),id
                LIMIT (SELECT LEAST($5::int,CEIL(n*$4::numeric)::int) FROM total)
            ) SELECT total.n AS eligible_count, COALESCE(jsonb_agg(selected) FILTER(WHERE selected.id IS NOT NULL),'[]'::jsonb) AS selected
                FROM total LEFT JOIN selected ON true GROUP BY total.n`,
                [window.start, window.end, [...CONVERSATIONAL_CHANNELS], FRACTION, SAMPLE_CAP]);
            if (!rows.length || !Number.isInteger(Number(rows[0].eligible_count)) || !Array.isArray(rows[0].selected))
                throw new Error('sampling_evidence_unavailable');
            const selected = rows[0].selected;
            const runs = await query<any[]>(`INSERT INTO quality_sampling_runs(sample_day,window_start,window_end,eligible_count,selected_count,requested_fraction,sample_cap)
                VALUES($1::date,$2::timestamptz,$3::timestamptz,$4,$5,$6,$7) RETURNING id`,
                [window.day, window.start, window.end, Number(rows[0].eligible_count), selected.length, FRACTION, SAMPLE_CAP]);
            for (const item of selected) await query(`INSERT INTO quality_sampling_items(run_id,conversation_id,contact_id)
                VALUES($1::uuid,$2::uuid,$3::uuid)`, [runs[0].id, item.id, item.contact_id]);
        });
    }

    /** Uncertain enqueue acknowledgements reuse the durable id instead of creating another grading request. */
    async dispatch(tenantId: string): Promise<void> {
        const schema = await this.schema(tenantId);
        for (let count = 0; count < SAMPLE_CAP; count++) {
            const token = randomUUID();
            const rows = await this.prisma.transactionInTenantSchema(schema, async query => {
                await query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))::text', [`agent-privacy:${schema}`]);
                await query(`UPDATE quality_sampling_items i SET state='erased',contact_id=NULL,conversation_id=NULL,
                    lease_token=NULL,lease_expires_at=NULL,last_error_code=NULL
                    WHERE state='selected' AND (contact_id IS NULL OR conversation_id IS NULL
                        OR EXISTS(SELECT 1 FROM customer_memory_erasure e WHERE e.contact_id=i.contact_id))`);
                await query(`UPDATE quality_sampling_items SET state='failed',lease_token=NULL,lease_expires_at=NULL,
                    last_error_code='queue_acknowledgement_unconfirmed' WHERE state='selected' AND attempts>=$1
                    AND lease_expires_at<NOW()`, [MAX_DISPATCH_ATTEMPTS]);
                return query<any[]>(`WITH candidate AS (
                    SELECT id FROM quality_sampling_items WHERE state='selected' AND next_attempt_at<=NOW()
                        AND (lease_expires_at IS NULL OR lease_expires_at<NOW()) AND attempts<$2
                    ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED
                ) UPDATE quality_sampling_items i SET lease_token=$1::uuid,lease_expires_at=NOW()+INTERVAL '2 minutes',
                    attempts=i.attempts+1 FROM candidate WHERE i.id=candidate.id RETURNING i.id,i.conversation_id,i.attempts`, [token, MAX_DISPATCH_ATTEMPTS]);
            });
            if (!rows.length) break;
            const item = rows[0];
            try {
                await this.queue.add('score', { tenantId, conversationId: item.conversation_id }, {
                    jobId: `q-sample-${item.id}`, attempts: 3, backoff: { type: 'exponential', delay: 5000 },
                    removeOnComplete: { age: 91 * 86_400 }, removeOnFail: { age: 91 * 86_400 },
                });
                await this.prisma.executeInTenantSchema(schema, `UPDATE quality_sampling_items SET state='queued',queued_at=NOW(),
                    lease_token=NULL,lease_expires_at=NULL,last_error_code=NULL WHERE id=$1::uuid AND lease_token=$2::uuid AND state='selected'`, [item.id, token]);
            } catch {
                await this.prisma.executeInTenantSchema(schema, `UPDATE quality_sampling_items
                    SET state=CASE WHEN attempts>=$3 THEN 'failed' ELSE 'selected' END,
                        next_attempt_at=NOW()+INTERVAL '5 minutes',lease_token=NULL,lease_expires_at=NULL,
                        last_error_code='quality_queue_unavailable' WHERE id=$1::uuid AND lease_token=$2::uuid AND state='selected'`, [item.id, token, MAX_DISPATCH_ATTEMPTS]);
            }
        }
        await this.prisma.executeInTenantSchema(schema, `DELETE FROM quality_sampling_runs WHERE created_at<NOW()-INTERVAL '90 days'`);
    }

    @Cron('0 2 * * *', { timeZone: 'UTC' })
    async sampleDaily(): Promise<void> { await this.sweep(true); }

    @Cron('*/5 * * * *')
    async recoverDispatch(): Promise<void> { await this.sweep(new Date().getUTCHours() >= 2); }

    private async sweep(capture: boolean): Promise<void> {
        if (this.sweepRunning) return;
        this.sweepRunning = true;
        try {
            let cursor: string | undefined;
            do {
                const tenants = await this.prisma.tenant.findMany({ where: { isActive: true }, select: { id: true },
                    orderBy: { id: 'asc' }, take: 25, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
                if (!tenants.length) break;
                for (const tenant of tenants) {
                    try { if (capture) await this.capture(tenant.id); await this.dispatch(tenant.id); }
                    catch { this.logger.warn(`[Watchtower] Sampling unavailable for tenant ${tenant.id}`); }
                }
                cursor = tenants[tenants.length - 1].id;
                if (tenants.length < 25) break;
            } while (true);
        } catch { this.logger.warn('[Watchtower] Tenant inventory unavailable'); }
        finally { this.sweepRunning = false; }
    }

    async report(tenantId: string, day?: string): Promise<any> {
        const date = day || watchtowerWindow(new Date()).day;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10)!==date)
            throw new BadRequestException({ error: 'invalid_sampling_date' });
        const schema = await this.schema(tenantId);
        const rows = await this.prisma.executeInTenantSchema<any[]>(schema, `SELECT r.*,COUNT(i.id) FILTER(WHERE i.state='queued')::int AS queued,
            COUNT(i.id) FILTER(WHERE i.state='selected')::int AS pending, COUNT(i.id) FILTER(WHERE i.state='failed')::int AS failed,
            COUNT(i.id) FILTER(WHERE i.state='erased')::int AS erased FROM quality_sampling_runs r
            LEFT JOIN quality_sampling_items i ON i.run_id=r.id WHERE r.sample_day=$1::date GROUP BY r.id`, [date]);
        if (!rows.length) return { state: 'not_captured', day: date, eligible: null, selected: null, queued: null, pending: null, failed: null, erased: null };
        const row = rows[0];
        return { state: 'available', day: date, windowStart: row.window_start, windowEnd: row.window_end,
            eligible: Number(row.eligible_count), selected: row.selected_count, queued: row.queued, pending: row.pending, failed: row.failed, erased: row.erased,
            requestedFraction: Number(row.requested_fraction), sampleCap: row.sample_cap,
            actualFraction: Number(row.eligible_count) > 0 ? Number(row.selected_count) / Number(row.eligible_count) : null,
            evidence: 'queue_acceptance', methodology: 'previous_utc_day_inactive_text_conversations' };
    }
}
