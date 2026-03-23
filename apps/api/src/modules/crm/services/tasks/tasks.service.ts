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
        let query = `SELECT * FROM ${schema}.tasks WHERE 1=1`;
        const params: any[] = [];
        let paramCount = 1;

        if (leadId) {
            query += ` AND lead_id = $${paramCount++}`;
            params.push(leadId);
        }
        if (assignedTo) {
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
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *
        `, [
            data.leadId, data.opportunityId || null, data.title, data.description || null,
            data.type || 'follow_up', data.dueAt || null, data.assignedTo || null, data.createdBy || null
        ]);

        return result[0];
    }

    async updateTaskStatus(tenantId: string, taskId: string, status: string) {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) throw new Error('Tenant not found');

        const completedAt = status === 'done' ? 'NOW()' : 'NULL';
        
        await this.prisma.executeInTenantSchema(schema, `
            UPDATE tasks SET status = $2, completed_at = ${status === 'done' ? 'NOW()' : 'NULL'}, updated_at = NOW()
            WHERE id = $1
        `, [taskId, status]);
    }
}
