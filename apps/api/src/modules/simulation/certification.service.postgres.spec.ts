import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { listCanonicalSubtypeExperienceProfileIds } from '@parallext/shared';
import { CertificationService } from './certification.service';
import { isDisposableDatabase } from '../../common/__fixtures__/disposable-database';

/**
 * The path from the entrypoint to the ledger, walked end to end with no
 * provider.
 *
 * This is what the pre-deployment review said did not exist: the ledger could
 * store a run and nothing could start one. Every step here is the real service —
 * the same plan, the same queue publication, the same worker body, the same
 * report — with two things stubbed and named: the queue, so jobs can be
 * inspected instead of executed by a live worker, and the model, which is not
 * stubbed so much as never reached, because a `dry_run` contacts nobody.
 *
 * The assertion that matters most is the last one: a rehearsal writes real rows
 * and still certifies nothing. If it could, the cheapest way to certify the
 * catalogue would be to never run it.
 */

const connection = process.env.PARALLLY_ISOLATION_TEST_URL;
const profileId = listCanonicalSubtypeExperienceProfileIds()[0];
const SUPER_ADMIN = { id: '11111111-1111-4111-8111-111111111111', role: 'super_admin' };
const TENANT_ADMIN = { id: '22222222-2222-4222-8222-222222222222', role: 'tenant_admin' };

