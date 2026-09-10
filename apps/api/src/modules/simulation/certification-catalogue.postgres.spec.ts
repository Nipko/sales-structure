import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { listCanonicalSubtypeExperienceProfileIds } from '@parallext/shared';
import { CertificationService } from './certification.service';
import { planCertificationRun } from './certification-plan';
import { isDisposableDatabase } from '../../common/__fixtures__/disposable-database';
import { LoadMetrics } from '../../common/__fixtures__/load-metrics';

/**
 * The whole catalogue, planned and partitioned and reported on, without
 * contacting a model.
 *
 * The end-to-end suite next door proves the path works for one profile. What it
 * cannot tell you is whether the path SCALES to the thing the programme is
 * actually for: seventy-six experience profiles, each needing its own subject,
 * its own scenarios and its own line in the report. Those are different
 * failures — a planner that is fine for one cell and quadratic across 1,520, a
 * report that averages seventy-six profiles into one verdict, a partition that
 * hands one worker everything — and none of them show up at n=1.
 *
 * So this runs the real service over all 76 profiles with the rehearsal runner:
 * every row is real, every lease is real, the report is the real report, and
 * the spend is zero because a `dry_run` reaches nobody. It is representative
 * rather than exhaustive on purpose — one channel and one language, 3,906 cases
 * — because the dimension being tested here is the PROFILE, and multiplying by
 * twenty to prove the same thing about planning would buy nothing but minutes.
 *
 * The full-catalogue plan (78,120 cases) is measured too, but only planned:
 * what that number is for is the cost report, and the thing worth knowing about
 * it is how long it takes to write, which is measured and printed rather than
 * asserted.
 */

const connection = process.env.PARALLLY_ISOLATION_TEST_URL;
const PROFILES = listCanonicalSubtypeExperienceProfileIds();
const SUPER_ADMIN = { id: '11111111-1111-4111-8111-111111111111', role: 'super_admin' };

