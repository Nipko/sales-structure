import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from './prisma.service';

/**
 * The turn's database primitives through a REAL PgBouncer in transaction mode.
 *
 * Every other PostgreSQL suite in this repository talks straight to the server,
 * and the end-to-end turn harness says so in as many words: it can assert that
 * the code assumes no session state, but not that the proxy behaves the way the
 * code assumes. This suite is the other half. It runs against
 * `edoburu/pgbouncer` in `pool_mode = transaction` with `default_pool_size = 1`
 * pointed at the same disposable PostgreSQL, so every client here is funnelled
 * onto ONE server connection and the sharing is deterministic rather than
 * likely — which is what makes the leaks below reproducible instead of flaky.
 *
 * DDL keeps using the DIRECT url, exactly the way production splits
 * `DATABASE_URL` from `DIRECT_DATABASE_URL`.
 *
 * Set up with:
 *   docker network create parallly-eval-net
 *   docker network connect parallly-eval-net parallly-eval-55437
 *   docker run -d --name parallly-pgbouncer-55438 --network parallly-eval-net -p 55438:6432 \
 *     -e DB_HOST=parallly-eval-55437 -e DB_PORT=5432 -e DB_USER=postgres \
 *     -e DB_PASSWORD=... -e DB_NAME=parallly_eval_isolation \
 *     -e POOL_MODE=transaction -e AUTH_TYPE=scram-sha-256 \
 *     -e MAX_CLIENT_CONN=100 -e DEFAULT_POOL_SIZE=1 edoburu/pgbouncer:latest
 *   PARALLLY_PGBOUNCER_TEST_URL=postgresql://postgres:...@127.0.0.1:55438/parallly_eval_isolation?pgbouncer=true
 */
const pooledUrl = process.env.PARALLLY_PGBOUNCER_TEST_URL;
const directUrl = process.env.PARALLLY_ISOLATION_TEST_URL;
const ready = !!pooledUrl && !!directUrl;

