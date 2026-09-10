import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { listCanonicalSubtypeExperienceProfileIds } from '@parallext/shared';
import {
    certificationEvidenceFromLedger, certificationProgress, driveCertificationRun,
    ensureCertificationLedger, leaseCertificationCase, planCertificationLedger,
    recordCertificationCase, retryCertificationCase, CertificationPlanRefused,
    type CertificationCaseResult, type CertificationQuery,
} from './certification-ledger';
import { isDisposableDatabase } from '../../common/__fixtures__/disposable-database';

/**
 * What a second worker does to the executor.
 *
 * The first ledger spec is sequential: it leases a case, records it, and leases
 * the next one. Every guarantee that involves two workers at once is therefore
 * untested by it, and the pre-deployment review was right that the interesting
 * failures live exactly there:
 *
 *  · the budget is compared against what has already been RECORDED, so N
 *    workers holding N leases all see the same untouched `spent` and all pass
 *    the check. The overshoot is bounded by how many workers there are, not by
 *    one case;
 *  · "nothing claimable" is not "finished". With every case leased by somebody
 *    else there is no row to hand out, and calling that `complete` closes a run
 *    whose results are still in flight;
 *  · a result rejected for a lost lease is not a result. Counting it as one
 *    makes a worker's batch limit consume work it did not do.
 *
 * Each test here asserts the behaviour the executor must have. They were
 * written before the fix, against the code that had none, and each one failed
 * for the reason named above.
 */

const connection = process.env.PARALLLY_ISOLATION_TEST_URL;
const profileId = listCanonicalSubtypeExperienceProfileIds()[0];

