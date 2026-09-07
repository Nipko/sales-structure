import { Injectable, Optional } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AgentTestService } from '../conversations/agent-test.service';

/** PostgreSQL is the request authority; BullMQ is a recoverable delivery mechanism. */
@Injectable()
export class EvalAutorunStateService {
    private readonly ensured = new Set<string>();
    constructor(private readonly prisma: PrismaService, @Optional() private readonly agentTest?: AgentTestService) {}

    private async schema(tenantId: string): Promise<string> {
        const schema = await this.prisma.getTenantSchemaName(tenantId);
        if (!this.ensured.has(schema)) {
            await this.prisma.executeInTenantSchema(schema, `CREATE TABLE IF NOT EXISTS eval_autorun_requests (
                agent_id UUID PRIMARY KEY, revision UUID NOT NULL, agent_snapshot JSONB NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending', error TEXT, scenarios JSONB, results JSONB NOT NULL DEFAULT '[]'::jsonb,
                requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
            await this.prisma.executeInTenantSchema(schema, `CREATE TABLE IF NOT EXISTS eval_autorun_budget (
                budget_day DATE PRIMARY KEY, units_used INTEGER NOT NULL DEFAULT 0)`);
            this.ensured.add(schema);
        }
        return schema;
    }

    async request(tenantId: string, agentId: string): Promise<string> {
        const schema = await this.schema(tenantId);
        const rows = await this.prisma.executeInTenantSchema<any[]>(schema,
            'SELECT config_json, version FROM agent_personas WHERE id = $1::uuid', [agentId]);
        if (!rows?.[0]) throw new Error('agent_not_found');
        if (!this.agentTest) throw new Error('evaluation_revision_service_unavailable');
        const snapshot = await this.agentTest.captureSnapshot(tenantId, agentId);
        const revision = randomUUID();
        await this.prisma.executeInTenantSchema(schema, `INSERT INTO eval_autorun_requests (agent_id, revision, agent_snapshot, next_attempt_at)
            VALUES ($1::uuid, $2::uuid, $3::jsonb, NOW() + INTERVAL '30 seconds')
            ON CONFLICT (agent_id) DO UPDATE SET revision = EXCLUDED.revision, agent_snapshot = EXCLUDED.agent_snapshot,
            status = 'pending', scenarios = NULL, results = '[]'::jsonb, error = NULL, requested_at = NOW(),
            next_attempt_at = EXCLUDED.next_attempt_at, updated_at = NOW()`, [agentId, revision, JSON.stringify(snapshot)]);
        return revision;
    }

    async get(tenantId: string, agentId: string, revision: string): Promise<any | null> {
        const schema = await this.schema(tenantId);
        const rows = await this.prisma.executeInTenantSchema<any[]>(schema,
            'SELECT * FROM eval_autorun_requests WHERE agent_id = $1::uuid AND revision = $2::uuid', [agentId, revision]);
        return rows?.[0] || null;
    }

    async update(tenantId: string, agentId: string, revision: string, status: string, error?: string, scenarios?: any[], results?: any[]): Promise<void> {
        const schema = await this.schema(tenantId);
        await this.prisma.executeInTenantSchema(schema, `UPDATE eval_autorun_requests SET status = $3, error = $4,
            scenarios = COALESCE($5::jsonb, scenarios), results = COALESCE($6::jsonb, results), updated_at = NOW(),
            next_attempt_at = CASE WHEN $3 = 'budget_deferred' THEN (CURRENT_DATE + INTERVAL '1 day')
                WHEN $3 = 'failed' THEN NOW() + INTERVAL '5 minutes' ELSE next_attempt_at END
            WHERE agent_id = $1::uuid AND revision = $2::uuid`,
            [agentId, revision, status, error?.slice(0, 1000) || null, scenarios ? JSON.stringify(scenarios) : null, results ? JSON.stringify(results) : null]);
    }

    async consumeBudget(tenantId: string, units: number): Promise<void> {
        const schema = await this.schema(tenantId);
        const configured = Number(process.env.EVAL_AUTORUN_DAILY_MODEL_UNITS);
        const maximum = Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : 5000;
        const rows = await this.prisma.executeInTenantSchema<any[]>(schema, `INSERT INTO eval_autorun_budget (budget_day, units_used)
            SELECT CURRENT_DATE, $1 WHERE $1 <= $2
            ON CONFLICT (budget_day) DO UPDATE SET units_used = eval_autorun_budget.units_used + EXCLUDED.units_used
            WHERE eval_autorun_budget.units_used + EXCLUDED.units_used <= $2 RETURNING units_used`, [units, maximum]);
        if (!rows?.length) throw new Error('eval_autorun_budget_exhausted');
    }

    async recoverable(): Promise<Array<{ tenantId: string; agentId: string; revision: string }>> {
        const tenants = await this.prisma.tenant.findMany({ where: { isActive: true }, select: { id: true } });
        const out: Array<{ tenantId: string; agentId: string; revision: string }> = [];
        for (const tenant of tenants) {
            const schema = await this.schema(tenant.id);
            const rows = await this.prisma.executeInTenantSchema<any[]>(schema, `SELECT agent_id, revision FROM eval_autorun_requests
                WHERE (status IN ('pending', 'failed', 'budget_deferred') AND next_attempt_at <= NOW())
                   OR (status = 'running' AND updated_at < NOW() - INTERVAL '15 minutes') LIMIT 50`);
            for (const row of rows || []) out.push({ tenantId: tenant.id, agentId: row.agent_id, revision: row.revision });
        }
        return out;
    }
}