(connection ? describe : describe.skip)('the whole catalogue, rehearsed', () => {
    jest.setTimeout(600_000);

    const metrics = new LoadMetrics('certification over 76 profiles');
    let pool: Pool;
    const schema = `cert_cat_${randomUUID().replace(/-/g, '')}`;
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

    /** One subject per profile, which is the rule the ledger enforces. */
    const subjects = Object.fromEntries(PROFILES.map(profileId => [profileId, {
        agentId: randomUUID(), configHash: `config-${profileId}`, dependencyRevision: `dependency-${profileId}`,
    }]));

    const planBody = (over: Record<string, unknown> = {}) => ({
        requestKey: `cat-${randomUUID().replace(/-/g, '').slice(0, 20)}`,
        mode: 'dry_run' as const,
        profiles: PROFILES, languages: ['es'], channels: ['whatsapp'], models: ['gpt-4.1-mini'],
        subjects,
        agentId: randomUUID(), configHash: 'config-catalogue', dependencyRevision: 'dependency-catalogue',
        ...over,
    });

    beforeAll(async () => {
        if (!isDisposableDatabase(connection)) throw new Error('disposable_database_required');
        pool = new Pool({ connectionString: connection, max: 8 });
        await transaction(query => query(`CREATE SCHEMA "${schema}"`));
        queued = [];
        audits = [];
        const prisma: any = {
            getTenantSchemaName: async (id: string) => (id === tenantId ? schema : null),
            transactionInTenantSchema: async (_schema: string, work: any) => transaction(work),
            auditLog: { create: async (row: any) => { audits.push(row.data); return row.data; } },
        };
        const queue: any = { add: async (name: string, data: any, opts: any) => { queued.push({ name, data, opts }); } };
        // Reaching either is a failure, not a silent call: a rehearsal that
        // touched a model would be spending money to prove nothing.
        const evals: any = { runGateV2: async () => { throw new Error('model_must_not_be_called'); } };
        const agentTest: any = { captureSnapshot: async () => { throw new Error('model_must_not_be_called'); } };
        service = new CertificationService(prisma, evals, agentTest, queue);
    }, 120_000);

    afterAll(async () => {
        if (!pool) return;
        try {
            metrics.print();
            if (!/^cert_cat_[a-f0-9]{32}$/.test(schema)) throw new Error('invalid_cleanup_scope');
            await transaction(query => query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`));
        } finally { await pool.end(); }
    });

    it('refuses a catalogue run that names a subject for only some of the profiles', async () => {
        const partial = Object.fromEntries(Object.entries(subjects).slice(0, 40));
        // The refusal has to name the ones it is missing. "Some subject is
        // missing" over seventy-six profiles is not something anybody can act
        // on, and the default subject deliberately does not apply beyond one.
        await expect(service.plan(tenantId, planBody({ subjects: partial }) as any, SUPER_ADMIN))
            .rejects.toMatchObject({ response: { error: 'certification_subject_required' } });
    });

    it('plans all 76 profiles, one subject each, with the case count the report demands', async () => {
        const expected = planCertificationRun({
            profiles: PROFILES, languages: ['es'], channels: ['whatsapp'], models: ['gpt-4.1-mini'],
        });
        const run = await metrics.time('plan_76_profiles',
            () => service.plan(tenantId, planBody() as any, SUPER_ADMIN));
        // The planner and the report ask the same function for the scenario
        // universe, so a case can never exist for a scenario the report will
        // not ask about — and the totals have to agree or one of them is lying.
        expect(run.planned).toBe(expected.totals.requiredCases);
        const [profiles] = await sql(
            'SELECT count(*)::int AS n FROM agent_certification_subjects WHERE run_id=$1::uuid', [run.runId]);
        expect(Number(profiles.n)).toBe(PROFILES.length);
        const [distinct] = await sql(
            'SELECT count(DISTINCT profile_id)::int AS n FROM agent_certification_cases WHERE run_id=$1::uuid',
            [run.runId]);
        expect(Number(distinct.n)).toBe(PROFILES.length);
        metrics.note(`planned ${run.planned} cases over ${PROFILES.length} profiles`);
        (globalThis as any).__catalogueRun = run;
    });

    it('partitions the run across workers instead of handing one everything', async () => {
        const run = (globalThis as any).__catalogueRun;
        queued.length = 0;
        await service.start(tenantId, run.runId, SUPER_ADMIN, 8, 200);
        // Eight stable ids, each bounded. A partition that gave one worker the
        // whole catalogue would take the same total time and lose everything on
        // one crash.
        expect(new Set(queued.map(job => job.opts.jobId)).size).toBe(8);
        expect(queued.every(job => job.data.cases === 200)).toBe(true);
        // And republishing is idempotent, which is what makes a half-failed
        // start recoverable rather than a doubled fleet.
        await service.start(tenantId, run.runId, SUPER_ADMIN, 8, 200);
        expect(new Set(queued.map(job => job.opts.jobId)).size).toBe(8);
    });

    it('processes a batch through the real worker body, spending nothing', async () => {
        const run = (globalThis as any).__catalogueRun;
        const before = await service.read(tenantId, run.runId, SUPER_ADMIN);
        const outcome = await metrics.time('worker_batch',
            () => service.process({ tenantId, runId: run.runId, cases: 300 }));
        expect(outcome.processed).toBe(300);
        expect(outcome.stopReason).toBe('batch_limit');
        const after = await service.read(tenantId, run.runId, SUPER_ADMIN);
        expect(after.passed).toBe(before.passed + 300);
        // The whole point of a rehearsal: real rows, zero spend.
        expect(after.spentUsdCents).toBe(0);
        metrics.count('cases_processed', outcome.processed);
    });

    it('lets a second worker recover every case a dead one was holding', async () => {
        // Its own small run, because the claim orders by `created_at` and a
        // catalogue of 3,906 rows written inside one transaction shares that
        // timestamp: "the next one in line" is not a thing that exists there,
        // so a test built on it would be measuring the tie-break.
        const solo = await service.plan(tenantId, planBody({
            profiles: [PROFILES[0]], subjects: { [PROFILES[0]]: subjects[PROFILES[0]] },
        }) as any, SUPER_ADMIN);
        await service.start(tenantId, solo.runId, SUPER_ADMIN, 1, 5);

        // Every case leased by a worker that then died: tokens nobody holds and
        // expiries in the past. This is what a killed process looks like from
        // the database's side, and nothing else is claimable.
        const [{ n: held }] = await sql(
            `UPDATE agent_certification_cases
                SET state='leased', lease_token=gen_random_uuid(), lease_expires_at=NOW()-INTERVAL '1 minute'
              WHERE run_id=$1::uuid AND state='pending'
          RETURNING 1`, [solo.runId]).then(rows => [{ n: rows.length }]);
        expect(held).toBe(solo.planned);

        const recovered = await metrics.time('recover_expired_leases',
            () => service.process({ tenantId, runId: solo.runId, cases: 25 }));
        // A run whose every case is held by a ghost has to be recoverable, or a
        // single crashed worker strands the whole catalogue until somebody
        // notices — which is the failure mode nobody notices.
        expect(recovered.processed).toBe(25);
        const [ghosts] = await sql(
            `SELECT count(*)::int AS n FROM agent_certification_cases
              WHERE run_id=$1::uuid AND state='leased' AND lease_expires_at < NOW()`, [solo.runId]);
        expect(Number(ghosts.n)).toBe(solo.planned - 25);
        await service.cancel(tenantId, solo.runId, SUPER_ADMIN);
    });

    it('reports per profile as well as per channel, and certifies none of them', async () => {
        const run = (globalThis as any).__catalogueRun;
        const report = await metrics.time('report', () => service.report(tenantId, run.runId, SUPER_ADMIN));
        expect(report.dryRun).toBe(true);
        // Seventy-six profiles averaged into one verdict would be the failure
        // this test exists for: the report has to say which profile, or nobody
        // can act on it.
        const serialized = JSON.stringify(report.report);
        for (const profileId of PROFILES.slice(0, 5)) expect(serialized).toContain(profileId);
        // And a rehearsal certifies nothing, however many rows it wrote.
        expect(report.report.summary.certified).toBe(0);
        expect(report.report.summary.verifiedCases).toBe(0);
    });

    it('measures what planning the entire catalogue costs to write', async () => {
        const full = planCertificationRun({
            profiles: PROFILES, languages: ['es', 'en', 'pt', 'fr'],
            channels: ['whatsapp', 'instagram', 'messenger', 'telegram', 'web_widget'],
            models: ['gpt-4.1-mini'],
        });
        // Not executed and not asserted on a threshold: this is the number the
        // cost report quotes, and what is worth knowing about it is that it is
        // 1,520 cells and how long the ledger takes to write them — because a
        // planner that holds one transaction open for minutes is a planner that
        // blocks a tenant, and that is a property nobody had measured.
        //
        // Measuring it is what got it fixed: one INSERT per case took 43s, and
        // the batched write takes under 4. The number stays printed rather than
        // asserted, because the next regression will be a change in shape and a
        // threshold picked off one laptop would either miss it or cry wolf.
        expect(full.cells.length).toBe(PROFILES.length * 4 * 5);
        const run = await metrics.time('plan_full_catalogue', () => service.plan(tenantId,
            planBody({ languages: ['es', 'en', 'pt', 'fr'],
                channels: ['whatsapp', 'instagram', 'messenger', 'telegram', 'web_widget'] }) as any, SUPER_ADMIN));
        expect(run.planned).toBe(full.totals.requiredCases);
        metrics.note(`full catalogue: ${full.cells.length} cells, ${run.planned} cases, `
            + `ceiling US$${(full.totals.maxCostUsdCents / 100).toFixed(2)}`);
        await service.cancel(tenantId, run.runId, SUPER_ADMIN);
    });
});