(connection ? describe : describe.skip)('certification ledger under two workers', () => {
    let pool: Pool;
    const schema = `cert_conc_${randomUUID().replace(/-/g, '')}`;
    const planInput = {
        agentId: randomUUID(), configHash: 'config-1', dependencyRevision: 'dependency-1',
        profiles: [profileId], languages: ['es'], channels: ['whatsapp'], models: ['gpt-4.1-mini'],
    };
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
        passed: true, servedModel: 'gpt-4.1-mini', costUsdCents: 2, latencyMs: 10,
        transcript: [], tools: [], verification: { ok: true }, scenario: { key: 'k' }, ...over,
    });

    beforeAll(async () => {
        if (!isDisposableDatabase(connection)) throw new Error('disposable_database_required');
        pool = new Pool({ connectionString: connection, max: 8 });
        await transaction(query => query(`CREATE SCHEMA "${schema}"`));
        await transaction(ensureCertificationLedger);
    }, 60000);

    afterAll(async () => {
        if (pool) {
            await transaction(query => query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`));
            await pool.end();
        }
    });

    const freshRun = (over: Record<string, unknown> = {}) =>
        planCertificationLedger(sql, { ...planInput, ...over } as any);

    /**
     * The reservation each case carries comes from the plan, not from the test.
     * Asserting a made-up per-case price would be testing the fake runner.
     */
    const reserves = async (runId: string) => {
        const rows = await sql<any[]>(
            `SELECT reserve_usd_cents AS reserve FROM agent_certification_cases WHERE run_id=$1::uuid`, [runId]);
        return rows.map(row => Number(row.reserve));
    };
    const leasedReserve = async (runId: string) => {
        const [row] = await sql<any[]>(
            `SELECT COALESCE(SUM(reserve_usd_cents),0)::int AS n FROM agent_certification_cases
              WHERE run_id=$1::uuid AND state='leased'`, [runId]);
        return Number(row.n);
    };

    it('never hands out more reservation than the budget can pay for', async () => {
        const sizing = await freshRun();
        const perCase = await reserves(sizing.id);
        expect(Math.min(...perCase)).toBeGreaterThan(0);
        // Room for a couple of cases, not for the run.
        const budget = Math.min(...perCase) * 2;

        const run = await freshRun({ budgetUsdCents: budget });
        const leases = [];
        for (;;) {
            const claim = await transaction(query => leaseCertificationCase(query, run.id));
            if (!claim.ok) { expect(claim.stopReason).toBe('budget_exhausted'); break; }
            leases.push(claim.lease);
            // The invariant, checked after every single lease rather than at the
            // end: what is committed can always be paid for.
            expect(await leasedReserve(run.id)).toBeLessThanOrEqual(budget);
        }
        expect(leases.length).toBeGreaterThan(0);
        expect(leases.length).toBeLessThan(run.plannedCases);

        // Settling at the reserved price keeps the run inside its ceiling.
        const priced = await sql<any[]>(
            `SELECT id, reserve_usd_cents AS reserve FROM agent_certification_cases
              WHERE run_id=$1::uuid AND state='leased'`, [run.id]);
        const byId = new Map(priced.map(row => [String(row.id), Number(row.reserve)]));
        for (const lease of leases) {
            await transaction(query => recordCertificationCase(query, lease,
                result({ costUsdCents: byId.get(lease.caseId) ?? 0 })));
        }
        expect((await certificationProgress(sql, run.id))!.spentUsdCents).toBeLessThanOrEqual(budget);
    }, 180000);

    it('refuses concurrently, not just one at a time', async () => {
        const sizing = await freshRun();
        // Exactly one case fits: `committed >= budget` refuses the moment the
        // first reservation is taken.
        const run = await freshRun({ budgetUsdCents: Math.min(...await reserves(sizing.id)) });
        // Both transactions open before either commits: the guarantee has to
        // survive the interleaving, not just the sequence.
        const [first, second] = await Promise.all([
            transaction(query => leaseCertificationCase(query, run.id)),
            transaction(query => leaseCertificationCase(query, run.id)),
        ]);
        expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1);
        expect([first, second].find(claim => !claim.ok)).toMatchObject({ stopReason: 'budget_exhausted' });
    }, 180000);

    it('records a case that cost more than its reservation, and stops after it', async () => {
        // The reservation is a ceiling from the declared token bound. If a real
        // run breaks it, the ledger must record what it actually cost — lying to
        // protect the ceiling would make the spend unauditable — and refuse the
        // next case because the budget really is gone.
        const sizing = await freshRun();
        const budget = Math.min(...await reserves(sizing.id)) * 2;
        const run = await freshRun({ budgetUsdCents: budget });
        const claim = await transaction(query => leaseCertificationCase(query, run.id));
        expect(claim.ok).toBe(true);
        if (!claim.ok) return;
        await transaction(query => recordCertificationCase(query, claim.lease,
            result({ costUsdCents: budget * 3 })));
        const progress = (await certificationProgress(sql, run.id))!;
        expect(progress.spentUsdCents).toBe(budget * 3);
        const refused = await transaction(query => leaseCertificationCase(query, run.id));
        expect(refused).toEqual({ ok: false, stopReason: 'budget_exhausted' });
        expect((await certificationProgress(sql, run.id))!.state).toBe('finished');
    }, 180000);

    it('gives the reservation back when a case settles under it', async () => {
        const sizing = await freshRun();
        const budget = Math.min(...await reserves(sizing.id)) * 2;
        const run = await freshRun({ budgetUsdCents: budget });
        const first = await transaction(query => leaseCertificationCase(query, run.id));
        expect(first.ok).toBe(true);
        if (!first.ok) return;
        // Settles at nothing, so the whole budget is free again and more work
        // can be handed out than the reservations alone would have allowed.
        await transaction(query => recordCertificationCase(query, first.lease, result({ costUsdCents: 0 })));
        expect(await leasedReserve(run.id)).toBe(0);
        const second = await transaction(query => leaseCertificationCase(query, run.id));
        expect(second.ok).toBe(true);
    }, 180000);

    it('does not call a run finished while another worker still holds cases', async () => {
        const run = await freshRun();
        const held = [];
        for (;;) {
            const claim = await transaction(query => leaseCertificationCase(query, run.id));
            if (!claim.ok) { expect(claim.stopReason).toBe('in_flight'); break; }
            held.push(claim.lease);
        }
        expect(held.length).toBe(run.plannedCases);
        const progress = (await certificationProgress(sql, run.id))!;
        // Still running: the work is out with workers, not done.
        expect(progress.state).toBe('running');
        expect(progress.leased).toBe(run.plannedCases);
        // And once they all come back, it really is complete.
        for (const lease of held) {
            await transaction(query => recordCertificationCase(query, lease, result()));
        }
        const done = await transaction(query => leaseCertificationCase(query, run.id));
        expect(done).toEqual({ ok: false, stopReason: 'complete' });
        expect((await certificationProgress(sql, run.id))!.state).toBe('finished');
    }, 180000);

    it('does not count a result the ledger refused as work this worker did', async () => {
        const run = await freshRun();
        // The runner takes long enough that the case is handed to somebody else
        // — simulated by rotating the lease token while the runner is inside.
        const driven = await driveCertificationRun({
            transaction, runId: run.id, maxCases: 1,
            runner: async lease => {
                await sql('UPDATE agent_certification_cases SET lease_token = gen_random_uuid() WHERE id = $1::uuid',
                    [lease.caseId]);
                return result();
            },
        });
        expect(driven.processed).toBe(0);
        expect(driven.stopReason).toBe('lease_lost');
    }, 120000);

    it('does not call a run complete while a failure is waiting for a decision', async () => {
        const run = await freshRun();
        let failed = false;
        for (;;) {
            const claim = await transaction(query => leaseCertificationCase(query, run.id));
            if (!claim.ok) { expect(claim.stopReason).toBe('awaiting_retry_decision'); break; }
            await transaction(query => recordCertificationCase(query, claim.lease,
                result({ passed: failed })));
            failed = true;
        }
        // Nothing pending, nothing leased, and still not finished: a case that
        // failed every attempt is a decision somebody owes, not work that ran out.
        expect((await certificationProgress(sql, run.id))!.state).toBe('running');
        const [stuck] = await sql<any[]>(
            "SELECT case_key FROM agent_certification_cases WHERE run_id=$1::uuid AND state='failed' LIMIT 1",
            [run.id]);
        await transaction(query => retryCertificationCase(query, run.id, String(stuck.case_key)));
        const retry = await transaction(query => leaseCertificationCase(query, run.id));
        expect(retry.ok).toBe(true);
        if (!retry.ok) return;
        await transaction(query => recordCertificationCase(query, retry.lease, result()));
        expect(await transaction(query => leaseCertificationCase(query, run.id)))
            .toEqual({ ok: false, stopReason: 'complete' });
    }, 240000);

    it('refuses to plan several profiles under one agent', async () => {
        // The whole point of the subject table. A plan that cannot say which
        // agent answered for which profile would produce evidence nobody can
        // attribute, and 76 profiles sharing one authority is exactly that.
        const [first, second] = listCanonicalSubtypeExperienceProfileIds().slice(0, 2);
        const refused = await planCertificationLedger(sql, {
            ...planInput, profiles: [first, second], languages: ['es'],
        } as any).catch(error => error);
        expect(refused).toBeInstanceOf(CertificationPlanRefused);
        expect(refused.code).toBe('certification_subject_required');
        expect(refused.detail).toEqual([first, second].sort());
    }, 120000);

    it('names the subject of each profile, so one profile does not certify another', async () => {
        // Two profiles in one run. Each is a different template, so each has its
        // own configuration; evidence that cannot say which one it ran against
        // cannot certify either of them.
        const [first, second] = listCanonicalSubtypeExperienceProfileIds().slice(0, 2);
        const run = await planCertificationLedger(sql, {
            ...planInput, profiles: [first, second], languages: ['es'],
            subjects: {
                [first]: { agentId: randomUUID(), configHash: 'config-first', dependencyRevision: 'dep-first' },
                [second]: { agentId: randomUUID(), configHash: 'config-second', dependencyRevision: 'dep-second' },
            },
        } as any);
        for (;;) {
            const claim = await transaction(query => leaseCertificationCase(query, run.id));
            if (!claim.ok) break;
            await transaction(query => recordCertificationCase(query, claim.lease, result({
                scenario: { key: claim.lease.scenarioKey, profileId: claim.lease.profileId,
                    language: 'es', managedSeedKey: claim.lease.scenarioKey },
            })));
        }
        const evidence = await certificationEvidenceFromLedger(sql, run.id);
        const hashes = new Set(evidence.evidence.map(row => row.configHash));
        expect(hashes).toEqual(new Set(['config-first', 'config-second']));

        // Changing the first profile's template invalidates its evidence and
        // leaves the second's standing. A shared authority would take both.
        const narrowed = await certificationEvidenceFromLedger(sql, run.id, {
            subjects: { [first]: { configHash: 'config-first-edited' } },
        } as any);
        expect(narrowed.evidence.map(row => row.configHash)).toEqual(['config-second']);
        expect((narrowed as any).staleSubjects).toEqual([first]);
    }, 240000);
});
