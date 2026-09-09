/**
 * One PostgreSQL database per Jest worker, made fresh for every run.
 *
 * Every PostgreSQL suite in this repository used to share ONE database, so
 * `public.tenants`, `public.users`, advisory locks and the catalog were shared
 * state between whichever two suites happened to be running at the same time.
 * The result was order sensitivity: a suite would fail once every few full runs
 * and pass in isolation, which is the shape of a bug nobody can chase.
 *
 * Sharing a database is what made the concurrency; there is no concurrency
 * inside a worker, because Jest runs one test file at a time in it. So a
 * database per worker removes the interference completely rather than papering
 * over it, and it does it in one place instead of in sixty specs.
 *
 * Dropped and recreated each run, so a run never inherits the rows a previous
 * one left behind either. Skipped entirely when no disposable database is
 * configured, which is how the suite stays runnable with no database at all.
 */
const { Client } = require('pg');

/** Databases whose suites share global tables and therefore need splitting. */
const SHARED_URL_VARS = [
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
 * The worker's copy KEEPS the `_eval_isolation` suffix, because every spec in
 * this repository refuses a database whose name does not end in it — on purpose,
 * so a run can never point at a shared or production instance. The worker number
 * goes in front of the suffix rather than after it.
 */
const workerDatabaseName = (name, worker) =>
    `${name.replace(/_eval_isolation$/, '')}_w${worker}_eval_isolation`;

/** The distinct base databases named by the environment, loopback only. */
function baseDatabases() {
    const found = new Map();
    for (const variable of SHARED_URL_VARS) {
        const value = process.env[variable];
        if (!value) continue;
        let parsed;
        try { parsed = new URL(value); } catch { continue; }
        if (!['127.0.0.1', 'localhost'].includes(parsed.hostname)) continue;
        const name = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
        if (!name.endsWith('_eval_isolation')) continue;
        if (!found.has(name)) found.set(name, value);
    }
    return found;
}

module.exports = async function globalSetup(globalConfig) {
    const bases = baseDatabases();
    if (!bases.size) return;
    const workers = Math.max(1, Number(globalConfig?.maxWorkers) || 1);
    const created = [];

    for (const [name, sample] of bases) {
        const maintenance = new URL(sample);
        maintenance.pathname = '/postgres';
        const client = new Client({ connectionString: maintenance.toString() });
        await client.connect();
        try {
            for (let worker = 1; worker <= workers; worker++) {
                const database = workerDatabaseName(name, worker);
                if (!/^[a-z0-9_]{1,63}$/.test(database)) throw new Error(`unsafe_worker_database:${database}`);
                // FORCE so a connection left over from an interrupted run cannot
                // make the next one inherit its rows.
                await client.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
                await client.query(`CREATE DATABASE "${database}" TEMPLATE template0`);
                created.push(database);
            }
        } finally { await client.end(); }

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
            } finally { await client.end(); }
        }
    }

    // eslint-disable-next-line no-console
    console.log(`[jest] one database per worker: ${created.join(', ')}`);
};

module.exports.SHARED_URL_VARS = SHARED_URL_VARS;
module.exports.workerDatabaseName = workerDatabaseName;