(ready ? describe : describe.skip)('the tenant primitives through a real PgBouncer', () => {
    jest.setTimeout(120_000);

    const schema = `tenant_pgbouncer_${randomUUID().replace(/-/g, '')}`;
    let direct: Client;
    let pooled: PrismaClient;
    let prisma: any;

    /** A connection of its own, so "another client" really is another client. */
    const asClient = async <T>(fn: (client: Client) => Promise<T>): Promise<T> => {
        const client = new Client({ connectionString: pooledUrl });
        await client.connect();
        try { return await fn(client); } finally { await client.end(); }
    };

    beforeAll(async () => {
        for (const url of [pooledUrl!, directUrl!]) {
            const parsed = new URL(url);
            if (!['127.0.0.1', 'localhost'].includes(parsed.hostname)
                || !parsed.pathname.endsWith('_eval_isolation')) {
                throw new Error('disposable_loopback_database_required');
            }
        }
        // DDL on the direct connection, the way a migration runs.
        direct = new Client({ connectionString: directUrl });
        await direct.connect();
        await direct.query(`CREATE SCHEMA "${schema}"`);
        await direct.query(`CREATE TABLE "${schema}".probe(id UUID PRIMARY KEY, note TEXT)`);

        pooled = new PrismaClient({ datasourceUrl: pooledUrl });
        prisma = Object.create(PrismaService.prototype);
        prisma.$transaction = pooled.$transaction.bind(pooled);
        prisma.$queryRawUnsafe = pooled.$queryRawUnsafe.bind(pooled);
        prisma.$executeRawUnsafe = pooled.$executeRawUnsafe.bind(pooled);
    });

    afterAll(async () => {
        await pooled?.$disconnect().catch(() => undefined);
        if (!direct) return;
        try {
            if (!/^tenant_pgbouncer_[a-f0-9]{32}$/.test(schema)) throw new Error('invalid_cleanup_scope');
            await direct.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        } finally { await direct.end(); }
    });

    it('puts every client on one server connection, which is what the rest of this rests on', async () => {
        const pids = new Set<number>();
        for (let attempt = 0; attempt < 6; attempt++) {
            const [row] = await prisma.executeInTenantSchema(schema, 'SELECT pg_backend_pid()::int AS pid');
            pids.add(Number(row.pid));
        }
        expect(pids.size).toBe(1);
    });

    // ── what transaction pooling really does to session state ────────────────
    describe('session state is shared, not reset', () => {
        /**
         * `server_reset_query` is `DISCARD ALL` and it does NOT run here:
         * `server_reset_query_always` defaults to 0, so in transaction mode the
         * proxy hands the connection to the next client exactly as the last one
         * left it. Each of these is a real leak, and each is the reason for a
         * convention this codebase already follows.
         */
        it('carries a plain SET from one client into the next', async () => {
            await asClient(client => client.query("SET my.leak = 'from-the-first-client'"));
            const [row] = (await asClient(client =>
                client.query("SELECT current_setting('my.leak', true) AS value"))).rows;
            expect(row.value).toBe('from-the-first-client');
        });

        it('carries a temporary table from one client into the next', async () => {
            const table = `leak_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
            await asClient(client => client.query(`CREATE TEMP TABLE ${table}(id int)`));
            const [row] = (await asClient(client =>
                client.query('SELECT to_regclass($1)::text AS present', [`pg_temp.${table}`]))).rows;
            expect(String(row.present)).toContain(table);
        });

        /**
         * The one that decides an operational rule. `prisma migrate` takes a
         * SESSION advisory lock to keep two migrations apart. Through this proxy
         * that lock belongs to a connection several clients share: the next
         * client sees it held and — worse — can release a lock it never took.
         * That is why migrations run on `DIRECT_DATABASE_URL`, and it is a fact
         * about the proxy rather than about our SQL.
         */
        it('lets one client see, and release, a session advisory lock another client took', async () => {
            const key = Math.floor(Math.random() * 2_000_000_000);
            await asClient(client => client.query('SELECT pg_advisory_lock($1)', [key]));
            const [held] = (await asClient(client => client.query(
                `SELECT count(*)::int AS n FROM pg_locks
                  WHERE locktype='advisory' AND objid=$1 AND database=(SELECT oid FROM pg_database
                        WHERE datname=current_database())`, [key]))).rows;
            expect(Number(held.n)).toBe(1);
            const [released] = (await asClient(client =>
                client.query('SELECT pg_advisory_unlock($1) AS released', [key]))).rows;
            expect(released.released).toBe(true);
        });
    });

    // ── and what the turn's primitives do about it ───────────────────────────
    describe('the primitives the turn actually uses', () => {
        it('scopes the tenant search_path to its transaction, so the next client never sees it', async () => {
            const [inside] = await prisma.executeInTenantSchema(schema, 'SHOW search_path');
            expect(String(inside.search_path)).toContain(schema);
            // A different client, on the same server connection the leaks above
            // just showed is shared. `SET LOCAL` is the whole difference.
            const [after] = (await asClient(client => client.query('SHOW search_path'))).rows;
            expect(String(after.search_path)).not.toContain(schema);
        });

        it('refuses a multi-statement string on the primitive the turn uses', async () => {
            await expect(prisma.executeInTenantSchema(schema, 'SELECT 1 AS a; SELECT 2 AS b'))
                .rejects.toBeDefined();
            expect(await prisma.executeInTenantSchema(schema, 'SELECT 1 AS a')).toEqual([{ a: 1 }]);
        });

        it('leaves no advisory lock behind after a tenant transaction that took one', async () => {
            const row = randomUUID();
            await prisma.transactionInTenantSchema(schema, async (query: any) => {
                await query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text', [`agent-privacy:${schema}`]);
                await query('INSERT INTO probe(id, note) VALUES ($1::uuid, $2)', [row, 'dentro del lote']);
            });
            const [locks] = (await asClient(client => client.query(
                `SELECT count(*)::int AS held FROM pg_locks WHERE locktype='advisory'
                  AND database=(SELECT oid FROM pg_database WHERE datname=current_database())`))).rows;
            expect(Number(locks.held)).toBe(0);
            const [stored] = await prisma.executeInTenantSchema(schema,
                'SELECT note FROM probe WHERE id=$1::uuid', [row]);
            expect(stored.note).toBe('dentro del lote');
        });

        it('queues past a pool of one instead of refusing the work', async () => {
            // Twenty-five callers, one server connection. Transaction pooling is
            // supposed to make them wait, not fail: a rejection here would be a
            // customer turn lost to a burst.
            const notes = Array.from({ length: 25 }, (_, index) => `concurrente-${index}`);
            await Promise.all(notes.map(note => prisma.transactionInTenantSchema(schema, async (query: any) => {
                await query('INSERT INTO probe(id, note) VALUES ($1::uuid, $2)', [randomUUID(), note]);
                return query('SELECT pg_backend_pid()::int AS pid');
            })));
            const stored = await prisma.executeInTenantSchema(schema,
                "SELECT note FROM probe WHERE note LIKE 'concurrente-%' ORDER BY note");
            expect(stored.map((entry: any) => entry.note).sort()).toEqual([...notes].sort());
        });

        /**
         * The failure mode the `?pgbouncer=true` connection-string contract
         * exists for: a named prepared statement made on one server connection
         * colliding with the next client's. With Prisma 5.20's engine and the
         * raw primitive every tenant statement goes through, forty-eight
         * parameterised queries from six independent clients onto ONE server
         * connection do not produce it.
         *
         * Recorded as an observation, not as permission to drop the flag: it
         * covers `$queryRawUnsafe` and says nothing about the typed client used
         * for global tables, or about a future engine.
         */
        it('runs the tenant primitive concurrently without a prepared-statement collision', async () => {
            const clients = Array.from({ length: 6 }, () => new PrismaClient({ datasourceUrl: pooledUrl }));
            try {
                const rows = await Promise.all(clients.flatMap((client, index) =>
                    Array.from({ length: 8 }, (_, attempt) => client.$queryRawUnsafe(
                        'SELECT $1::int AS client, $2::text AS attempt, pg_backend_pid()::int AS pid',
                        index, `intento-${attempt}`) as Promise<any[]>)));
                expect(rows).toHaveLength(48);
                expect(new Set(rows.map(([row]) => Number(row.pid))).size).toBe(1);
            } finally {
                await Promise.all(clients.map(client => client.$disconnect().catch(() => undefined)));
            }
        });
    });
});
