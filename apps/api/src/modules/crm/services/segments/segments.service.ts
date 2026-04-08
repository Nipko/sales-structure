import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { RedisService } from '../../../redis/redis.service';

interface FilterRule {
    field: string;
    operator: 'eq' | 'neq' | 'in' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains';
    value: any;
}

@Injectable()
export class SegmentsService {
    private readonly logger = new Logger(SegmentsService.name);

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

    async getSegments(tenantId: string) {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) throw new Error('Tenant not found');

        return this.prisma.executeInTenantSchema<any[]>(schema,
            `SELECT * FROM contact_segments ORDER BY created_at DESC`,
            [],
        );
    }

    async createSegment(tenantId: string, data: {
        name: string;
        description?: string;
        filterRules: FilterRule[];
    }) {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) throw new Error('Tenant not found');

        // Compute initial contact count
        const { whereClause, params: filterParams } = this.buildFilterSQL(data.filterRules);
        const countResult = await this.prisma.executeInTenantSchema<any[]>(schema,
            `SELECT COUNT(*)::int as count FROM leads${whereClause ? ` WHERE ${whereClause}` : ''}`,
            filterParams,
        );
        const contactCount = countResult[0]?.count || 0;

        const insertParams = [
            data.name,
            data.description || null,
            JSON.stringify(data.filterRules),
            contactCount,
        ];

        const result = await this.prisma.executeInTenantSchema<any[]>(schema, `
            INSERT INTO contact_segments (name, description, filter_rules, contact_count)
            VALUES ($1, $2, $3, $4)
            RETURNING *
        `, insertParams);

        this.logger.log(`Created segment "${data.name}" with ${contactCount} contacts`);
        return result[0];
    }

    async updateSegment(tenantId: string, segmentId: string, data: Partial<{
        name: string;
        description: string;
        filterRules: FilterRule[];
    }>) {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) throw new Error('Tenant not found');

        const setClauses: string[] = [];
        const params: any[] = [];
        let n = 1;

        if (data.name !== undefined) {
            setClauses.push(`name = $${n++}`);
            params.push(data.name);
        }
        if (data.description !== undefined) {
            setClauses.push(`description = $${n++}`);
            params.push(data.description);
        }
        if (data.filterRules !== undefined) {
            setClauses.push(`filter_rules = $${n++}`);
            params.push(JSON.stringify(data.filterRules));

            // Recompute contact count
            const { whereClause, params: filterParams } = this.buildFilterSQL(data.filterRules);
            const countResult = await this.prisma.executeInTenantSchema<any[]>(schema,
                `SELECT COUNT(*)::int as count FROM leads${whereClause ? ` WHERE ${whereClause}` : ''}`,
                filterParams,
            );
            setClauses.push(`contact_count = $${n++}`);
            params.push(countResult[0]?.count || 0);
        }

        if (setClauses.length === 0) return null;

        setClauses.push(`updated_at = NOW()`);
        params.push(segmentId);

        const result = await this.prisma.executeInTenantSchema<any[]>(schema, `
            UPDATE contact_segments
            SET ${setClauses.join(', ')}
            WHERE id = $${n}::uuid
            RETURNING *
        `, params);

        return result[0] || null;
    }

    async deleteSegment(tenantId: string, segmentId: string) {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) throw new Error('Tenant not found');

        const result = await this.prisma.executeInTenantSchema<any[]>(schema,
            `DELETE FROM contact_segments WHERE id = $1::uuid RETURNING id`,
            [segmentId],
        );

        return result.length > 0;
    }

    async getSegmentContacts(tenantId: string, segmentId: string, page = 1, limit = 25) {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) throw new Error('Tenant not found');

        // Fetch segment filter rules
        const segments = await this.prisma.executeInTenantSchema<any[]>(schema,
            `SELECT filter_rules FROM contact_segments WHERE id = $1::uuid`,
            [segmentId],
        );
        if (!segments.length) throw new Error('Segment not found');

        const rules: FilterRule[] = typeof segments[0].filter_rules === 'string'
            ? JSON.parse(segments[0].filter_rules)
            : segments[0].filter_rules;

        const { whereClause, params } = this.buildFilterSQL(rules);
        const offset = (page - 1) * limit;

        let n = params.length + 1;
        const query = `SELECT * FROM leads${whereClause ? ` WHERE ${whereClause}` : ''}
            ORDER BY created_at DESC
            LIMIT $${n++} OFFSET $${n++}`;
        params.push(limit, offset);

        return this.prisma.executeInTenantSchema<any[]>(schema, query, params);
    }

    async refreshCount(tenantId: string, segmentId: string) {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) throw new Error('Tenant not found');

        const segments = await this.prisma.executeInTenantSchema<any[]>(schema,
            `SELECT filter_rules FROM contact_segments WHERE id = $1::uuid`,
            [segmentId],
        );
        if (!segments.length) throw new Error('Segment not found');

        const rules: FilterRule[] = typeof segments[0].filter_rules === 'string'
            ? JSON.parse(segments[0].filter_rules)
            : segments[0].filter_rules;

        const { whereClause, params } = this.buildFilterSQL(rules);
        const countResult = await this.prisma.executeInTenantSchema<any[]>(schema,
            `SELECT COUNT(*)::int as count FROM leads${whereClause ? ` WHERE ${whereClause}` : ''}`,
            params,
        );
        const count = countResult[0]?.count || 0;

        await this.prisma.executeInTenantSchema(schema,
            `UPDATE contact_segments SET contact_count = $1, updated_at = NOW() WHERE id = $2::uuid`,
            [count, segmentId],
        );

        return count;
    }

    private buildFilterSQL(rules: FilterRule[]): { whereClause: string; params: any[] } {
        if (!rules || rules.length === 0) {
            return { whereClause: '', params: [] };
        }

        const conditions: string[] = [];
        const params: any[] = [];
        let n = 1;

        for (const rule of rules) {
            const isMetadata = rule.field.startsWith('metadata.');
            const column = isMetadata
                ? `metadata->>'${rule.field.replace('metadata.', '')}'`
                : rule.field;

            switch (rule.operator) {
                case 'eq':
                    conditions.push(`${column} = $${n++}`);
                    params.push(rule.value);
                    break;
                case 'neq':
                    conditions.push(`${column} != $${n++}`);
                    params.push(rule.value);
                    break;
                case 'in':
                    if (Array.isArray(rule.value)) {
                        const placeholders = rule.value.map(() => `$${n++}`).join(', ');
                        conditions.push(`${column} IN (${placeholders})`);
                        params.push(...rule.value);
                    }
                    break;
                case 'gt':
                    conditions.push(`${column} > $${n++}`);
                    params.push(rule.value);
                    break;
                case 'gte':
                    conditions.push(`${column} >= $${n++}`);
                    params.push(rule.value);
                    break;
                case 'lt':
                    conditions.push(`${column} < $${n++}`);
                    params.push(rule.value);
                    break;
                case 'lte':
                    conditions.push(`${column} <= $${n++}`);
                    params.push(rule.value);
                    break;
                case 'contains':
                    conditions.push(`${column} ILIKE $${n++}`);
                    params.push(`%${rule.value}%`);
                    break;
            }
        }

        return {
            whereClause: conditions.join(' AND '),
            params,
        };
    }
}
