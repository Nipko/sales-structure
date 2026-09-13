import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { withAgentSourceFence } from '../../common/utils/agent-source-fence';
import { AgentConfigurationRevisionStore, operationalConfigurationBody, type RevisionQuery } from '../persona/agent-configuration-revision';
import { evaluationSnapshot, sealEvaluationSnapshot } from '../conversations/agent-evaluation-snapshot';
import { evaluationKnowledgeFixture } from '../conversations/__fixtures__/evaluation-knowledge.fixture';
import { revisionHash, sealRevision } from '../evaluation-revision/evaluation-revision';
import { sealStructuredKnowledgeCapture } from '../evaluation-revision/evaluation-structured-knowledge';
import { RegionalProfileService } from '../tenants/regional-profile.service';
import { AgentReleaseStore } from './agent-release-store';
import { AgentReleaseService } from './agent-release.service';

// These tests exercise release authority/locking, not billing or model quality.
// Snapshot seals are real; the RAG descriptor is synthetic and never retrieved.
jest.mock('../../common/utils/subscription-entitlement.util', () => ({
    resolveTenantSubscriptionAccess: async () => ({ allowed: true }),
}));

const url = process.env.AGENT_RELEASE_TEST_DATABASE_URL;
(url ? describe : describe.skip)('Release callbacks inside a source fence on real Prisma/PostgreSQL', () => {
    const schema = `tenant_releasefence_${randomUUID().replace(/-/g, '')}`;
    const tenantId = randomUUID(), agentId = randomUUID(), actor = { id: randomUUID(), role: 'tenant_admin' };
    const privacyKey = `agent-privacy:${schema}`;
    let client: PrismaClient, prisma: PrismaService, store: AgentReleaseStore;
    let collect = false;
    const observedSql: string[] = [];
    const query = (sql: string, params: any[] = []) => prisma.executeInTenantSchema<any[]>(schema, sql, params);
    const transaction = <T>(work: (q: RevisionQuery) => Promise<T>) => prisma.transactionInTenantSchema(schema, work);
    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    async function until(check: () => Promise<boolean>): Promise<void> {
        const deadline = Date.now() + 2500;
        while (Date.now() < deadline) {
            if (await check()) return;
            await sleep(10);
        }
        throw new Error('expected_database_lock_not_observed');
    }

    async function prepareJob() {
        const operational = (await query('SELECT * FROM agent_personas WHERE id=$1::uuid', [agentId]))[0];
        const base = structuredClone(operationalConfigurationBody(operational));
        const body = operationalConfigurationBody(operational);
        body.configJson.behavior.rules = ['Synthetic candidate rule'];
        const draft = await transaction(q => new AgentConfigurationRevisionStore(prisma).saveWithQuery(q, {
            tenantId, agentId, actor, requestKey: randomUUID(), expectedOperationalVersion: 7,
            expectedDraftRevision: null, body,
        }));
        const snapshot = evaluationSnapshot(tenantId, agentId, { version: 7, config_json: body.configJson });
        snapshot.configurationRevisionId = draft.id;
        snapshot.configurationRevisionHash = draft.body_hash;
        snapshot.configurationBody = structuredClone(body);
        snapshot.configurationBaseOperationalHash = draft.base_operational_hash;
        snapshot.configurationBaseOperationalBody = base;
        snapshot.releaseScope = { profileId: 'education/capacitacion', intentKeys: ['ask_question'], missionConfigured: true,
            channels: ['web_widget'], languages: ['es', 'en', 'pt', 'fr'] };
        snapshot.mcpTools = []; snapshot.mcpToolsHash = revisionHash([]);
        snapshot.procedures = []; snapshot.proceduresHash = revisionHash([]);
        snapshot.runtimeInputs = { providerHealth: {}, planFeatures: {}, llmSpendUsdCents: 0, mcpDiscoveredCount: 0, mcpApprovedCount: 0 };
        snapshot.runtimeInputsHash = revisionHash(snapshot.runtimeInputs);
        snapshot.contextInputs = { version: 1, tenantId, businessHours: null, business: null, activeObjectPolicy: {},
            regional: new RegionalProfileService({} as any, {} as any).compose(tenantId, {}),
            vertical: { es: null, en: null, pt: null, fr: null } };
        snapshot.structuredKnowledgeInputs = sealStructuredKnowledgeCapture({ version: 1, tenantId, sourceSchema: schema,
            capturedAt: snapshot.capturedAt, faqs: { state: 'present', rows: [] }, policies: { state: 'present', rows: [] } });
        snapshot.knowledgeInputs = evaluationKnowledgeFixture(tenantId, agentId, schema);
        snapshot.manifest = sealRevision(tenantId, [{ key: 'fixture.release_locking', state: 'present', hash: revisionHash('synthetic') }], []);
        sealEvaluationSnapshot(snapshot);
        const candidate = await transaction(q => store.create(q, schema, { tenantId, agentId, actor, requestKey: randomUUID(), snapshot,
            scenarios: [{ key: 'synthetic', title: 'Synthetic authority test', messages: ['Hello'], language: 'en', expectedActions: [] }] }));
        const data = (await transaction(q => store.read(q, agentId, candidate.id)))!;
        return { tenantId, agentId, candidateId: candidate.id, evaluationId: data.evaluations[0].id };
    }

    function harness(work: (options: any) => Promise<any>) {
        const provider = jest.fn(async () => ({ content: 'Synthetic provider result' }));
        const budget = { consumeBudget: jest.fn(async () => undefined) };
        const tests = { assertSnapshotExecutable: jest.fn(async () => undefined), releaseSnapshot: jest.fn(async () => undefined) };
        const evals = { runGateV2: jest.fn(async (_tenant: string, _agent: string, options: any) => work(options)) };
        const service = new AgentReleaseService(prisma, tests as any, evals as any, budget as any, {} as any);
        return { service, provider, budget, tests, evals };
    }

    function expectReadonlyCallbacks() {
        expect(observedSql.some(sql => sql.includes('agent_release_evaluations'))).toBe(true);
        expect(observedSql.filter(sql => /pg_advisory|\b(?:UPDATE|INSERT|DELETE|ALTER|CREATE)\b|FOR\s+(?:UPDATE|SHARE)/i.test(sql))).toEqual([]);
    }

    beforeAll(async () => {
        const parsed = new URL(url!);
        if (!['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) || !parsed.pathname.endsWith('_eval_isolation'))
            throw new Error('disposable_loopback_database_required');
        client = new PrismaClient({ datasourceUrl: url });
        await client.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS public.tenants(id UUID PRIMARY KEY,schema_name TEXT)');
        await client.$executeRawUnsafe('INSERT INTO public.tenants(id,schema_name) VALUES($1::uuid,$2)', tenantId, schema);
        await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
        prisma = Object.create(PrismaService.prototype);
        prisma.$transaction = client.$transaction.bind(client);
        prisma.$queryRawUnsafe = client.$queryRawUnsafe.bind(client);
        prisma.getTenantSchemaName = async () => schema;
        const original = PrismaService.prototype.transactionInTenantSchema.bind(prisma);
        // Observe executed SQL without replacing results, ownership, transactions or locks.
        prisma.transactionInTenantSchema = (name, callback, options) => original(name, q => callback(async (sql, params) => {
            if (collect) observedSql.push(sql);
            return q(sql, params);
        }), options);
        await query(`CREATE TABLE agent_personas(id UUID PRIMARY KEY,name TEXT,config_json JSONB,channels TEXT[],channel_bindings TEXT[],
            schedule_mode TEXT,is_active BOOLEAN,is_default BOOLEAN,version INTEGER,updated_at TIMESTAMPTZ DEFAULT NOW())`);
        const ddl = readFileSync(resolve(__dirname, '../../../prisma/tenant-schema.sql'), 'utf8');
        for (const marker of ['AGENT CONFIGURATION REVISIONS', 'AGENT RELEASE CANDIDATES']) {
            const start = ddl.indexOf(`-- BEGIN ${marker}`), end = ddl.indexOf(`-- END ${marker}`, start);
            if (start < 0 || end < 0) throw new Error('release_ddl_missing');
            for (const statement of ddl.slice(start, end).replaceAll('{{SCHEMA_NAME}}', schema).split(';').filter(row => row.trim()))
                await client.$executeRawUnsafe(statement);
        }
        store = new AgentReleaseStore(prisma);
    }, 30_000);

    beforeEach(async () => {
        collect = false; observedSql.length = 0;
        await query('TRUNCATE agent_release_candidates,agent_configuration_commands,agent_configuration_drafts,agent_configuration_revisions,agent_personas CASCADE');
        await query(`INSERT INTO agent_personas VALUES($1::uuid,'Alex',$2::jsonb,ARRAY['web_widget'],ARRAY['web_widget:owned'],
            '24_7',true,true,7,NOW())`, [agentId, JSON.stringify({ persona: { name: 'Alex' }, behavior: { rules: ['Serving rule'] } })]);
    });

    afterAll(async () => {
        if (client) try {
            if (!/^tenant_releasefence_[a-f0-9]{32}$/.test(schema)) throw new Error('invalid_cleanup_scope');
            await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
            await client.$executeRawUnsafe('DELETE FROM public.tenants WHERE id=$1::uuid AND schema_name=$2', tenantId, schema);
        } finally { await client.$disconnect(); }
    });

    it('runs both real release callbacks behind a queued erasure without another shared lock, write or renewal', async () => {
        const job = await prepareJob();
        let erasure: Promise<unknown> | undefined, erasureFinished = false, reached = false;
        let erasurePid: number | undefined;
        let before: any, after: any, erasureStillWaiting = false;
        const h = harness(async options => {
            // The ordinary outer checkpoint still renews authority before the turn.
            await options.assertExecutionAuthority();
            await withAgentSourceFence(prisma, schema, async q => {
                before = await q<any[]>('SELECT * FROM agent_release_evaluations WHERE id=$1::uuid', [job.evaluationId]);
                const [{ pid: sourcePid }] = await q<any[]>('SELECT pg_backend_pid() AS pid');
                erasure = client.$transaction(async tx => {
                    await tx.$executeRawUnsafe("SET LOCAL lock_timeout='4s'");
                    erasurePid = (await tx.$queryRawUnsafe('SELECT pg_backend_pid() AS pid') as any[])[0].pid;
                    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text', privacyKey);
                    erasureFinished = true;
                }, { timeout: 7000 });
                // Handle rejection immediately while assertions still await the source callback.
                void erasure.catch(() => undefined);
                await until(async () => erasurePid != null && (await client.$queryRawUnsafe(
                    'SELECT pg_blocking_pids($1::int) AS blockers', erasurePid) as any[])[0].blockers.includes(sourcePid));
                collect = true;
                try {
                    await options.assertExecutionAuthority();
                    await options.beforeModelUnits(1);
                    await h.provider();
                    reached = true;
                } finally { collect = false; }
                erasureStillWaiting = !erasureFinished;
                after = await q('SELECT * FROM agent_release_evaluations WHERE id=$1::uuid', [job.evaluationId]);
            });
            await erasure;
            throw new Error('synthetic_stop_after_authority_probe');
        });
        try {
            await h.service.process(job);
            expect(reached).toBe(true);
            expect(erasureFinished).toBe(true);
            expect(erasureStillWaiting).toBe(true);
            expect(after).toEqual(before);
            expect(h.provider).toHaveBeenCalledTimes(1);
            expect(h.budget.consumeBudget).toHaveBeenCalledWith(tenantId, 1);
            expectReadonlyCallbacks();
        } finally { collect = false; await erasure?.catch(() => undefined); }
    }, 15_000);

    it('uses wall-clock expiry inside a long transaction and does not call the provider or reserve budget after expiration', async () => {
        const job = await prepareJob();
        let caught: any, clockEvidence: any;
        const h = harness(async options => withAgentSourceFence(prisma, schema, async q => {
            await client.$executeRawUnsafe(`UPDATE "${schema}".agent_release_evaluations SET lease_until=clock_timestamp()+INTERVAL '100 milliseconds'
                WHERE id=$1::uuid`, job.evaluationId);
            await sleep(160);
            clockEvidence = (await q<any[]>(`SELECT lease_until>NOW() AS transaction_valid,lease_until>clock_timestamp() AS actual_valid
                FROM agent_release_evaluations WHERE id=$1::uuid`, [job.evaluationId]))[0];
            collect = true;
            try { await options.beforeModelUnits(1); await h.provider(); }
            catch (error) { caught = error; throw error; }
            finally { collect = false; }
        }));
        const outcome = await h.service.process(job);
        expect(clockEvidence).toEqual({ transaction_valid: true, actual_valid: false });
        expect(caught).toMatchObject({ response: { error: 'agent_release_lease_lost' } });
        expect(outcome).toMatchObject({ skipped: true, reason: 'agent_release_lease_lost' });
        expect(h.provider).not.toHaveBeenCalled();
        expect(h.budget.consumeBudget).not.toHaveBeenCalled();
        expectReadonlyCallbacks();
    });

    it.each(['token_replaced', 'candidate_revoked'])('rejects %s committed after the source transaction began, before any provider', async change => {
        const job = await prepareJob();
        let caught: any;
        const h = harness(async options => withAgentSourceFence(prisma, schema, async () => {
            if (change === 'token_replaced') await client.$executeRawUnsafe(
                `UPDATE "${schema}".agent_release_evaluations SET lease_token=$2::uuid WHERE id=$1::uuid`, job.evaluationId, randomUUID());
            else await client.$executeRawUnsafe(`UPDATE "${schema}".agent_release_candidates SET status='rejected' WHERE id=$1::uuid`, job.candidateId);
            collect = true;
            try { await options.assertExecutionAuthority(); await options.beforeModelUnits(1); await h.provider(); }
            catch (error) { caught = error; throw error; }
            finally { collect = false; }
        }));
        await h.service.process(job);
        expect(caught).toMatchObject({ response: { error: change === 'token_replaced' ? 'agent_release_lease_lost' : 'agent_release_invalidated' } });
        expect(h.provider).not.toHaveBeenCalled();
        expect(h.budget.consumeBudget).not.toHaveBeenCalled();
        expect(observedSql.filter(sql => /pg_advisory|\bUPDATE\b|FOR\s+(?:UPDATE|SHARE)/i.test(sql))).toEqual([]);
    });
});
