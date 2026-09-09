import { randomUUID } from 'crypto';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from './prisma.service';

/**
 * The additive migrations of this programme, applied WHILE the turn is writing.
 *
 * The deploy migrates before it recreates containers, so the old code runs
 * against the new schema for minutes — which is why every migration here is
 * expand-contract and additive. That is a claim about behaviour under traffic,
 * and until now it was only ever checked on an idle database: apply, look at the
 * columns, done. An idle `CREATE TABLE` proves nothing about the one that has to
 * wait behind an open transaction.
 *
 * So this runs the six shipped migration files, verbatim, against eight tenant
 * schemas built from `prisma/tenant-schema.sql`, while writers keep doing what a
 * turn does — insert the customer's message, touch the conversation, read the
 * history back — and asserts three things a migration must never do to a
 * customer mid-flight:
 *
 *   · fail any write that was in progress,
 *   · lose any row that was written while it ran,
 *   · leave a schema half-migrated.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ITS OWN DATABASE, ON PURPOSE
 * ─────────────────────────────────────────────────────────────────────────────
 * These migrations iterate `public.tenants` and touch EVERY schema named there.
 * On the shared eval database that would mean reaching into whatever suite is
 * running beside this one — harmless in itself, since every statement is
 * `IF NOT EXISTS`, but it would still take an ACCESS EXCLUSIVE lock on a
 * neighbour's tables and could create a table a neighbour is asserting is
 * absent. A separate database is the only honest way to run the file verbatim.
 *
 *   docker exec parallly-eval-55437 psql -U postgres \
 *     -c 'CREATE DATABASE parallly_migration_eval_isolation'
 *   docker exec parallly-eval-55437 psql -U postgres -d parallly_migration_eval_isolation \
 *     -c 'CREATE EXTENSION IF NOT EXISTS "uuid-ossp"'
 *   PARALLLY_MIGRATION_TEST_URL=postgresql://postgres:...@127.0.0.1:55437/parallly_migration_eval_isolation
 */
const url = process.env.PARALLLY_MIGRATION_TEST_URL;

/** Enough schemas that the migration's loop is a loop, not a special case. */
const TENANTS = 8;
/** Concurrent writers, each on its own connection, across those schemas. */
const WRITERS = 6;

