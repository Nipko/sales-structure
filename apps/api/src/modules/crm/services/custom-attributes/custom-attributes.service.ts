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

    // ======= Custom Attribute VALUES =======

    async getValuesForEntity(tenantId: string, entityType: string, entityId: string) {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) throw new Error('Tenant not found');

        return this.prisma.executeInTenantSchema<any[]>(schema,
            `SELECT v.*, d.attribute_key, d.attribute_label, d.attribute_type, d.options
             FROM custom_attribute_values v
             JOIN custom_attribute_definitions d ON d.id = v.definition_id
             WHERE v.entity_id = $1::uuid AND v.entity_type = $2
             ORDER BY d.position ASC, d.attribute_label ASC`,
            [entityId, entityType],
        );
    }

    async setValuesForEntity(
        tenantId: string,
        entityType: string,
        entityId: string,
        values: { definitionId: string; value: any }[],
    ) {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) throw new Error('Tenant not found');

        for (const { definitionId, value } of values) {
            // Determine which column to use based on value type
            let valueText: string | null = null;
            let valueNumber: number | null = null;
            let valueBoolean: boolean | null = null;
            let valueDate: string | null = null;
            let valueJson: any = null;

            if (value === null || value === undefined || value === '') {
                // Delete the value
                await this.prisma.executeInTenantSchema(schema,
                    `DELETE FROM custom_attribute_values WHERE definition_id = $1::uuid AND entity_id = $2::uuid`,
                    [definitionId, entityId],
                );
                continue;
            }

            if (typeof value === 'boolean') {
                valueBoolean = value;
            } else if (typeof value === 'number') {
                valueNumber = value;
            } else if (Array.isArray(value) || typeof value === 'object') {
                valueJson = JSON.stringify(value);
            } else {
                // Check if it's a date
                const dateTest = new Date(value);
                if (!isNaN(dateTest.getTime()) && String(value).match(/^\d{4}-\d{2}/)) {
                    valueDate = dateTest.toISOString();
                } else {
                    valueText = String(value);
                }
            }

            await this.prisma.executeInTenantSchema(schema,
                `INSERT INTO custom_attribute_values (definition_id, entity_id, entity_type, value_text, value_number, value_boolean, value_date, value_json)
                 VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8::jsonb)
                 ON CONFLICT (definition_id, entity_id) DO UPDATE SET
                   value_text = EXCLUDED.value_text,
                   value_number = EXCLUDED.value_number,
                   value_boolean = EXCLUDED.value_boolean,
                   value_date = EXCLUDED.value_date,
                   value_json = EXCLUDED.value_json,
                   updated_at = NOW()`,
                [definitionId, entityId, entityType, valueText, valueNumber, valueBoolean, valueDate, valueJson],
            );
        }

        return { success: true };
    }
}
