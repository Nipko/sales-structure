import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

interface MacroAction {
    type: 'assign' | 'tag' | 'change_status' | 'add_note' | 'send_canned';
    value: any;
}

@Injectable()
export class MacrosService {
    private readonly logger = new Logger(MacrosService.name);

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

    async getMacros(tenantId: string) {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) throw new Error('Tenant not found');

        return this.prisma.executeInTenantSchema<any[]>(schema,
            `SELECT * FROM macros ORDER BY name ASC`,
            [],
        );
    }

    async createMacro(tenantId: string, data: {
        name: string;
        description?: string;
        actionsJson: MacroAction[];
    }) {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) throw new Error('Tenant not found');

        const result = await this.prisma.executeInTenantSchema<any[]>(schema, `
            INSERT INTO macros (name, description, actions_json)
            VALUES ($1, $2, $3)
            RETURNING *
        `, [
            data.name,
            data.description || null,
            JSON.stringify(data.actionsJson),
        ]);

        this.logger.log(`Created macro "${data.name}"`);
        return result[0];
    }

    async updateMacro(tenantId: string, macroId: string, data: Partial<{
        name: string;
        description: string;
        actionsJson: MacroAction[];
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
        if (data.actionsJson !== undefined) {
            setClauses.push(`actions_json = $${n++}`);
            params.push(JSON.stringify(data.actionsJson));
        }

        if (setClauses.length === 0) return null;

        setClauses.push(`updated_at = NOW()`);
        params.push(macroId);

        const result = await this.prisma.executeInTenantSchema<any[]>(schema, `
            UPDATE macros
            SET ${setClauses.join(', ')}
            WHERE id = $${n}::uuid
            RETURNING *
        `, params);

        return result[0] || null;
    }

    async deleteMacro(tenantId: string, macroId: string) {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) throw new Error('Tenant not found');

        const result = await this.prisma.executeInTenantSchema<any[]>(schema,
            `DELETE FROM macros WHERE id = $1::uuid RETURNING id`,
            [macroId],
        );

        return result.length > 0;
    }

    async executeMacro(tenantId: string, macroId: string, conversationId: string, agentId: string) {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) throw new Error('Tenant not found');

        // Fetch macro
        const macros = await this.prisma.executeInTenantSchema<any[]>(schema,
            `SELECT * FROM macros WHERE id = $1::uuid`,
            [macroId],
        );
        if (!macros.length) throw new Error('Macro not found');

        const macro = macros[0];
        const actions: MacroAction[] = typeof macro.actions_json === 'string'
            ? JSON.parse(macro.actions_json)
            : macro.actions_json;

        this.logger.log(`Executing macro "${macro.name}" (${actions.length} actions) on conversation ${conversationId}`);

        // Get contact_id for the conversation
        const convRows = await this.prisma.executeInTenantSchema<any[]>(schema,
            `SELECT contact_id FROM conversations WHERE id = $1::uuid`,
            [conversationId],
        );
        const contactId = convRows[0]?.contact_id;

        for (const action of actions) {
            try {
                switch (action.type) {
                    case 'assign':
                        await this.prisma.executeInTenantSchema(schema,
                            `UPDATE conversations SET assigned_to = $1::uuid, updated_at = NOW() WHERE id = $2::uuid`,
                            [action.value, conversationId],
                        );
                        break;

                    case 'tag':
                        if (contactId) {
                            await this.prisma.executeInTenantSchema(schema,
                                `UPDATE contacts SET tags = array_append(tags, $1), updated_at = NOW() WHERE id = $2::uuid`,
                                [action.value, contactId],
                            );
                        }
                        break;

                    case 'change_status':
                        await this.prisma.executeInTenantSchema(schema,
                            `UPDATE conversations SET status = $1, updated_at = NOW() WHERE id = $2::uuid`,
                            [action.value, conversationId],
                        );
                        break;

                    case 'add_note':
                        await this.prisma.executeInTenantSchema(schema, `
                            INSERT INTO internal_notes (conversation_id, content, created_by)
                            VALUES ($1::uuid, $2, $3::uuid)
                        `, [conversationId, action.value, agentId]);
                        break;

                    case 'send_canned': {
                        const canned = await this.prisma.executeInTenantSchema<any[]>(schema,
                            `SELECT content FROM canned_responses WHERE shortcode = $1 LIMIT 1`,
                            [action.value],
                        );
                        if (canned.length) {
                            // Store the message — actual sending is handled by the outbound queue
                            await this.prisma.executeInTenantSchema(schema, `
                                INSERT INTO messages (conversation_id, content_text, direction, sender_type, sender_id)
                                VALUES ($1::uuid, $2, 'outbound', 'agent', $3::uuid)
                            `, [conversationId, canned[0].content, agentId]);
                        }
                        break;
                    }

                    default:
                        this.logger.warn(`Unknown macro action type: ${(action as any).type}`);
                }
            } catch (error) {
                this.logger.error(`Failed to execute macro action "${action.type}": ${error.message}`);
            }
        }

        // Update macro execution count
        await this.prisma.executeInTenantSchema(schema,
            `UPDATE macros SET execution_count = COALESCE(execution_count, 0) + 1, last_executed_at = NOW() WHERE id = $1::uuid`,
            [macroId],
        );

        return { success: true, actionsExecuted: actions.length };
    }
}
