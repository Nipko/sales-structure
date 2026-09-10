import { Client } from 'pg';
import { ensureSyntheticGlobalTables } from './src/common/__fixtures__/synthetic-global-tables';

/**
 * One PostgreSQL database per Jest worker, made fresh for every run — and
 * provisioned, not left for whichever suite happens to run first.
 *
 * Every PostgreSQL suite used to share ONE database, so `public.tenants`,
 * `public.users`, advisory locks and the catalog were shared state between
 * whichever two suites ran at the same time. That produced order sensitivity: a
 * suite would fail once every few full runs and pass in isolation.
 *
 * Sharing the database is what created the concurrency; there is none inside a
 * worker, because Jest runs one file at a time in it. So a database per worker
 * removes the interference in one place instead of in sixty specs.
 *
 * Splitting it exposed the other half of the same coupling. The synthetic global
 * tables were created by whichever suite got there first — `ensureSyntheticGlobalTables`
 * says so in its own header — and a dozen suites simply INSERT into
 * `public.tenants` assuming a neighbour already made it. On a fresh database
 * that is a `42P01`, and which suites hit it depends on the file order, which is
 * the very thing this file exists to stop mattering. So the tables are created
 * with the database, once, before any worker starts.
 *
 * Dropped and recreated each run, so a run never inherits the rows of the one
 * before it either. Skipped entirely when no disposable database is configured,
 * which is how the suite stays runnable with no database at all.
 */

/** Databases whose suites share global tables and therefore need splitting. */
export const SHARED_URL_VARS = [
    'PARALLLY_ISOLATION_TEST_URL',
    'AGENT_RELEASE_TEST_DATABASE_URL',
    'AGENT_REVISION_TEST_DATABASE_URL',
    'CATALOG_ORDERS_TEST_DATABASE_URL',
    'REPAIR_ORDERS_TEST_DATABASE_URL',
    'OPERATIONAL_NOTICE_REVIEW_TEST_DATABASE_URL',
    'KNOWLEDGE_MEMORY_TEST_DATABASE_URL',
    'KNOWLEDGE_TEST_DATABASE_URL',
    'LEARNING_EVIDENCE_TEST_DATABASE_URL',
    'KNOWLEDGE_CONFLICT_TEST_DATABASE_URL',
    'DATABASE_URL',
];

/** Extensions every tenant schema in this repository assumes. */
const EXTENSIONS = ['CREATE EXTENSION IF NOT EXISTS "uuid-ossp"', 'CREATE EXTENSION IF NOT EXISTS vector'];

/**
 * The worker's copy KEEPS the `_eval_isolation` suffix, because every spec here
 * refuses a database whose name does not end in it — on purpose, so a run can
 * never point at a shared or production instance. The worker number goes in
 * front of the suffix rather than after it.
 */
export const workerDatabaseName = (name: string, worker: number): string =>
    `${name.replace(/_eval_isolation$/, '')}_w${worker}_eval_isolation`;

/** The distinct base databases named by the environment, loopback only. */
function baseDatabases(): Map<string, string> {
    const found = new Map<string, string>();
    for (const variable of SHARED_URL_VARS) {
        const value = process.env[variable];
        if (!value) continue;
        let parsed: URL;
        try { parsed = new URL(value); } catch { continue; }
        if (!['127.0.0.1', 'localhost'].includes(parsed.hostname)) continue;
        const name = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
        if (!name.endsWith('_eval_isolation')) continue;
        if (!found.has(name)) found.set(name, value);
    }
    return found;
}

export default async function globalSetup(globalConfig?: { maxWorkers?: number }): Promise<void> {
    const bases = baseDatabases();
    if (!bases.size) return;
    const workers = Math.max(1, Number(globalConfig?.maxWorkers) || 1);
    const created: string[] = [];

    for (const [name, sample] of bases) {
        const maintenance = new URL(sample);
        maintenance.pathname = '/postgres';
        const admin = new Client({ connectionString: maintenance.toString() });
        await admin.connect();
        try {
            // Two runs at once are destructive, not merely slow: this drops and
            // recreates the worker databases, so a second run pulls them out
            // from under the first and the first fails in ways that look like
            // product defects. Refuse instead of racing.
            const busy = await admin.query(
                `SELECT count(*)::int AS n FROM pg_stat_activity
                  WHERE datname LIKE $1 AND pid <> pg_backend_pid()`,
                [`${name.replace(/_eval_isolation$/, '')}_w%_eval_isolation`]);
            if (Number(busy.rows[0]?.n ?? 0) > 0) {
                throw new Error(`another_jest_run_is_using_${name}: `
                    + 'these databases are dropped and recreated per run, so two runs cannot share them');
            }
            for (let worker = 1; worker <= workers; worker++) {
                const database = workerDatabaseName(name, worker);
                if (!/^[a-z0-9_]{1,63}$/.test(database)) throw new Error(`unsafe_worker_database:${database}`);
                // FORCE so a connection left over from an interrupted run cannot
                // make the next one inherit its rows.
                await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
                await admin.query(`CREATE DATABASE "${database}" TEMPLATE template0`);
                created.push(database);
            }
        } finally { await admin.end(); }

        for (let worker = 1; worker <= workers; worker++) {
            const target = new URL(sample);
            target.pathname = `/${workerDatabaseName(name, worker)}`;
            const client = new Client({ connectionString: target.toString() });
            await client.connect();
            try {
                for (const statement of EXTENSIONS) {
                    // pgvector is only installed on one of the two instances; a
                    // database that cannot have it still gets uuid-ossp.
                    await client.query(statement).catch(() => undefined);
                }
                // The scaffolding a dozen suites INSERT into without creating.
                await ensureSyntheticGlobalTables(sql => client.query(sql));
            } finally { await client.end(); }
        }
    }

    // eslint-disable-next-line no-console
    console.log(`[jest] one database per worker: ${created.join(', ')}`);
}
