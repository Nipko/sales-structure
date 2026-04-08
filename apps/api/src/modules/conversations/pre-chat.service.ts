import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

interface FormField {
    key: string;
    label: string;
    type: 'text' | 'email' | 'phone' | 'select' | 'number';
    required: boolean;
    options?: string[];
    question: string;
}

@Injectable()
export class PreChatService {
    private readonly logger = new Logger(PreChatService.name);

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

    async getActiveForm(tenantId: string) {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) throw new Error('Tenant not found');

        const result = await this.prisma.executeInTenantSchema<any[]>(schema,
            `SELECT * FROM pre_chat_forms WHERE is_active = true LIMIT 1`,
            [],
        );

        return result[0] || null;
    }

    async saveForm(tenantId: string, data: {
        name: string;
        fields: FormField[];
        welcomeMessage?: string;
    }) {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) throw new Error('Tenant not found');

        // Deactivate all existing forms
        await this.prisma.executeInTenantSchema(schema,
            `UPDATE pre_chat_forms SET is_active = false, updated_at = NOW() WHERE is_active = true`,
            [],
        );

        // Insert new active form
        const result = await this.prisma.executeInTenantSchema<any[]>(schema, `
            INSERT INTO pre_chat_forms (name, fields, welcome_message, is_active)
            VALUES ($1, $2, $3, true)
            RETURNING *
        `, [
            data.name,
            JSON.stringify(data.fields),
            data.welcomeMessage || null,
        ]);

        this.logger.log(`Saved pre-chat form "${data.name}" for tenant ${tenantId}`);
        return result[0];
    }

    isPrechatCompleted(conversationMetadata: Record<string, any> | null): boolean {
        if (!conversationMetadata) return false;
        return conversationMetadata.prechat_completed === true;
    }

    getNextQuestion(
        tenantId: string,
        conversationId: string,
        formFields: FormField[],
        collectedData: Record<string, any>,
    ): { field: FormField; question: string } | null {
        // Find the first required field that hasn't been collected yet
        for (const field of formFields) {
            if (field.required && !(field.key in collectedData)) {
                return {
                    field,
                    question: field.question,
                };
            }
        }

        // All required fields collected
        return null;
    }

    async processResponse(
        tenantId: string,
        conversationId: string,
        currentField: string,
        value: string,
    ): Promise<{ allCollected: boolean; collectedData: Record<string, any> }> {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) throw new Error('Tenant not found');

        // Get current conversation metadata
        const convRows = await this.prisma.executeInTenantSchema<any[]>(schema,
            `SELECT metadata FROM conversations WHERE id = $1::uuid`,
            [conversationId],
        );
        if (!convRows.length) throw new Error('Conversation not found');

        const metadata = convRows[0].metadata || {};
        const prechatData = metadata.prechat_data || {};
        prechatData[currentField] = value;

        // Get the active form to check if all required fields are collected
        const form = await this.getActiveForm(tenantId);
        if (!form) throw new Error('No active pre-chat form');

        const fields: FormField[] = typeof form.fields === 'string'
            ? JSON.parse(form.fields)
            : form.fields;

        const requiredFields = fields.filter(f => f.required);
        const allCollected = requiredFields.every(f => f.key in prechatData);

        // Update conversation metadata
        const updatedMetadata = {
            ...metadata,
            prechat_data: prechatData,
            prechat_completed: allCollected,
        };

        await this.prisma.executeInTenantSchema(schema,
            `UPDATE conversations SET metadata = $1, updated_at = NOW() WHERE id = $2::uuid`,
            [JSON.stringify(updatedMetadata), conversationId],
        );

        this.logger.log(`Pre-chat field "${currentField}" collected for conversation ${conversationId}. All collected: ${allCollected}`);

        return {
            allCollected,
            collectedData: prechatData,
        };
    }
}
