import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { RedisService } from '../../../redis/redis.service';
import { optionalSection, resolveLeadReference } from '../lead-reference';

@Injectable()
export class ActivityService {
    private readonly logger = new Logger(ActivityService.name);

    constructor(
        private prisma: PrismaService,
        private redis: RedisService,
    ) {}

    private async getTenantSchema(tenantId: string): Promise<string | null> {
        const cached = await this.redis.get(`tenant:${tenantId}:schema`);
        if (cached) return cached;
        const tenant = await this.prisma.$queryRaw<any[]>`
            SELECT schema_name FROM tenants WHERE id = ${tenantId}::uuid LIMIT 1
        `;
        if (tenant && tenant.length > 0) {
            const schema = tenant[0].schema_name;
            await this.redis.set(`tenant:${tenantId}:schema`, schema, 3600);
            return schema;
        }
        return null;
    }

    /**
     * Consolidated Activity Timeline for a Lead.
     * Merges: analytics_events, messages (via conversations), notes, tasks, stage_history
     *
     * `ref` is a lead id or a contact id (see `lead-reference.ts`). A contact with no lead
     * still has a timeline: its events and messages. Every source is optional - one that a
     * legacy tenant cannot serve is logged and left out, the rest of the timeline is served.
     */
    async getTimeline(tenantId: string, ref: string) {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) throw new NotFoundException({ error: 'tenant_not_found', message: 'Tenant not found' });

        const { leadId, contactId } = await resolveLeadReference(this.prisma, schema, ref);
        const read = (label: string, sql: string, params: any[]) =>
            optionalSection<any[]>(label, [], () => this.prisma.executeInTenantSchema<any[]>(schema, sql, params));

        // Sequential queries to avoid PgBouncer transaction timeout from 5 parallel connections
        const notes = leadId ? await read('notes',
            `SELECT 'note' as event_type, id, created_at, content as description, created_by as actor
             FROM notes WHERE lead_id = $1::uuid ORDER BY created_at DESC LIMIT 50`,
            [leadId]) : [];
        const tasks = leadId ? await read('tasks',
            `SELECT 'task' as event_type, id, created_at, title as description, created_by as actor, status, due_at
             FROM tasks WHERE lead_id = $1::uuid ORDER BY created_at DESC LIMIT 50`,
            [leadId]) : [];
        const stageHistory = leadId ? await read('stage_history',
            `SELECT 'stage_change' as event_type, id, created_at,
                (CASE WHEN from_stage IS NULL THEN to_stage ELSE from_stage || ' → ' || to_stage END) as description, triggered_by as actor
             FROM stage_history WHERE lead_id = $1::uuid ORDER BY created_at DESC LIMIT 50`,
            [leadId]) : [];
        const analyticsEvents = contactId ? await read('analytics_events',
            `SELECT 'event' as event_type, id, created_at, event_type as description, NULL::text as actor
             FROM analytics_events WHERE contact_id = $1::uuid ORDER BY created_at DESC LIMIT 50`,
            [contactId]) : [];
        const messages = contactId ? await read('messages',
            `SELECT 'message' as event_type, m.id, m.created_at,
                COALESCE(m.content_text, '[media]') as description, m.direction as actor
             FROM messages m
             JOIN conversations c ON c.id = m.conversation_id
             WHERE c.contact_id = $1::uuid
             ORDER BY m.created_at DESC LIMIT 30`,
            [contactId]) : [];

        const all = [...notes, ...tasks, ...stageHistory, ...analyticsEvents, ...messages];
        all.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        return all.slice(0, 100);
    }

    async logEvent(tenantId: string, leadId: string, contactId: string | null, eventType: string, data: Record<string, any>) {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) return;

        await this.prisma.executeInTenantSchema(schema, `
            INSERT INTO analytics_events (event_type, contact_id, data)
            VALUES ($1, $2::uuid, $3::jsonb)
        `, [eventType, contactId, JSON.stringify({ ...data, lead_id: leadId })]);
    }
}
