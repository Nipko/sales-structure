import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { RedisService } from '../../../redis/redis.service';

@Injectable()
export class TasksService {
    private readonly logger = new Logger(TasksService.name);

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

    async getTasks(tenantId: string, filters: { leadId?: string, assignedTo?: string, status?: string }) {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) throw new Error('Tenant not found');

        const { leadId, assignedTo, status } = filters;
        let query = `SELECT * FROM tasks WHERE 1=1`;
        const params: any[] = [];
        let paramCount = 1;

        if (leadId) {
            query += ` AND lead_id = $${paramCount++}::uuid`;
            params.push(leadId);
        }
        if (assignedTo) {
            // assigned_to is VARCHAR(255), not a UUID column — compare as text
            query += ` AND assigned_to = $${paramCount++}`;
            params.push(assignedTo);
        }
        if (status) {
            query += ` AND status = $${paramCount++}`;
            params.push(status);
        }

        query += ` ORDER BY due_at ASC NULLS LAST`;

        return this.prisma.executeInTenantSchema<any[]>(schema, query, params);
    }

    async createTask(tenantId: string, data: {
        leadId: string,
        opportunityId?: string,
        title: string,
        description?: string,
        type?: string,
        dueAt?: string,
        assignedTo?: string,
        createdBy?: string
    }) {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) throw new Error('Tenant not found');

        const result = await this.prisma.executeInTenantSchema<any[]>(schema, `
            INSERT INTO tasks (
                lead_id, opportunity_id, title, description, type, due_at, assigned_to, created_by
            ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8)
            RETURNING *
        `, [
            data.leadId, data.opportunityId || null, data.title, data.description || null,
            data.type || 'follow_up', data.dueAt || null, data.assignedTo || null, data.createdBy || null
        ]);

        return result[0];
    }

    /**
     * Creates one pending follow-up for the same lead/title/ownership/due-time
     * window, even when two conversation jobs execute simultaneously.
     *
     * The advisory lock intentionally omits dueAt and opportunityId. That
     * makes every potentially-overlapping 60-second window for a lead/title
     * share one lock; bucketing the timestamp would miss pairs that straddle a
     * minute boundary (for example 12:00:59 and 12:01:00).
     */
    async createTaskIdempotently(tenantId: string, data: {
        leadId: string,
        opportunityId?: string,
        title: string,
        description?: string,
        type?: string,
        dueAt?: string,
        assignedTo?: string,
        createdBy?: string,
    }): Promise<{ task: any | null; created: boolean }> {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) throw new Error('Tenant not found');

        return this.prisma.transactionInTenantSchema(schema, async (query) => {
            await query(
                `SELECT pg_advisory_xact_lock(hashtextextended($1 || ':' || lower($2), 0))::text AS lock_acquired`,
                [`crm:open-task:${tenantId}:${data.leadId}`, data.title],
            );
            const existing = await query<any[]>(
                `SELECT * FROM tasks
                  WHERE lead_id = $1::uuid
                    AND lower(title) = lower($2)
                    AND status IN ('pending', 'in_progress')
                    AND ($3::uuid IS NULL OR opportunity_id = $3::uuid)
                    AND (($4::timestamptz IS NULL AND due_at IS NULL)
                         OR due_at BETWEEN $4::timestamptz - INTERVAL '60 seconds'
                                       AND $4::timestamptz + INTERVAL '60 seconds')
                  ORDER BY created_at DESC LIMIT 1`,
                [data.leadId, data.title, data.opportunityId || null, data.dueAt || null],
            );
            if (existing?.[0]) return { task: existing[0], created: false };

            const inserted = await query<any[]>(`
                INSERT INTO tasks (
                    lead_id, opportunity_id, title, description, type, due_at, assigned_to, created_by
                ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8)
                RETURNING *
            `, [
                data.leadId, data.opportunityId || null, data.title, data.description || null,
                data.type || 'follow_up', data.dueAt || null, data.assignedTo || null, data.createdBy || null,
            ]);
            return { task: inserted?.[0] || null, created: !!inserted?.[0] };
        });
    }

    async updateTaskStatus(tenantId: string, taskId: string, status: string) {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) throw new Error('Tenant not found');

        const completedAt = status === 'done' ? 'NOW()' : 'NULL';
        
        await this.prisma.executeInTenantSchema(schema, `
            UPDATE tasks SET status = $2, completed_at = ${status === 'done' ? 'NOW()' : 'NULL'}, updated_at = NOW()
            WHERE id = $1::uuid
        `, [taskId, status]);
    }
}
