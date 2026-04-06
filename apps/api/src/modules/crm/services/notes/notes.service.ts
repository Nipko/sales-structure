import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { RedisService } from '../../../redis/redis.service';

@Injectable()
export class NotesService {
    private readonly logger = new Logger(NotesService.name);

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

    async getNotes(tenantId: string, leadId: string) {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) throw new Error('Tenant not found');

        return this.prisma.executeInTenantSchema<any[]>(schema,
            `SELECT * FROM notes WHERE lead_id = $1::uuid ORDER BY created_at DESC`,
            [leadId]
        );
    }

    async createNote(tenantId: string, data: {
        leadId: string;
        opportunityId?: string;
        conversationId?: string;
        content: string;
        createdBy?: string;
    }) {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) throw new Error('Tenant not found');

        const result = await this.prisma.executeInTenantSchema<any[]>(schema, `
            INSERT INTO notes (lead_id, opportunity_id, conversation_id, content, created_by)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *
        `, [
            data.leadId,
            data.opportunityId || null,
            data.conversationId || null,
            data.content,
            data.createdBy || null
        ]);

        return result[0];
    }
}
