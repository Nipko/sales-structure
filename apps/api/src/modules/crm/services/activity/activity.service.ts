import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { RedisService } from '../../../redis/redis.service';

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
     */
    async getTimeline(tenantId: string, leadId: string) {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) throw new Error('Tenant not found');

        // Get lead contact_id for linking conversations
        const lead = await this.prisma.executeInTenantSchema<any[]>(schema,
            `SELECT id, contact_id, phone FROM leads WHERE id = $1::uuid LIMIT 1`,
            [leadId]
        );
        if (!lead || lead.length === 0) throw new Error('Lead not found');
        const contactId = lead[0].contact_id;

        // Parallel queries: notes, tasks, stage history, analytics events
        const [notes, tasks, stageHistory, analyticsEvents, messages] = await Promise.all([
            this.prisma.executeInTenantSchema<any[]>(schema,
                `SELECT 'note' as event_type, id, created_at, content as description, created_by as actor
                 FROM notes WHERE lead_id = $1::uuid ORDER BY created_at DESC LIMIT 50`,
                [leadId]
            ),
            this.prisma.executeInTenantSchema<any[]>(schema,
                `SELECT 'task' as event_type, id, created_at, title as description, created_by as actor, status, due_at
                 FROM tasks WHERE lead_id = $1::uuid ORDER BY created_at DESC LIMIT 50`,
                [leadId]
            ),
            this.prisma.executeInTenantSchema<any[]>(schema,
                `SELECT 'stage_change' as event_type, id, created_at, 
                    (from_stage || ' → ' || to_stage) as description, triggered_by as actor
                 FROM stage_history WHERE lead_id = $1::uuid ORDER BY created_at DESC LIMIT 50`,
                [leadId]
            ),
            this.prisma.executeInTenantSchema<any[]>(schema,
                `SELECT 'event' as event_type, id, created_at, event_type as description, NULL as actor
                 FROM analytics_events WHERE contact_id = $1::uuid ORDER BY created_at DESC LIMIT 50`,
                [contactId]
            ),
            contactId
                ? this.prisma.executeInTenantSchema<any[]>(schema,
                    `SELECT 'message' as event_type, m.id, m.created_at, 
                        COALESCE(m.content_text, '[media]') as description, m.direction as actor
                     FROM messages m
                     JOIN conversations c ON c.id = m.conversation_id
                     WHERE c.contact_id = $1::uuid
                     ORDER BY m.created_at DESC LIMIT 30`,
                    [contactId]
                )
                : Promise.resolve([]),
        ]);

        // Merge and sort all events by created_at DESC
        const all = [...notes, ...tasks, ...stageHistory, ...analyticsEvents, ...messages];
        all.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

        return all.slice(0, 100);
    }

    async logEvent(tenantId: string, leadId: string, contactId: string | null, eventType: string, data: Record<string, any>) {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) return;

        await this.prisma.executeInTenantSchema(schema, `
            INSERT INTO analytics_events (event_type, lead_id, contact_id, data)
            VALUES ($1, $2, $3, $4)
        `, [eventType, leadId, contactId, JSON.stringify(data)]);
    }
}
