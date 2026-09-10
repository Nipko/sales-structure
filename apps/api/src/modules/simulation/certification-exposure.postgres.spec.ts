import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { listCanonicalSubtypeExperienceProfileIds } from '@parallext/shared';
import {
    ensureCertificationLedger, leaseCertificationCase, planCertificationLedger,
    recordCertificationCase, retryCertificationCase,
    type CertificationCaseResult, type CertificationQuery,
} from './certification-ledger';
import { USAGE_UNKNOWN } from './eval-gate-result';
import { isDisposableDatabase } from '../../common/__fixtures__/disposable-database';

const connection = process.env.PARALLLY_ISOLATION_TEST_URL;
const profileId = listCanonicalSubtypeExperienceProfileIds()[0];

/**
 * ═══ THE CEILING THAT REFILLED, AND THE RETRY THAT RESERVED NOTHING ═══
 *
 * Two accounting defects, both reproduced from a static reading and both only
 * provable against a real database, because both are about what a SUM sees.
 *
 * **The ceiling refilled.** `recordCertificationCase` released the reservation
 * and wrote `cost_usd_cents` from a field the runner always filled with 0 — the
 * gate reports no usage. So a case that had really been run came back as spent
 * nothing, `committed` dropped by the whole reservation, and the next case was
 * leased under a budget that had gone back up after money was already gone. Over
 * a 233-hour run that is not a rounding error; it is the ceiling not existing.
 *
 * **The retry reserved nothing.** `retryCertificationCase` inserted a new
 * attempt without `reserve_usd_cents`, and the column defaults to 0. The lease
 * selector compares that reservation against what is left, so a second attempt
 * was claimable under any remaining budget — including none. The ceiling held
 * for first attempts and stopped existing from the second onwards.
 */
