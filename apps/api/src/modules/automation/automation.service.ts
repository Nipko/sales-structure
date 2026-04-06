import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ActionExecutorService } from './action-executor.service';

@Injectable()
export class AutomationService {
    private readonly logger = new Logger(AutomationService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly executor: ActionExecutorService
    ) {}

    // ─── Event Listeners ──────────────────────────────────────────────────────
    // NOTA: El manejo de 'lead.captured' se delega a AutomationListenerService
    // que programa las acciones con delay via BullMQ para que el saludo AI
    // llegue primero antes de enviar la plantilla.

    // ─── Core Rules Engine ────────────────────────────────────────────────────

    private async evaluateEvent(tenantId: string, schemaName: string, eventType: string, eventPayload: any) {
        try {
            // 1. Fetch active rules for this event type
            const activeRules = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT * FROM automation_rules WHERE trigger_type = $1 AND active = true`,
                [eventType]
            );

            if (!activeRules || activeRules.length === 0) {
                this.logger.debug(`[Automation] No active rules found for event: ${eventType}`);
                return;
            }

            // 2. Evaluate each rule
            for (const rule of activeRules) {
                const match = this.evaluateConditions(rule.conditions_json, eventPayload);
                if (match) {
                    this.logger.log(`[Automation] Rule '${rule.name}' matched for event ${eventType}. Executing actions...`);
                    
                    // Create an execution record
                    const execution = await this.prisma.executeInTenantSchema<any[]>(
                        schemaName,
                        `INSERT INTO automation_executions (rule_id, entity_type, entity_id, status)
                         VALUES ($1, $2, $3, $4) RETURNING *`,
                        [rule.id, eventPayload.isNew !== undefined ? 'lead' : 'unknown', eventPayload.leadId || null, 'processing']
                    );

                    // Execute actions asynchronously or synchronously
                    // Parse actions_json safely
                    let actions = [];
                    if (typeof rule.actions_json === 'string') {
                         try { actions = JSON.parse(rule.actions_json); } catch (e) { actions = []; }
                    } else if (Array.isArray(rule.actions_json)) {
                         actions = rule.actions_json;
                    }
                    
                    try {
                        await this.executor.executeActions(schemaName, actions, eventPayload);
                        
                        // Mark as success
                        await this.prisma.executeInTenantSchema(
                            schemaName,
                            `UPDATE automation_executions SET status = 'success', finished_at = CURRENT_TIMESTAMP WHERE id = $1`,
                            [execution[0].id]
                        );
                    } catch (err) {
                        this.logger.error(`[Automation] Rule execution failed: ${err.message}`);
                        // Mark as failed
                         await this.prisma.executeInTenantSchema(
                            schemaName,
                            `UPDATE automation_executions 
                             SET status = 'failed', finished_at = CURRENT_TIMESTAMP, result_json = $2
                             WHERE id = $1`,
                            [execution[0].id, { error: err.message }]
                        );
                    }
                }
            }
        } catch (error) {
            this.logger.error(`[Automation] Failed to evaluate event ${eventType}: ${error.message}`);
        }
    }

    private evaluateConditions(conditions: any, payload: any): boolean {
        if (!conditions) return true;

        // New structured format: [{ field, operator, value }]
        if (Array.isArray(conditions)) {
            if (conditions.length === 0) return true;
            return conditions.every((c: any) => this.evaluateCondition(c, payload));
        }

        // Legacy format: { key: value } — simple equality
        if (typeof conditions === 'object' && Object.keys(conditions).length === 0) return true;
        for (const [key, expectedValue] of Object.entries(conditions)) {
            if (payload[key] !== expectedValue) return false;
        }
        return true;
    }

    private evaluateCondition(condition: { field: string; operator: string; value: string }, payload: any): boolean {
        const actual = payload[condition.field];
        const expected = condition.value;

        switch (condition.operator) {
            case 'equals':
                return String(actual) === String(expected);
            case 'not_equals':
                return String(actual) !== String(expected);
            case 'greater_than':
                return Number(actual) > Number(expected);
            case 'less_than':
                return Number(actual) < Number(expected);
            case 'contains':
                return String(actual || '').toLowerCase().includes(String(expected).toLowerCase());
            default:
                return String(actual) === String(expected);
        }
    }

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
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [
                payload.tenant_id,
                payload.name,
                payload.trigger_type,
                payload.conditions_json || '{}',
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
