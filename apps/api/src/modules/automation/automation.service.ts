import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AutomationService {
    private readonly logger = new Logger(AutomationService.name);

    constructor(
        private readonly prisma: PrismaService
    ) {}

    // ─── Event Listeners ──────────────────────────────────────────────────────
    // NOTA: El manejo de 'lead.captured' se delega a AutomationListenerService
    // que programa las acciones con delay via BullMQ para que el saludo AI
    // llegue primero antes de enviar la plantilla.

    // ─── CRUD for Rules ───────────────────────────────────────────────────────

    async getRules(schemaName: string) {
        return this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT
                r.*,
                COALESCE(exec.execution_count, 0) AS execution_count,
                exec.last_executed_at
             FROM automation_rules r
             LEFT JOIN (
                SELECT
                    rule_id,
                    COUNT(*)::int AS execution_count,
                    MAX(COALESCE(finished_at, started_at)) AS last_executed_at
                FROM automation_executions
                GROUP BY rule_id
             ) exec ON exec.rule_id = r.id
             ORDER BY r.created_at DESC`
        );
    }

    async createRule(schemaName: string, payload: any) {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `INSERT INTO automation_rules (tenant_id, name, trigger_type, conditions_json, actions_json, active)
             VALUES ($1::uuid, $2, $3, $4::jsonb, $5::jsonb, $6) RETURNING *`,
            [
                payload.tenant_id,
                payload.name,
                payload.trigger_type,
                JSON.stringify(payload.conditions_json || {}),
                JSON.stringify(payload.actions_json || []),
                payload.active ?? true
            ]
        );
        return rows[0];
    }

    async toggleRule(schemaName: string, ruleId: string, isActive?: boolean) {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `UPDATE automation_rules
             SET active = COALESCE($2, NOT active), updated_at = CURRENT_TIMESTAMP
             WHERE id = $1::uuid
             RETURNING *`,
            [ruleId, isActive ?? null]
        );

        return rows[0] || null;
    }

    async updateRule(schemaName: string, ruleId: string, payload: any) {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `UPDATE automation_rules
             SET name = $2, trigger_type = $3,
                 conditions_json = $4::jsonb, actions_json = $5::jsonb,
                 active = $6, updated_at = CURRENT_TIMESTAMP
             WHERE id = $1::uuid
             RETURNING *`,
            [
                ruleId,
                payload.name,
                payload.trigger_type,
                JSON.stringify(payload.conditions_json || []),
                JSON.stringify(payload.actions_json || []),
                payload.active ?? true,
            ],
        );
        return rows?.[0] || null;
    }

    async getExecutions(schemaName: string, ruleId: string) {
        return this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT * FROM automation_executions
             WHERE rule_id = $1::uuid
             ORDER BY started_at DESC
             LIMIT 50`,
            [ruleId],
        );
    }

    async deleteRule(schemaName: string, ruleId: string) {
        await this.prisma.executeInTenantSchema(
            schemaName,
            `DELETE FROM automation_rules WHERE id = $1::uuid`,
            [ruleId]
        );
    }
}