(connection ? describe : describe.skip)('certification service end to end', () => {
    let pool: Pool;
    const schema = `cert_svc_${randomUUID().replace(/-/g, '')}`;
    const tenantId = randomUUID();
    let service: CertificationService;
    let queued: Array<{ name: string; data: any; opts: any }>;
    let audits: any[];

    const transaction = async <T>(work: (query: any) => Promise<T>): Promise<T> => {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(`SET LOCAL search_path TO "${schema}"`);
            const value = await work(async (text: string, params: any[] = []) =>
                (await client.query(text, params)).rows);
            await client.query('COMMIT');
            return value;
        } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    };
    const sql = (text: string, params: any[] = []): Promise<any[]> =>
        transaction(query => query(text, params)) as Promise<any[]>;

    const planBody = (over: Record<string, unknown> = {}) => ({
        requestKey: `run-${randomUUID().replace(/-/g, '').slice(0, 20)}`,
        mode: 'dry_run' as const,
        profiles: [profileId], languages: ['es'], channels: ['whatsapp'], models: ['gpt-4.1-mini'],
        agentId: randomUUID(), configHash: 'config-1', dependencyRevision: 'dependency-1',
        ...over,
    });

    beforeAll(async () => {
        if (!isDisposableDatabase(connection)) throw new Error('disposable_database_required');
        pool = new Pool({ connectionString: connection, max: 6 });
        await transaction(query => query(`CREATE SCHEMA "${schema}"`));
        queued = [];
        audits = [];
        const prisma: any = {
            getTenantSchemaName: async (id: string) => (id === tenantId ? schema : null),
            transactionInTenantSchema: async (_schema: string, work: any) => transaction(work),
            auditLog: { create: async (row: any) => { audits.push(row.data); return row.data; } },
        };
        const queue: any = { add: async (name: string, data: any, opts: any) => { queued.push({ name, data, opts }); } };
        // Neither is reached in a dry run; they throw so that being reached is a
        // failure rather than a silent call.
        const evals: any = { runGateV2: async () => { throw new Error('model_must_not_be_called'); } };
        const agentTest: any = { captureSnapshot: async () => { throw new Error('model_must_not_be_called'); } };
        service = new CertificationService(prisma, evals, agentTest, queue);
    }, 60000);

    afterAll(async () => {
        if (pool) {
            await transaction(query => query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`));
            await pool.end();
        }
    });

    it('refuses to plan for anybody but a platform operator', async () => {
        await expect(service.plan(tenantId, planBody() as any, TENANT_ADMIN))
            .rejects.toMatchObject({ response: { error: 'certification_role_required' } });
    }, 120000);

    it('refuses a live run with no ceiling', async () => {
        await expect(service.plan(tenantId, planBody({ mode: 'live' }) as any, SUPER_ADMIN))
            .rejects.toMatchObject({ response: { error: 'certification_budget_required' } });
    }, 120000);

    it('refuses several profiles under one agent, from the request rather than from the ledger', async () => {
        const [first, second] = listCanonicalSubtypeExperienceProfileIds().slice(0, 2);
        await expect(service.plan(tenantId, planBody({ profiles: [first, second] }) as any, SUPER_ADMIN))
            .rejects.toMatchObject({ response: { error: 'certification_subject_required' } });
    }, 120000);

    it('plans once for one request key, however many times it is asked', async () => {
        const body = planBody();
        const first = await service.plan(tenantId, body as any, SUPER_ADMIN);
        const again = await service.plan(tenantId, body as any, SUPER_ADMIN);
        expect(again.runId).toBe(first.runId);
        const [rows] = await sql('SELECT count(*)::int AS n FROM agent_certification_runs WHERE request_key=$1',
            [body.requestKey]);
        expect(Number(rows.n)).toBe(1);
        expect(audits.some(row => row.action === 'certification.planned')).toBe(true);
    }, 180000);

    it('publishes recoverable jobs, and publishing twice does not double the fleet', async () => {
        const run = await service.plan(tenantId, planBody() as any, SUPER_ADMIN);
        queued.length = 0;
        await service.start(tenantId, run.runId, SUPER_ADMIN, 2, 5);
        await service.start(tenantId, run.runId, SUPER_ADMIN, 2, 5);
        // Stable ids: a start that failed half way through republishes the same
        // ids and the queue keeps one of each.
        expect(new Set(queued.map(job => job.opts.jobId)).size).toBe(2);
        expect(queued.every(job => job.opts.attempts === 3)).toBe(true);
    }, 180000);

    it('runs the whole batch through the real worker body without contacting a model', async () => {
        const run = await service.plan(tenantId, planBody() as any, SUPER_ADMIN);
        queued.length = 0;
        await service.start(tenantId, run.runId, SUPER_ADMIN, 1, 500);
        expect(queued).toHaveLength(1);
        const outcome = await service.process(queued[0].data);
        expect(outcome.processed).toBe(run.planned);
        expect(outcome.stopReason).toBe('complete');
        const progress = await service.read(tenantId, run.runId, SUPER_ADMIN);
        expect(progress).toMatchObject({ state: 'finished', passed: run.planned, spentUsdCents: 0 });
    }, 240000);

    it('writes real rows and certifies nothing, because a rehearsal proves nothing about a model', async () => {
        const run = await service.plan(tenantId, planBody() as any, SUPER_ADMIN);
        await service.start(tenantId, run.runId, SUPER_ADMIN, 1, 500);
        await service.process(queued[queued.length - 1].data);
        const [stored] = await sql(
            "SELECT count(*)::int AS n FROM agent_certification_cases WHERE run_id=$1::uuid AND state='passed'",
            [run.runId]);
        expect(Number(stored.n)).toBe(run.planned);

        const report = await service.report(tenantId, run.runId, SUPER_ADMIN);
        expect(report.dryRun).toBe(true);
        expect(report.report.evidenceKind).toBe('executed_runs');
        expect(report.report.summary.certified).toBe(0);
        expect(report.report.summary.verifiedCases).toBe(0);
    }, 240000);

    it('pauses without losing the run, and resumes it', async () => {
        const run = await service.plan(tenantId, planBody() as any, SUPER_ADMIN);
        await service.start(tenantId, run.runId, SUPER_ADMIN, 1, 2);
        await service.process(queued[queued.length - 1].data);
        await service.pause(tenantId, run.runId, SUPER_ADMIN);
        expect((await service.read(tenantId, run.runId, SUPER_ADMIN)).state).toBe('paused');
        // A worker that arrives while paused is told so and takes nothing.
        const idle = await service.process({ tenantId, runId: run.runId, cases: 5 });
        expect(idle).toEqual({ processed: 0, stopReason: 'paused' });
        await service.resume(tenantId, run.runId, SUPER_ADMIN);
        expect((await service.read(tenantId, run.runId, SUPER_ADMIN)).state).toBe('running');
    }, 240000);

    it('cancels, and a worker that arrives afterwards takes nothing', async () => {
        const run = await service.plan(tenantId, planBody() as any, SUPER_ADMIN);
        await service.cancel(tenantId, run.runId, SUPER_ADMIN);
        expect(await service.process({ tenantId, runId: run.runId, cases: 5 }))
            .toEqual({ processed: 0, stopReason: 'cancelled' });
        await expect(service.start(tenantId, run.runId, SUPER_ADMIN))
            .rejects.toMatchObject({ response: { error: 'certification_run_closed' } });
        expect(audits.filter(row => row.action === 'certification.cancelled').length).toBeGreaterThan(0);
    }, 180000);

    it('lets the tenant admin read what was run against their own tenant', async () => {
        const run = await service.plan(tenantId, planBody() as any, SUPER_ADMIN);
        await expect(service.read(tenantId, run.runId, TENANT_ADMIN)).resolves.toMatchObject({ runId: run.runId });
        await expect(service.cancel(tenantId, run.runId, TENANT_ADMIN))
            .rejects.toMatchObject({ response: { error: 'certification_role_required' } });
    }, 180000);
});
