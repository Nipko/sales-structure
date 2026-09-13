import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { listCanonicalSubtypeExperienceProfileIds } from '@parallext/shared';
import { BenchmarkService } from './benchmark.service';
import { isDisposableDatabase } from '../../common/__fixtures__/disposable-database';

/**
 * The benchmark from the entrypoint to the summary, with no competitor account
 * and no provider.
 *
 * Same gap as the certification executor had: functions and PostgreSQL tests,
 * and nothing that could run one. Everything here is the real service — the
 * corpus generator, the queue publication, the worker body, the blind review and
 * the summary — with the queue stubbed so jobs can be inspected and the model
 * stubbed to throw, because a synthetic subject must never reach one.
 *
 * The last test is the one that keeps the whole thing honest: with only
 * synthetic subjects, the summary refuses to state a comparison.
 */

const connection = process.env.PARALLLY_ISOLATION_TEST_URL;
const profiles = listCanonicalSubtypeExperienceProfileIds().slice(0, 4);
const SUPER_ADMIN = { id: '11111111-1111-4111-8111-111111111111', role: 'super_admin' };
const TENANT_ADMIN = { id: '22222222-2222-4222-8222-222222222222', role: 'tenant_admin' };

(connection ? describe : describe.skip)('benchmark service end to end', () => {
    let pool: Pool;
    const schema = `bench_svc_${randomUUID().replace(/-/g, '')}`;
    const tenantId = randomUUID();
    let service: BenchmarkService;
    let queued: Array<{ data: any; opts: any }>;
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

    const body = (over: Record<string, unknown> = {}): Record<string, any> => ({
        corpusId: 'local-compare', seed: 'seed-one',
        profiles, languages: ['es'], channels: ['whatsapp'], perStratum: 1,
        subjects: [
            { id: 'alpha', kind: 'alternative' as const, label: 'Alfa', blindLabel: 'sujeto-A', setupMinutes: 20 },
            { id: 'beta', kind: 'alternative' as const, label: 'Beta', blindLabel: 'sujeto-B', setupMinutes: 15 },
        ],
        ...over,
    });

    beforeAll(async () => {
        if (!isDisposableDatabase(connection)) throw new Error('disposable_database_required');
        pool = new Pool({ connectionString: connection, max: 6 });
        await transaction(query => query(`CREATE SCHEMA "${schema}"`));
        queued = []; audits = [];
        const prisma: any = {
            getTenantSchemaName: async (id: string) => (id === tenantId ? schema : null),
            transactionInTenantSchema: async (_schema: string, work: any) => transaction(work),
            auditLog: { create: async (row: any) => { audits.push(row.data); return row.data; } },
        };
        const queue: any = { add: async (_name: string, data: any, opts: any) => { queued.push({ data, opts }); } };
        const evals: any = { runGateV2: async () => { throw new Error('model_must_not_be_called'); } };
        const agentTest: any = { captureSnapshot: async () => { throw new Error('model_must_not_be_called'); } };
        service = new BenchmarkService(prisma, evals, agentTest, queue);
    }, 60000);

    afterAll(async () => {
        if (pool) {
            await transaction(query => query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`));
            await pool.end();
        }
    });

    it('refuses a label a reviewer could decode', async () => {
        expect(() => service.corpus(body({
            subjects: [{ id: 'alpha', kind: 'alternative', label: 'Alfa', blindLabel: 'Alfa-1', setupMinutes: 1 }],
        }) as any)).toThrow();
        expect(() => service.corpus(body({
            subjects: [{ id: 'alpha', kind: 'alternative', label: 'Alfa', blindLabel: 'alpha', setupMinutes: 1 }],
        }) as any)).toThrow();
    });

    it('shows what would be compared, and what it refused, before anything runs', () => {
        const built = service.corpus(body() as any);
        expect(built.corpus.tasks.length).toBeGreaterThan(0);
        expect(built.corpus.contentHash).toEqual(expect.stringMatching(/^[a-f0-9]{16,}$/));
        // The refusals are part of the answer: a corpus is what survived, and
        // the reader has to be able to see what did not.
        expect(built.refusals.no_confirmable_outcome).toBeGreaterThan(0);
    });

    it('publishes one job per subject, with an id that survives a retried start', async () => {
        await service.plan(tenantId, body() as any, SUPER_ADMIN);
        queued.length = 0;
        await service.start(tenantId, body() as any, SUPER_ADMIN);
        await service.start(tenantId, body() as any, SUPER_ADMIN);
        expect(new Set(queued.map(job => job.opts.jobId)).size).toBe(2);
        expect(audits.some(row => row.action === 'benchmark.started')).toBe(true);
    }, 120000);

    it('runs both subjects through the real worker body and stores every attempt', async () => {
        const built = service.corpus(body() as any);
        queued.length = 0;
        await service.start(tenantId, body() as any, SUPER_ADMIN);
        for (const job of [...queued]) await service.process(job.data);
        const [stored] = await sql('SELECT count(*)::int AS n FROM benchmark_attempts WHERE corpus_hash=$1',
            [built.corpus.contentHash]);
        expect(Number(stored.n)).toBe(built.corpus.tasks.length * 2);
    }, 180000);

    it('keeps a blind score only for a task somebody attempted', async () => {
        const built = service.corpus(body() as any);
        await service.review(tenantId, built.corpus.contentHash, {
            taskKey: 'never-attempted', blindLabel: 'sujeto-A', reviewerId: 'rev-1', score: 9,
        }, SUPER_ADMIN);
        await service.review(tenantId, built.corpus.contentHash, {
            taskKey: built.corpus.tasks[0].key, blindLabel: 'sujeto-A', reviewerId: 'rev-1', score: 9,
        }, SUPER_ADMIN);
        const [stored] = await sql('SELECT count(*)::int AS n FROM benchmark_reviews WHERE corpus_hash=$1',
            [built.corpus.contentHash]);
        expect(Number(stored.n)).toBe(1);
    }, 180000);

    it('will not state a comparison until a real alternative has answered', async () => {
        const report = await service.report(tenantId, body() as any, SUPER_ADMIN);
        expect(report.attempts).toBeGreaterThan(0);
        // Two synthetic subjects are two subjects and still not a comparison:
        // neither of them is us, so nothing here says anything about Parallly.
        expect(report.report.comparable).toBe(false);
        expect(report.report.blockers).toContain('no_self_subject');
        expect(report.statement).toContain('No comparison can be stated');
        expect(report.statement).not.toMatch(/best|mejor|superior/i);
    }, 180000);

    it('refuses to score against a corpus that is not the one that was planned', async () => {
        // The generator is deterministic, so a mismatch means the worker and the
        // planner disagree about what is being compared — which used to produce
        // rows under a hash nobody was reading.
        await service.start(tenantId, body() as any, SUPER_ADMIN, 9);
        const job = { ...queued[queued.length - 1].data, corpusHash: 'a'.repeat(64) };
        await expect(service.process(job)).rejects.toMatchObject({
            response: { error: 'benchmark_corpus_drifted' },
        });
    }, 120000);

    // ── The ceiling, the clock, the stop button and the retry ───────────────

    it('refuses to publish a run with Parallly in it and no ceiling', async () => {
        const withSelf = body({
            subjects: [
                { id: 'parallly', kind: 'self' as const, label: 'Parallly', blindLabel: 'sujeto-P', setupMinutes: 5 },
                { id: 'alpha', kind: 'alternative' as const, label: 'Alfa', blindLabel: 'sujeto-A', setupMinutes: 20 },
            ],
        });
        // The Parallly runner calls a model for every task. An uncapped pass
        // over a catalogue is a bill nobody approved, and the refusal happens
        // before anything is published rather than after money is spent.
        await expect(service.start(tenantId, withSelf as any, SUPER_ADMIN))
            .rejects.toMatchObject({ response: { error: 'benchmark_budget_required' } });
        // Synthetic subjects cost nothing, so they need no ceiling.
        await expect(service.start(tenantId, body() as any, SUPER_ADMIN)).resolves.toMatchObject({ subjects: 2 });
    }, 120000);

    it('opens one run for one request key, however many times start is called', async () => {
        const request = body({ requestKey: `key-${randomUUID()}` });
        const first = await service.start(tenantId, request as any, SUPER_ADMIN);
        const again = await service.start(tenantId, request as any, SUPER_ADMIN);
        expect(again.runId).toBe(first.runId);
        const [rows] = await sql('SELECT count(*)::int AS n FROM benchmark_runs WHERE request_key=$1',
            [request.requestKey]);
        // A second run over the same corpus would double the spend and make
        // "did the subject agree with itself" mean nothing.
        expect(Number(rows.n)).toBe(1);
    }, 120000);

    it('stops on the ceiling instead of finishing the pass', async () => {
        // The synthetic runner charges a cent a task and the corpus has four,
        // so a two-cent ceiling has to stop the pass half way through.
        const request = body({
            corpusId: 'budget-compare', seed: 'seed-budget', requestKey: `key-${randomUUID()}`, budgetUsdCents: 2,
            subjects: [{ id: 'alpha', kind: 'alternative' as const, label: 'Alfa', blindLabel: 'sujeto-A', setupMinutes: 1 }],
        });
        const run = await service.start(tenantId, request as any, SUPER_ADMIN);
        const outcome = await service.process(queued[queued.length - 1].data);
        expect(outcome.stopReason).toBe('budget_exhausted');
        expect(outcome.attempts).toBe(2);
        const state = await service.runState(tenantId, run.runId, SUPER_ADMIN);
        // Spent up to the ceiling and not a cent past it. A ceiling checked once
        // at the start of a pass is a ceiling that authorises the whole pass.
        expect(state).toMatchObject({ budgetUsdCents: 2, spentUsdCents: 2 });
    }, 120000);

    it('stops on a deadline that has already passed', async () => {
        const request = body({
            requestKey: `key-${randomUUID()}`,
            deadlineAt: new Date(Date.now() - 60_000).toISOString(),
        });
        const run = await service.start(tenantId, request as any, SUPER_ADMIN);
        const outcome = await service.process(queued[queued.length - 1].data);
        // Nothing runs, and the reason is the deadline rather than a silent zero.
        expect(outcome).toMatchObject({ attempts: 0, stopReason: 'deadline_passed' });
        expect((await service.runState(tenantId, run.runId, SUPER_ADMIN))?.deadlineAt).not.toBeNull();
    }, 120000);

    it('cancels, and a worker that arrives afterwards takes nothing', async () => {
        const request = body({ requestKey: `key-${randomUUID()}` });
        const run = await service.start(tenantId, request as any, SUPER_ADMIN);
        expect(await service.cancel(tenantId, run.runId, SUPER_ADMIN)).toMatchObject({ cancelled: true });
        const outcome = await service.process(queued[queued.length - 1].data);
        expect(outcome).toMatchObject({ attempts: 0, stopReason: 'cancelled' });
        // Terminal: resuming a cancelled run does not reopen it.
        expect(await service.resume(tenantId, run.runId, SUPER_ADMIN)).toMatchObject({ resumed: false });
        expect(audits.some(row => row.action === 'benchmark.cancelled')).toBe(true);
    }, 120000);

    it('pauses without losing the run, and resumes it', async () => {
        const request = body({ requestKey: `key-${randomUUID()}` });
        const run = await service.start(tenantId, request as any, SUPER_ADMIN);
        await service.pause(tenantId, run.runId, SUPER_ADMIN);
        expect(await service.process(queued[queued.length - 1].data))
            .toMatchObject({ attempts: 0, stopReason: 'paused' });
        await service.resume(tenantId, run.runId, SUPER_ADMIN);
        expect((await service.runState(tenantId, run.runId, SUPER_ADMIN))?.state).toBe('running');
    }, 120000);

    it('does not answer the same task twice when a job is retried', async () => {
        const request = body({
            corpusId: 'retry-compare', seed: 'seed-retry', requestKey: `key-${randomUUID()}`,
            subjects: [{ id: 'alpha', kind: 'alternative' as const, label: 'Alfa', blindLabel: 'sujeto-A', setupMinutes: 1 }],
        });
        await service.start(tenantId, request as any, SUPER_ADMIN);
        const job = queued[queued.length - 1].data;
        const first = await service.process(job);
        expect(first.attempts).toBeGreaterThan(0);
        // The same job again, which is what BullMQ does after a worker dies.
        // Before the claim, every task was answered again — by a real model, at
        // a real price — and the answer thrown away on the unique index.
        const retried = await service.process(job);
        expect(retried).toMatchObject({ attempts: 0, skipped: first.attempts });
        const [rows] = await sql(
            `SELECT count(*)::int AS n FROM benchmark_attempts WHERE corpus_id='retry-compare' AND subject_id='alpha'`);
        expect(Number(rows.n)).toBe(first.attempts);
    }, 120000);

    it('lets another worker take a task a dead one was holding', async () => {
        const request = body({
            corpusId: 'lease-compare', seed: 'seed-lease', requestKey: `key-${randomUUID()}`,
            subjects: [{ id: 'alpha', kind: 'alternative' as const, label: 'Alfa', blindLabel: 'sujeto-A', setupMinutes: 1 }],
        });
        await service.start(tenantId, request as any, SUPER_ADMIN);
        const job = queued[queued.length - 1].data;
        const done = await service.process(job);
        // Not vacuous: a run with nothing to do would make the recovery below
        // pass by comparing zero to zero.
        expect(done.attempts).toBeGreaterThan(0);
        // Every task back to `claimed` with an expiry in the past: a worker that
        // died holding all of them.
        await sql(`UPDATE benchmark_attempts SET state='claimed', lease_expires_at=NOW()-INTERVAL '1 minute'
                    WHERE corpus_id='lease-compare'`);
        const recovered = await service.process(job);
        // Recoverable, or one crash strands the run until somebody notices.
        expect(recovered.attempts).toBe(done.attempts);
        const [rows] = await sql(
            `SELECT count(*)::int AS n FROM benchmark_attempts
              WHERE corpus_id='lease-compare' AND state='claimed'`);
        expect(Number(rows.n)).toBe(0);
    }, 120000);

    it('keeps operating it a platform decision', async () => {
        await expect(service.plan(tenantId, body() as any, TENANT_ADMIN))
            .rejects.toMatchObject({ response: { error: 'certification_role_required' } });
        await expect(service.report(tenantId, body() as any, TENANT_ADMIN)).resolves.toBeTruthy();
    }, 120000);
});