(connection ? describe : describe.skip)('certification exposure on disposable PostgreSQL', () => {
    let pool: Pool;
    const schema = `cert_exposure_${randomUUID().replace(/-/g, '')}`;
    const agentId = randomUUID();

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
        passed: true, servedModel: 'gpt-4.1-mini', usage: { state: 'reported', costUsdCents: 1 },
        latencyMs: 10, transcript: [], tools: [], verification: { passed: true }, scenario: {}, ...over,
    });

    /** A fresh run with one case per scenario, at a known reservation each. */
    const startRun = async (budgetUsdCents: number) => {
        const record = await transaction(query => planCertificationLedger(query, {
            agentId, configHash: 'config-1', dependencyRevision: 'dependency-1',
            profiles: [profileId], languages: ['es'], channels: ['whatsapp'], models: ['gpt-4.1-mini'],
            mode: 'live', budgetUsdCents, deadlineAt: null,
        } as any));
        return String((record as any).id ?? (record as any).runId);
    };

    /**
     * A read of the two halves the ledger adds up.
     *
     * Used only to SHOW a number in the reported-cost case. Never to assert the
     * ceiling: that assertion goes through `leaseCertificationCase`, because a
     * test that recomputes the query under test agrees with itself.
     */
    const budgetView = async (runId: string) => {
        const [row] = await sql<any[]>(
            `SELECT (SELECT COALESCE(SUM(COALESCE(cost_usd_cents, reserve_usd_cents)),0)::int
                       FROM agent_certification_cases
                      WHERE run_id = $1::uuid AND state IN ('passed','failed','error')) AS spent,
                    (SELECT COALESCE(SUM(reserve_usd_cents),0)::int FROM agent_certification_cases
                      WHERE run_id = $1::uuid AND state = 'leased'
                        AND (lease_expires_at IS NULL OR lease_expires_at >= clock_timestamp())) AS reserved`,
            [runId]);
        return { spent: Number(row.spent), reserved: Number(row.reserved) };
    };

    beforeAll(async () => {
        if (!isDisposableDatabase(connection)) throw new Error('disposable_loopback_database_required');
        pool = new Pool({ connectionString: connection, max: 4 });
        const client = await pool.connect();
        try { await client.query(`CREATE SCHEMA "${schema}"`); } finally { client.release(); }
        await transaction(query => ensureCertificationLedger(query));
    }, 120_000);

    afterAll(async () => {
        if (!pool) return;
        if (/^cert_exposure_[a-f0-9]{32}$/.test(schema)) {
            const client = await pool.connect();
            try { await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); } finally { client.release(); }
        }
        await pool.end();
    });

    it('writes an unreported cost as NULL rather than as a measured zero', async () => {
        const runId = await startRun(100_000);
        const lease = await transaction(query => leaseCertificationCase(query, runId, 900));
        expect(lease.ok).toBe(true);
        await transaction(query => recordCertificationCase(
            query, (lease as any).lease, result({ usage: USAGE_UNKNOWN })));
        const [row] = await sql<any[]>(
            'SELECT state, cost_usd_cents FROM agent_certification_cases WHERE id=$1::uuid',
            [(lease as any).lease.caseId]);
        // NULL, not 0. Zero is a measurement; this is the absence of one.
        expect(row.cost_usd_cents).toBeNull();
        expect(row.state).toBe('passed');
    }, 120_000);

    it('does not hand out another case after one whose cost nobody reported', async () => {
        // The assertion that actually holds the ceiling, and it has to be made
        // THROUGH the ledger. An earlier version of this test recomputed the
        // budget SUM itself and therefore passed while the ledger's own query
        // was mutated back to the broken one — a test agreeing with its own
        // copy of the thing under test.
        //
        // So: a budget with room for exactly one case, spent on a case whose
        // price never came back. If the exposure is retained, the next lease is
        // refused. If it is not, the ceiling has silently refilled.
        const runId = await startRun(100_000);
        const first = await transaction(query => leaseCertificationCase(query, runId, 900));
        const reserve = Number((await sql<any[]>(
            'SELECT reserve_usd_cents FROM agent_certification_cases WHERE id=$1::uuid',
            [(first as any).lease.caseId]))[0].reserve_usd_cents);
        expect(reserve).toBeGreaterThan(0);

        await transaction(query => recordCertificationCase(
            query, (first as any).lease, result({ usage: USAGE_UNKNOWN })));
        await sql('UPDATE agent_certification_runs SET budget_usd_cents=$2 WHERE id=$1::uuid', [runId, reserve]);

        const next = await transaction(query => leaseCertificationCase(query, runId, 900));
        expect(next.ok).toBe(false);
        expect((next as any).stopReason).toBe('budget_exhausted');
    }, 120_000);

    it('counts a reported cost as itself, and a genuine zero as zero', async () => {
        const runId = await startRun(100_000);
        const lease = await transaction(query => leaseCertificationCase(query, runId, 900));
        await transaction(query => recordCertificationCase(
            query, (lease as any).lease, result({ usage: { state: 'reported', costUsdCents: 7 } })));
        expect((await budgetView(runId)).spent).toBe(7);

        const second = await transaction(query => leaseCertificationCase(query, runId, 900));
        await transaction(query => recordCertificationCase(
            query, (second as any).lease, result({ usage: { state: 'reported', costUsdCents: 0 } })));
        // A measured zero really is zero: the point is not to inflate, it is to
        // stop an absence being read as one.
        expect((await budgetView(runId)).spent).toBe(7);
    }, 120_000);

    it('gives a retry the reservation its first attempt had', async () => {
        const runId = await startRun(100_000);
        const lease = await transaction(query => leaseCertificationCase(query, runId, 900));
        const caseKey = (lease as any).lease.caseKey;
        const firstReserve = Number((await sql<any[]>(
            'SELECT reserve_usd_cents FROM agent_certification_cases WHERE id=$1::uuid',
            [(lease as any).lease.caseId]))[0].reserve_usd_cents);
        await transaction(query => recordCertificationCase(
            query, (lease as any).lease, result({ passed: false, usage: { state: 'reported', costUsdCents: 1 } })));

        const retried = await transaction(query => retryCertificationCase(query, runId, caseKey));
        expect(retried.ok).toBe(true);

        const [attempt] = await sql<any[]>(
            `SELECT attempt, reserve_usd_cents, state FROM agent_certification_cases
              WHERE run_id=$1::uuid AND case_key=$2 ORDER BY attempt DESC LIMIT 1`, [runId, caseKey]);
        expect(Number(attempt.attempt)).toBe(2);
        // Before: 0, from the column default. A second attempt was therefore
        // claimable under any remaining budget, including none.
        expect(Number(attempt.reserve_usd_cents)).toBe(firstReserve);
    }, 120_000);

    it('refuses to lease a retry that would not fit, which the old default made impossible', async () => {
        // A budget just big enough for one case. The first attempt fits, spends,
        // fails; the retry costs the same and must NOT be handed out.
        const runId = await startRun(100_000);
        const first = await transaction(query => leaseCertificationCase(query, runId, 900));
        const caseKey = (first as any).lease.caseKey;
        const reserve = Number((await sql<any[]>(
            'SELECT reserve_usd_cents FROM agent_certification_cases WHERE id=$1::uuid',
            [(first as any).lease.caseId]))[0].reserve_usd_cents);

        await transaction(query => recordCertificationCase(
            query, (first as any).lease, result({ passed: false, usage: { state: 'reported', costUsdCents: reserve } })));
        await transaction(query => retryCertificationCase(query, runId, caseKey));

        // Shrink the ceiling to exactly what has already been spent, so nothing
        // with a real reservation can be leased.
        await sql('UPDATE agent_certification_runs SET budget_usd_cents=$2 WHERE id=$1::uuid', [runId, reserve]);
        const claim = await transaction(query => leaseCertificationCase(query, runId, 900));
        expect(claim.ok).toBe(false);
        expect((claim as any).stopReason).toBe('budget_exhausted');
    }, 120_000);
});
