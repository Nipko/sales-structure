import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { listCanonicalSubtypeExperienceProfileIds } from '@parallext/shared';
import { revisionHash } from '../evaluation-revision/evaluation-revision';
import { certifyProfiles } from './agent-certification';
import { requiredScenarios } from './agent-certification';
import { releaseRunContext } from './agent-release-policy';
import {
    cancelCertificationRun, certificationEvidenceFromLedger, certificationProgress,
    driveCertificationRun, ensureCertificationLedger, leaseCertificationCase,
    planCertificationLedger, recordCertificationCase, retryCertificationCase,
    type CertificationCaseResult, type CertificationLease, type CertificationQuery,
} from './certification-ledger';
import { isDisposableDatabase } from '../../common/__fixtures__/disposable-database';

/**
 * The executor the certification report never had, against a real database.
 *
 * The point of every assertion here is a 233-hour run being interrupted: a
 * worker that dies mid-case, a second worker that takes over, a budget that runs
 * out, a deadline that passes, an operator who cancels, a pack that changes
 * underneath evidence already collected. None of that can be reasoned about
 * against a mock, because all of it is about what the database does when two
 * transactions want the same row.
 *
 * Nothing here calls a model. The runner is injected precisely so the executor
 * can be proven without spending a cent — the plan's dry-run is what asks for
 * permission to spend, and that is a separate decision.
 */

const connection = process.env.PARALLLY_ISOLATION_TEST_URL;
const profileId = listCanonicalSubtypeExperienceProfileIds()[0];

