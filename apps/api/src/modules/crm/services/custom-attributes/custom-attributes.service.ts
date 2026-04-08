import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { RedisService } from '../../../redis/redis.service';

@Injectable()
export class CustomAttributesService {
    private readonly logger = new Logger(CustomAttributesService.name);

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

    async getDefinitions(tenantId: string, entityType?: string) {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) throw new Error('Tenant not found');

        if (entityType) {
            return this.prisma.executeInTenantSchema<any[]>(schema,
                `SELECT * FROM custom_attribute_definitions
                 WHERE entity_type = $1
                 ORDER BY created_at ASC`,
                [entityType],
            );
        }

        return this.prisma.executeInTenantSchema<any[]>(schema,
            `SELECT * FROM custom_attribute_definitions ORDER BY entity_type, created_at ASC`,
            [],
        );
    }

    async createDefinition(tenantId: string, data: {
        entityType: string;
        attributeKey: string;
        attributeLabel: string;
        attributeType: string;
        options?: any;
        required?: boolean;
    }) {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) throw new Error('Tenant not found');

        const result = await this.prisma.executeInTenantSchema<any[]>(schema, `
            INSERT INTO custom_attribute_definitions
                (entity_type, attribute_key, attribute_label, attribute_type, options, required)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
        `, [
            data.entityType,
            data.attributeKey,
            data.attributeLabel,
            data.attributeType,
            data.options ? JSON.stringify(data.options) : null,
            data.required ?? false,
        ]);

        this.logger.log(`Created custom attribute definition "${data.attributeKey}" for ${data.entityType}`);
        return result[0];
    }

    async updateDefinition(tenantId: string, id: string, data: Partial<{
        attributeLabel: string;
        attributeType: string;
        options: any;
        required: boolean;
    }>) {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) throw new Error('Tenant not found');

        const setClauses: string[] = [];
        const params: any[] = [];
        let n = 1;

        if (data.attributeLabel !== undefined) {
            setClauses.push(`attribute_label = $${n++}`);
            params.push(data.attributeLabel);
        }
        if (data.attributeType !== undefined) {
            setClauses.push(`attribute_type = $${n++}`);
            params.push(data.attributeType);
        }
        if (data.options !== undefined) {
            setClauses.push(`options = $${n++}`);
            params.push(JSON.stringify(data.options));
        }
        if (data.required !== undefined) {
            setClauses.push(`required = $${n++}`);
            params.push(data.required);
        }

        if (setClauses.length === 0) return null;

        setClauses.push(`updated_at = NOW()`);
        params.push(id);

        const result = await this.prisma.executeInTenantSchema<any[]>(schema, `
            UPDATE custom_attribute_definitions
            SET ${setClauses.join(', ')}
            WHERE id = $${n}::uuid
            RETURNING *
        `, params);

        return result[0] || null;
    }

    async deleteDefinition(tenantId: string, id: string) {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) throw new Error('Tenant not found');

        const result = await this.prisma.executeInTenantSchema<any[]>(schema,
            `DELETE FROM custom_attribute_definitions WHERE id = $1::uuid RETURNING id`,
            [id],
        );

        return result.length > 0;
    }
}