(url ? describe : describe.skip)('the additive migrations, applied under load', () => {
    jest.setTimeout(180_000);

    const schemas = Array.from({ length: TENANTS },
        () => `tenant_migload_${randomUUID().replace(/-/g, '')}`);
    const tenantIds = schemas.map(() => randomUUID());
    const conversations = new Map<string, { conversationId: string; contactId: string }>();

    let admin: Client;
    let prisma: any;
    let migrations: { name: string; sql: string }[];

    beforeAll(async () => {
        const parsed = new URL(url!);
        if (!['127.0.0.1', 'localhost'].includes(parsed.hostname)
            || !parsed.pathname.endsWith('_eval_isolation')) {
            throw new Error('disposable_loopback_database_required');
        }
        admin = new Client({ connectionString: url });
        await admin.connect();

        // The global table the migrations read to find the tenants.
        await admin.query(`CREATE TABLE IF NOT EXISTS public.tenants(
            id UUID PRIMARY KEY, schema_name TEXT NOT NULL UNIQUE)`);

        const template = readFileSync(join(__dirname, '../../../prisma/tenant-schema.sql'), 'utf8');
        const slice = template.slice(
            template.indexOf('-- ---- Contacts ----'),
            template.indexOf('-- ---- Consent Records ----'));
        for (const [index, schema] of schemas.entries()) {
            await admin.query(`CREATE SCHEMA "${schema}"`);
            for (const statement of (PrismaService.prototype as any).splitSqlStatements(
                slice.replace(/\{\{SCHEMA_NAME\}\}/g, schema))) {
                await admin.query(statement);
            }
            await admin.query('INSERT INTO public.tenants(id, schema_name) VALUES($1::uuid, $2)',
                [tenantIds[index], schema]);
            const contactId = randomUUID(), conversationId = randomUUID();
            await admin.query(
                `INSERT INTO "${schema}".contacts(id, channel_type, external_id, name)
                 VALUES($1::uuid, 'whatsapp', $2, 'Cliente de carga')`, [contactId, `pre-${contactId}`]);
            await admin.query(
                `INSERT INTO "${schema}".conversations(id, contact_id, channel_type, channel_account_id, status)
                 VALUES($1::uuid, $2::uuid, 'whatsapp', $3, 'active')`,
                [conversationId, contactId, `pnid-${index}`]);
            conversations.set(schema, { conversationId, contactId });
        }

        // The shipped files, read in the order `prisma migrate` would apply them.
        const root = join(__dirname, '../../../prisma/migrations');
        migrations = readdirSync(root)
            .filter(entry => /^\d{14}_/.test(entry))
            .sort()
            .map(entry => ({ name: entry, sql: readFileSync(join(root, entry, 'migration.sql'), 'utf8') }))
            .filter(entry => entry.name >= '20260908180000');
        expect(migrations.length).toBeGreaterThanOrEqual(6);

        const client = new PrismaClient({ datasourceUrl: url });
        prisma = Object.create(PrismaService.prototype);
        prisma.$transaction = client.$transaction.bind(client);
        prisma.$queryRawUnsafe = client.$queryRawUnsafe.bind(client);
        prisma.$executeRawUnsafe = client.$executeRawUnsafe.bind(client);
        prisma.__client = client;
    });

    afterAll(async () => {
        await prisma?.__client?.$disconnect().catch(() => undefined);
        if (!admin) return;
        try {
            for (const schema of schemas) {
                if (!/^tenant_migload_[a-f0-9]{32}$/.test(schema)) throw new Error('invalid_cleanup_scope');
                await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
            }
            await admin.query('DELETE FROM public.tenants WHERE schema_name = ANY($1::text[])', [schemas]);
        } finally { await admin.end(); }
    });

    it('applies every migration while the turn keeps writing, and loses nothing', async () => {
        let running = true;
        const failures: { schema: string; error: string }[] = [];
        const written = new Map<string, string[]>(schemas.map(schema => [schema, []]));
        /** The slowest single write observed, which is where a lock wait shows up. */
        let slowestWriteMs = 0;

        // The workload: what a turn does to these three tables, over and over,
        // through the same primitive production uses — its own transaction with
        // `SET LOCAL search_path`, so each one is a real candidate to be caught
        // mid-flight by an ACCESS EXCLUSIVE lock.
        const writer = async (index: number) => {
            // Round robin from a different offset per writer, so every schema is
            // being written to when the migration reaches it — a schema nobody
            // was touching would prove nothing about a lock.
            let round = 0;
            while (running) {
                const schema = schemas[(index + round++) % schemas.length];
                const { conversationId, contactId } = conversations.get(schema)!;
                const externalId = `load-${randomUUID()}`;
                const started = Date.now();
                try {
                    await prisma.transactionInTenantSchema(schema, async (query: any) => {
                        await query(
                            `INSERT INTO messages(conversation_id, direction, content_type, content_text,
                                status, external_id)
                             VALUES($1::uuid, 'inbound', 'text', $2, 'delivered', $3)`,
                            [conversationId, 'mensaje bajo migración', externalId]);
                        await query('UPDATE conversations SET updated_at = NOW() WHERE id = $1::uuid',
                            [conversationId]);
                        await query(
                            `SELECT id FROM messages WHERE conversation_id = $1::uuid
                              ORDER BY created_at DESC LIMIT 5`, [conversationId]);
                        await query('SELECT id FROM contacts WHERE id = $1::uuid', [contactId]);
                    });
                    written.get(schema)!.push(externalId);
                } catch (error: any) {
                    failures.push({ schema, error: String(error?.message || error) });
                }
                slowestWriteMs = Math.max(slowestWriteMs, Date.now() - started);
            }
        };

        const load = Array.from({ length: WRITERS }, (_, index) => writer(index));
        // Let the load actually be load, on every schema, before the migration
        // starts: the point is to catch writes in flight, not to race the setup.
        while (Array.from(written.values()).some(list => list.length < 5)) {
            await new Promise(resolve => setTimeout(resolve, 25));
        }

        const applied: { name: string; ms: number }[] = [];
        for (const migration of migrations) {
            const started = Date.now();
            await admin.query(migration.sql);
            applied.push({ name: migration.name, ms: Date.now() - started });
        }

        // Keep writing after the last migration too: the old code runs against
        // the new schema for minutes in a real deploy, and that half of
        // expand-contract deserves the same load as the first.
        await new Promise(resolve => setTimeout(resolve, 1_500));
        running = false;
        await Promise.all(load);

        // 1. Nothing in flight failed.
        expect(failures).toEqual([]);

        // 2. Nothing written during the migration was lost, in any schema.
        for (const schema of schemas) {
            const ids = written.get(schema)!;
            expect(ids.length).toBeGreaterThan(0);
            const [row] = (await admin.query(
                `SELECT count(*)::int AS stored FROM "${schema}".messages WHERE external_id = ANY($1::text[])`,
                [ids])).rows;
            expect(Number(row.stored)).toBe(ids.length);
        }

        // 3. Every schema is fully migrated, not half.
        for (const schema of schemas) {
            const { rows } = await admin.query(
                `SELECT table_name FROM information_schema.tables WHERE table_schema = $1`, [schema]);
            const tables = new Set(rows.map(entry => String(entry.table_name)));
            for (const table of ['agent_turn_ledger', 'agent_handoff_effects', 'agent_dispatch_resolutions',
                'learning_sources', 'learning_releases', 'agent_content_proposals']) {
                expect(tables.has(table)).toBe(true);
            }
        }

        // 4. And applying them again changes nothing — the deploy that retries
        //    after a network blip must not be a different deploy.
        for (const migration of migrations) await admin.query(migration.sql);
        for (const schema of schemas) {
            const ids = written.get(schema)!;
            const [row] = (await admin.query(
                `SELECT count(*)::int AS stored FROM "${schema}".messages WHERE external_id = ANY($1::text[])`,
                [ids])).rows;
            expect(Number(row.stored)).toBe(ids.length);
        }

        // Recorded rather than asserted: a lock wait is a delay, and the number
        // that matters is that none of them became a failure, which is asserted
        // above. Printing it is how a change in that shape gets noticed.
        // eslint-disable-next-line no-console
        console.log(`[migration-under-load] ${applied.length} migrations, `
            + `${applied.map(entry => `${entry.name.slice(0, 14)}=${entry.ms}ms`).join(' ')}; `
            + `${Array.from(written.values()).reduce((sum, list) => sum + list.length, 0)} writes across `
            + `${TENANTS} schemas, slowest ${slowestWriteMs}ms, 0 failed`);
    });

    it('leaves the old read path working on the new schema', async () => {
        // Expand-contract's actual promise: the code that shipped BEFORE the
        // migration keeps working after it, because nothing was renamed, dropped
        // or narrowed. The statements below are the ones the pre-migration turn
        // ran, unchanged.
        for (const schema of schemas) {
            const { conversationId } = conversations.get(schema)!;
            const history = await prisma.executeInTenantSchema(schema,
                `SELECT id, direction, content_type, content_text, status, external_id
                   FROM messages WHERE conversation_id = $1::uuid ORDER BY created_at DESC LIMIT 3`,
                [conversationId]);
            expect(history.length).toBeGreaterThan(0);
            expect(history[0]).toHaveProperty('external_id');
        }
    });
});