(connection ? describe : describe.skip)('certification ledger on disposable PostgreSQL', () => {
    let pool: Pool;
    const schema = `cert_ledger_${randomUUID().replace(/-/g, '')}`;
    const agentId = randomUUID();
    const planInput = {
        agentId, configHash: 'config-1', dependencyRevision: 'dependency-1',
        profiles: [profileId], languages: ['es'], channels: ['whatsapp'], models: ['gpt-4.1-mini'],
    };

    // Every statement runs inside a transaction, because `SET LOCAL` outside one
    // is a no-op: the first version of this harness created the tables in
    // `public` and then looked for them in the schema.
    const transaction = async <T>(work: (query: CertificationQuery) => Promise<T>): Promise<T> => {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(`SET LOCAL search_path TO "${schema}"`);
            const value = await work(async <R = any[]>(text: string, params: any[] = []) =>
                (await client.query(text, params)).rows as R);
            await client.query('COMMIT');
            return value;
        } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    };
    const sql: CertificationQuery = <R = any[]>(text: string, params: any[] = []) =>
        transaction(query => query<R>(text, params));

    const result = (over: Partial<CertificationCaseResult> = {}): CertificationCaseResult => ({
        passed: true, servedModel: 'gpt-4.1-mini', costUsdCents: 1, latencyMs: 10,
        transcript: [{ role: 'assistant', content: 'ok' }], tools: [], verification: { ok: true },
        scenario: { key: 'scenario' }, ...over,
    });

    beforeAll(async () => {
        if (!isDisposableDatabase(connection)) throw new Error('disposable_database_required');
        pool = new Pool({ connectionString: connection, max: 6 });
        await transaction(query => query(`CREATE SCHEMA "${schema}"`));
        await ensureCertificationLedger(sql);
    }, 60000);

    afterAll(async () => {
        if (pool) {
            await transaction(query => query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`));
            await pool.end();
        }
    });

    const freshRun = async (over: Record<string, unknown> = {}) => {
        const record = await planCertificationLedger(sql, { ...planInput, ...over } as any);
        return record;
    };

    it('writes every planned case as a row before anything runs, and re-planning adds nothing', async () => {
        const run = await freshRun();
        expect(run.plannedCases).toBeGreaterThan(10);
        // The universe is the one certification demands, not a second walk.
        expect(run.plannedCases).toBe(requiredScenarios(profileId, 'es').size);
        const again = await planCertificationLedger(sql, planInput as any, run.id as any);
        expect(again.plannedCases).toBe(run.plannedCases);
        const [rows] = await sql<any[]>('SELECT count(*)::int AS n FROM agent_certification_cases WHERE run_id=$1::uuid', [run.id]);
        expect(Number(rows.n)).toBe(run.plannedCases);
    }, 120000);

    it('leases one case at a time and never hands the same one to two workers', async () => {
        const run = await freshRun();
        const first = await transaction(query => leaseCertificationCase(query, run.id));
        const second = await transaction(query => leaseCertificationCase(query, run.id));
        expect(first.ok && second.ok).toBe(true);
        if (!first.ok || !second.ok) return;
        expect(first.lease.caseId).not.toBe(second.lease.caseId);
        expect(first.lease.leaseToken).not.toBe(second.lease.leaseToken);
        const [run_] = await sql<any[]>('SELECT state FROM agent_certification_runs WHERE id=$1::uuid', [run.id]);
        expect(run_.state).toBe('running');
    }, 120000);

    it('gives an expired lease to somebody else, and refuses the first worker its late result', async () => {
        const run = await freshRun();
        const stalled = await transaction(query => leaseCertificationCase(query, run.id, 1));
        expect(stalled.ok).toBe(true);
        if (!stalled.ok) return;
        // The clock moves; the lease does not have to be waited out in real time.
        await sql(`UPDATE agent_certification_cases SET lease_expires_at = clock_timestamp() - interval '1 minute'
                    WHERE id=$1::uuid`, [stalled.lease.caseId]);
        const rescued = await transaction(query => leaseCertificationCase(query, run.id));
        expect(rescued.ok).toBe(true);
        if (!rescued.ok) return;
        expect(rescued.lease.caseId).toBe(stalled.lease.caseId);
        expect(rescued.lease.leaseToken).not.toBe(stalled.lease.leaseToken);

        // The rescuer records. Then the stalled worker wakes up and tries to.
        expect(await transaction(query => recordCertificationCase(query, rescued.lease, result({ costUsdCents: 3 }))))
            .toEqual({ ok: true });
        expect(await transaction(query => recordCertificationCase(query, stalled.lease, result({ passed: false }))))
            .toEqual({ ok: false, reason: 'lease_lost' });
        const [row] = await sql<any[]>('SELECT state, cost_usd_cents FROM agent_certification_cases WHERE id=$1::uuid',
            [stalled.lease.caseId]);
        expect(row).toMatchObject({ state: 'passed', cost_usd_cents: 3 });
    }, 120000);

    it('retries as a new attempt instead of rewinding the row that recorded an effect', async () => {
        const run = await freshRun();
        const lease = await transaction(query => leaseCertificationCase(query, run.id));
        expect(lease.ok).toBe(true);
        if (!lease.ok) return;
        await transaction(query => recordCertificationCase(query, lease.lease, result({ passed: false, costUsdCents: 2 })));
        expect(await transaction(query => retryCertificationCase(query, run.id, lease.lease.caseKey)))
            .toEqual({ ok: true, attempt: 2 });
        const rows = await sql<any[]>(
            'SELECT attempt, state, cost_usd_cents FROM agent_certification_cases WHERE run_id=$1::uuid AND case_key=$2 ORDER BY attempt',
            [run.id, lease.lease.caseKey]);
        expect(rows).toEqual([
            expect.objectContaining({ attempt: 1, state: 'failed', cost_usd_cents: 2 }),
            expect.objectContaining({ attempt: 2, state: 'pending', cost_usd_cents: null }),
        ]);
        // A case that passed is not retryable: doing it again would spend money
        // to re-prove something already proven.
        const passing = await transaction(query => leaseCertificationCase(query, run.id));
        if (!passing.ok) return;
        await transaction(query => recordCertificationCase(query, passing.lease, result()));
        expect(await transaction(query => retryCertificationCase(query, run.id, passing.lease.caseKey)))
            .toEqual({ ok: false, reason: 'not_retryable' });
    }, 120000);

    it('stops before spending past the budget, not after', async () => {
        const run = await freshRun({ budgetUsdCents: 5 });
        for (let index = 0; index < 3; index++) {
            const lease = await transaction(query => leaseCertificationCase(query, run.id));
            if (!lease.ok) break;
            await transaction(query => recordCertificationCase(query, lease.lease, result({ costUsdCents: 2 })));
        }
        const refused = await transaction(query => leaseCertificationCase(query, run.id));
        expect(refused).toEqual({ ok: false, stopReason: 'budget_exhausted' });
        const progress = await certificationProgress(sql, run.id);
        expect(progress).toMatchObject({ state: 'finished', stopReason: 'budget_exhausted', spentUsdCents: 6 });
        // Six cents against a five-cent ceiling: the overshoot is one case, not
        // unbounded, because the check happens before the lease and a case
        // cannot be priced before it runs.
        expect(progress!.spentUsdCents).toBeLessThanOrEqual(5 + 2);
    }, 120000);

    it('stops when the deadline has passed, by the clock that moves', async () => {
        const run = await freshRun({ deadlineAt: new Date(Date.now() - 60_000) });
        expect(await transaction(query => leaseCertificationCase(query, run.id)))
            .toEqual({ ok: false, stopReason: 'deadline_passed' });
    }, 120000);

    it('hands out nothing once cancelled', async () => {
        const run = await freshRun();
        await transaction(query => cancelCertificationRun(query, run.id));
        expect(await transaction(query => leaseCertificationCase(query, run.id)))
            .toEqual({ ok: false, stopReason: 'cancelled' });
        expect((await certificationProgress(sql, run.id))!.state).toBe('cancelled');
    }, 120000);

    it('records a crashed runner as an error instead of leaving the case leased forever', async () => {
        const run = await freshRun();
        const driven = await driveCertificationRun({
            transaction, runId: run.id, maxCases: 1,
            runner: async () => { throw new Error('provider_exploded'); },
        });
        expect(driven).toEqual({ processed: 1, stopReason: 'batch_limit' });
        const [row] = await sql<any[]>(
            `SELECT state, error_code FROM agent_certification_cases
              WHERE run_id=$1::uuid AND state='error' LIMIT 1`, [run.id]);
        expect(row).toMatchObject({ state: 'error', error_code: 'provider_exploded' });
        // And it is not still holding a lease nobody will ever release.
        const [leased] = await sql<any[]>(
            `SELECT count(*)::int AS n FROM agent_certification_cases WHERE run_id=$1::uuid AND lease_token IS NOT NULL`,
            [run.id]);
        expect(Number(leased.n)).toBe(0);
    }, 120000);

    it('reports the gap per profile, language, channel and model, counting a case once', async () => {
        const run = await freshRun();
        const lease = await transaction(query => leaseCertificationCase(query, run.id));
        if (!lease.ok) return;
        await transaction(query => recordCertificationCase(query, lease.lease, result({ passed: false })));
        await transaction(query => retryCertificationCase(query, run.id, lease.lease.caseKey));
        const progress = (await certificationProgress(sql, run.id))!;
        expect(progress.gaps.byProfile[profileId]).toBe(progress.planned);
        expect(progress.gaps.byLanguage.es).toBe(progress.planned);
        expect(progress.gaps.byChannel.whatsapp).toBe(progress.planned);
        expect(progress.gaps.byModel['gpt-4.1-mini']).toBe(progress.planned);
        // And per task, read off the scenario key, so a gap can be named as
        // "this profile cannot do this thing" rather than as a total.
        expect(Object.keys(progress.gaps.byTask).length).toBeGreaterThan(0);
        expect(Object.values(progress.gaps.byTask).reduce((a, b) => a + b, 0)).toBe(progress.planned);
        // Two rows for one case, one gap. Counting rows would double it.
        const [rows] = await sql<any[]>('SELECT count(*)::int AS n FROM agent_certification_cases WHERE run_id=$1::uuid', [run.id]);
        expect(Number(rows.n)).toBe(progress.planned + 1);
    }, 120000);

    it('feeds the certification report from stored rows, and drops evidence whose scenario was rewritten', async () => {
        const run = await freshRun();
        const scenarios = requiredScenarios(profileId, 'es');
        const [firstKey] = [...scenarios.keys()];
        let leased: CertificationLease | null = null;
        for (let index = 0; index < scenarios.size; index++) {
            const claim = await transaction(query => leaseCertificationCase(query, run.id));
            if (!claim.ok) break;
            if (claim.lease.scenarioKey === firstKey) leased = claim.lease;
            await transaction(query => recordCertificationCase(query, claim.lease, result({
                scenario: { key: claim.lease.scenarioKey, profileId, language: 'es', managedSeedKey: claim.lease.scenarioKey },
            })));
        }
        expect(leased).not.toBeNull();

        const fresh = await certificationEvidenceFromLedger(sql, run.id);
        expect(fresh.staleCases).toBe(0);
        expect(fresh.evidence).toHaveLength(1);
        expect(fresh.evidence[0]).toMatchObject({ channelType: 'whatsapp', models: ['gpt-4.1-mini'], status: 'completed' });
        // The evidence is sealed the same way a release run is, so the report
        // reads it through exactly one definition of "this run counts".
        expect(fresh.evidence[0].evidenceHash).toEqual(expect.stringMatching(/^[a-f0-9]{16,}$/));
        expect(releaseRunContext(fresh.evidence[0])).toEqual(expect.any(String));

        // Now the pack changes underneath the evidence.
        await sql(`UPDATE agent_certification_cases SET definition_hash=$2 WHERE run_id=$1::uuid AND scenario_key=$3`,
            [run.id, revisionHash(['rewritten']), firstKey]);
        const stale = await certificationEvidenceFromLedger(sql, run.id);
        expect(stale.staleCases).toBe(1);
        expect(stale.evidence[0].scenarios.length).toBe(fresh.evidence[0].scenarios.length - 1);

        // A configuration change invalidates the whole run: every case in it ran
        // against an agent that no longer exists, so none of it is evidence
        // about the one that does.
        expect(await certificationEvidenceFromLedger(sql, run.id, { configHash: 'config-2' }))
            .toEqual({ evidence: [], staleCases: 0, staleRun: 'config_changed' });
        expect(await certificationEvidenceFromLedger(sql, run.id, { dependencyRevision: 'dependency-2' }))
            .toEqual({ evidence: [], staleCases: 0, staleRun: 'dependency_changed' });
        expect((await certificationEvidenceFromLedger(sql, run.id,
            { configHash: 'config-1', dependencyRevision: 'dependency-1' })).evidence).toHaveLength(1);

        // And the report is computed from those rows rather than from objects a
        // test built, which is the whole point of the ledger.
        const report = certifyProfiles({
            scope: { languages: ['es'], channels: ['whatsapp'], models: ['gpt-4.1-mini'] },
            evidence: stale.evidence, profiles: [profileId],
        });
        expect(report.evidenceKind).toBe('executed_runs');
        expect(report.summary.profiles).toBe(1);
        // Not certified: a scenario nobody proved in its current form, plus the
        // three languages this narrow run never covered.
        expect(report.profiles[0].reasons).toContain('language_scope_incomplete');
    }, 240000);
});
