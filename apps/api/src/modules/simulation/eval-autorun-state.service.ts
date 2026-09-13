import { Injectable, Optional, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AgentTestService } from '../conversations/agent-test.service';
import type { AgentEvaluationSnapshot } from '../conversations/agent-evaluation-snapshot';
import { hasAgentSourceFence } from '../../common/utils/agent-source-fence';
import { assertReviewedRegressionScenarios, regressionCaseIds } from '../quality/regressions/quality-regression-runtime';

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
            await this.prisma.executeInTenantSchema(schema,"ALTER TABLE eval_autorun_requests ADD COLUMN IF NOT EXISTS regression_case_ids UUID[] NOT NULL DEFAULT '{}'::uuid[]");
            this.ensured.add(schema);
        }
        return schema;
    }

    /** Initialize evaluation bookkeeping before taking a dependency snapshot. */
    async prepare(tenantId:string):Promise<void>{await this.schema(tenantId);}

    async request(tenantId: string, agentId: string): Promise<string> {
        const schema = await this.schema(tenantId);
        const rows = await this.prisma.executeInTenantSchema<any[]>(schema,
            'SELECT config_json, version FROM agent_personas WHERE id = $1::uuid', [agentId]);
        if (!rows?.[0]) throw new Error('agent_not_found');
        if (!this.agentTest) throw new Error('evaluation_revision_service_unavailable');
        const snapshot = await this.agentTest.captureSnapshot(tenantId, agentId);
        const revision = randomUUID();
        // A lost UPSERT acknowledgement can still leave this exact snapshot in
        // use. Superseded references and uncertain requests retain their fixed
        // durable TTL; never release either from an unverified write outcome.
        await this.prisma.executeInTenantSchema(schema, `INSERT INTO eval_autorun_requests (agent_id, revision, agent_snapshot, next_attempt_at)
            VALUES ($1::uuid, $2::uuid, $3::jsonb, NOW() + INTERVAL '30 seconds')
            ON CONFLICT (agent_id) DO UPDATE SET revision = EXCLUDED.revision, agent_snapshot = EXCLUDED.agent_snapshot,
            status = 'pending', scenarios = NULL, results = '[]'::jsonb, regression_case_ids='{}'::uuid[], error = NULL, requested_at = NOW(),
            next_attempt_at = EXCLUDED.next_attempt_at, updated_at = NOW()`, [agentId, revision, JSON.stringify(snapshot)]);
        return revision;
    }

    async get(tenantId: string, agentId: string, revision: string): Promise<any | null> {
        const schema = await this.schema(tenantId);
        const rows = await this.prisma.executeInTenantSchema<any[]>(schema,
            'SELECT * FROM eval_autorun_requests WHERE agent_id = $1::uuid AND revision = $2::uuid', [agentId, revision]);
        return rows?.[0] || null;
    }

    async assertExecutable(tenantId: string, agentId: string, snapshot: AgentEvaluationSnapshot): Promise<void> {
        if (!this.agentTest) throw new Error('evaluation_revision_service_unavailable');
        await this.agentTest.assertSnapshotExecutable(snapshot, tenantId, agentId);
    }

    async update(tenantId: string, agentId: string, revision: string, status: string, error?: string, scenarios?: any[], results?: any[]): Promise<void> {
        const schema = await this.schema(tenantId);
        const terminalSnapshot = await this.prisma.transactionInTenantSchema(schema,async query=>{
        await query(`SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))::text`,[`agent-privacy:${schema}`]);
        const rows=await query<any[]>(`SELECT scenarios,results,agent_snapshot,status FROM eval_autorun_requests WHERE agent_id=$1::uuid AND revision=$2::uuid FOR UPDATE`,[agentId,revision]);
        if(!rows[0])return;
        // Completion is also terminal: a lost COMMIT ACK or delayed worker must
        // not turn completed evidence into a recoverable failed/running request.
        if(['completed','invalidated'].includes(rows[0].status))return rows[0].agent_snapshot;
        const invalidate=async(reason:string)=>{
            await query(`UPDATE eval_autorun_requests SET status='invalidated',error=$3,
                agent_snapshot='{}'::jsonb,scenarios=NULL,results='[]'::jsonb,regression_case_ids='{}'::uuid[],updated_at=NOW()
                WHERE agent_id=$1::uuid AND revision=$2::uuid`,[agentId,revision,reason.slice(0,1000)]);
            return rows[0].agent_snapshot;
        };
        if(status==='invalidated')return invalidate(error||'evaluation_source_unavailable');
        const definitions=scenarios||rows[0].scenarios||[];
        let ids:string[]=[];
        try{
            ids=regressionCaseIds(definitions);
            if(regressionCaseIds(results||rows[0].results||[]).some(id=>!ids.includes(id)))throw new ConflictException({error:'regression_provenance_required'});
            await assertReviewedRegressionScenarios(query,definitions,agentId);
        }catch(error){
            if(!(error instanceof ConflictException||error instanceof ForbiddenException||error instanceof NotFoundException))throw error;
            return invalidate('regression_source_unavailable');
        }
        await query(`UPDATE eval_autorun_requests SET status = $3, error = $4,
            scenarios = COALESCE($5::jsonb, scenarios), results = COALESCE($6::jsonb, results), updated_at = NOW(),
            regression_case_ids=$7::uuid[],
            next_attempt_at = CASE WHEN $3 = 'budget_deferred' THEN (CURRENT_DATE + INTERVAL '1 day')
                WHEN $3 = 'failed' THEN NOW() + INTERVAL '5 minutes' ELSE next_attempt_at END
            WHERE agent_id = $1::uuid AND revision = $2::uuid`,
            [agentId, revision, status, error?.slice(0, 1000) || null, scenarios ? JSON.stringify(scenarios) : null, results ? JSON.stringify(results) : null,ids]);
        return status==='completed'?rows[0].agent_snapshot:undefined;
        });
        // Cleanup never holds the request row or the privacy transaction. A
        // nested source user defers release to its outer owner/durable expiry.
        // An uncertain transaction outcome throws above and retains the TTL.
        if(terminalSnapshot?.knowledgeInputs && !hasAgentSourceFence(this.prisma,schema)) {
            try { await this.agentTest?.releaseSnapshot(terminalSnapshot); }
            catch { /* Durable expiry remains the fallback; terminal state is committed. */ }
        }
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
