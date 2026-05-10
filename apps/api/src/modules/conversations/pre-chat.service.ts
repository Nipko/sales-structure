import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

interface FormField {
    key: string;
    label: string;
    type: 'text' | 'email' | 'phone' | 'select' | 'number';
    required: boolean;
    options?: string[];
    map_to: string;
}

@Injectable()
export class PreChatService {
    private readonly logger = new Logger(PreChatService.name);

    constructor(private prisma: PrismaService) {}

    private async getSchema(tenantId: string): Promise<string> {
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { schemaName: true },
        });
        if (!tenant?.schemaName) throw new NotFoundException('Tenant not found');
        return tenant.schemaName;
    }

    async getActiveForm(tenantId: string) {
        const schema = await this.getSchema(tenantId);

        const rows = await this.prisma.executeInTenantSchema(schema,
            `SELECT id, name, fields_json, greeting_message, is_active, created_at, updated_at
             FROM pre_chat_forms WHERE is_active = true LIMIT 1`,
            [],
        ) as any[];

        if (!rows.length) return null;

        const row = rows[0];
        return {
            id: row.id,
            name: row.name,
            fields: typeof row.fields_json === 'string' ? JSON.parse(row.fields_json) : row.fields_json,
            greeting_message: row.greeting_message,
            is_active: row.is_active,
        };
    }

    async saveForm(tenantId: string, data: {
        is_active: boolean;
        greeting_message?: string;
        fields: FormField[];
    }) {
        const schema = await this.getSchema(tenantId);

        await this.prisma.executeInTenantSchema(schema,
            `UPDATE pre_chat_forms SET is_active = false, updated_at = NOW() WHERE is_active = true`,
            [],
        );

        const rows = await this.prisma.executeInTenantSchema(schema, `
            INSERT INTO pre_chat_forms (tenant_id, name, fields_json, greeting_message, is_active)
            VALUES ($1, 'default', $2, $3, $4)
            RETURNING id, name, fields_json, greeting_message, is_active
        `, [
            tenantId,
            JSON.stringify(data.fields),
            data.greeting_message || null,
            data.is_active,
        ]) as any[];

        this.logger.log(`Saved pre-chat form for tenant ${tenantId}`);
        const row = rows[0];
        return {
            id: row.id,
            name: row.name,
            fields: typeof row.fields_json === 'string' ? JSON.parse(row.fields_json) : row.fields_json,
            greeting_message: row.greeting_message,
            is_active: row.is_active,
        };
    }
}
