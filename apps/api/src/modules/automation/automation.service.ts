import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { isAutomationTriggerType } from '@parallext/shared';
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

    assertValidTriggerType(triggerType: unknown): asserts triggerType is string {
        if (!isAutomationTriggerType(triggerType)) {
            throw new BadRequestException({
                error: 'unsupported_automation_trigger',
                triggerType,
                message: 'El disparador no está conectado al runtime de automatizaciones.',
            });
        }
    }

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
        this.assertValidTriggerType(payload?.trigger_type);
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

    /**
     * Serialize quota check + insert per tenant. A controller-side COUNT followed
     * by INSERT allowed two concurrent requests (including template installs) to
     * both pass the plan limit.
     */
    async createRuleWithinQuota(
        schemaName: string,
        payload: any,
        enforceLimit: (currentCount: number) => Promise<void>,
    ) {
        this.assertValidTriggerType(payload?.trigger_type);
        return this.prisma.transactionInTenantSchema(schemaName, async (query) => {
            await query(`SELECT pg_advisory_xact_lock(hashtextextended('automation-rules', 0))::text AS lock_acquired`);
            const countRows = await query<any[]>(`SELECT COUNT(*)::int AS count FROM automation_rules`);
            await enforceLimit(Number(countRows?.[0]?.count || 0));
            const rows = await query<any[]>(
                `INSERT INTO automation_rules (tenant_id, name, trigger_type, conditions_json, actions_json, active)
                 VALUES ($1::uuid, $2, $3, $4::jsonb, $5::jsonb, $6) RETURNING *`,
                [
                    payload.tenant_id,
                    payload.name,
                    payload.trigger_type,
                    JSON.stringify(payload.conditions_json || {}),
                    JSON.stringify(payload.actions_json || []),
                    payload.active ?? true,
                ],
            );
            return rows?.[0];
        });
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

    async toggleRuleWithinQuota(
        schemaName: string,
        ruleId: string,
        isActive: boolean | undefined,
        enforceActivationLimit: (activeCount: number) => Promise<void>,
    ) {
        return this.prisma.transactionInTenantSchema(schemaName, async (query) => {
            await query(`SELECT pg_advisory_xact_lock(hashtextextended('automation-rules', 0))::text AS lock_acquired`);
            const currentRows = await query<any[]>(
                `SELECT id, active FROM automation_rules WHERE id = $1::uuid FOR UPDATE`,
                [ruleId],
            );
            const current = currentRows?.[0];
            if (!current) return null;
            const nextActive = isActive ?? !current.active;
            if (nextActive && !current.active) {
                const countRows = await query<any[]>(
                    `SELECT COUNT(*)::int AS count FROM automation_rules WHERE active = true`,
                );
                await enforceActivationLimit(Number(countRows?.[0]?.count || 0));
            }
            const rows = await query<any[]>(
                `UPDATE automation_rules
                    SET active = $2, updated_at = CURRENT_TIMESTAMP
                  WHERE id = $1::uuid
                  RETURNING *`,
                [ruleId, nextActive],
            );
            return rows?.[0] || null;
        });
    }

    async updateRule(schemaName: string, ruleId: string, payload: any) {
        this.assertValidTriggerType(payload?.trigger_type);
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

    async updateRuleWithinQuota(
        schemaName: string,
        ruleId: string,
        payload: any,
        enforceActivationLimit: (activeCount: number) => Promise<void>,
    ) {
        this.assertValidTriggerType(payload?.trigger_type);
        return this.prisma.transactionInTenantSchema(schemaName, async (query) => {
            await query(`SELECT pg_advisory_xact_lock(hashtextextended('automation-rules', 0))::text AS lock_acquired`);
            const currentRows = await query<any[]>(
                `SELECT id, active FROM automation_rules WHERE id = $1::uuid FOR UPDATE`,
                [ruleId],
            );
            const current = currentRows?.[0];
            if (!current) return null;
            const nextActive = payload.active ?? current.active;
            if (nextActive && !current.active) {
                const countRows = await query<any[]>(
                    `SELECT COUNT(*)::int AS count FROM automation_rules WHERE active = true`,
                );
                await enforceActivationLimit(Number(countRows?.[0]?.count || 0));
            }
            const rows = await query<any[]>(
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
                    nextActive,
                ],
            );
            return rows?.[0] || null;
        });
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
