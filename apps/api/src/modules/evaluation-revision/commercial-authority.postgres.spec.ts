import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { EvaluationRevisionService } from './evaluation-revision.service';
import { serviceCatalogCaptureDatabase } from './evaluation-service-catalog-capture';
import { resolveStructuredKnowledgeCapture, structuredKnowledgeRelation } from './evaluation-structured-knowledge';
import { commercialOnly } from './commercial-reader-inventory';
import { AGENT_TEST_EXECUTION_CONTEXT } from '../../common/types/execution-context';
import { isDisposableDatabaseUrl } from '../../common/__fixtures__/disposable-database';
import { LoadMetrics } from '../../common/__fixtures__/load-metrics';

/**
 * A commercial answer, and whether anything can move underneath it unnoticed.
 *
 * The inventory next door computes WHICH reads decide a price, a stock level, a
 * policy or an entitlement, and which of them have a frozen authority behind
 * them. This is the other half: proving the freezing actually holds when the
 * tenant is editing the catalogue at the same time as the evaluation is reading
 * it, which is the only condition under which it matters.
 *
 * What "frozen" has to mean, tested rather than asserted:
 *
 *   · a price edited during the run makes the result REFUSE, naming the table.
 *     Not silently re-measure, and not quietly pass — a result that cannot say
 *     which price it was measured against is not evidence of anything;
 *   · the same for stock, for a policy and for the terms of an offer, because
 *     they fail in different tables and a guard that only covers the catalogue
 *     leaves the other three;
 *   · one tenant's edit does not invalidate another tenant's evidence. Two
 *     businesses on one platform is the normal case, and a shared invalidation
 *     would make every tenant's evaluation expire on their neighbour's edits;
 *   · two workers capturing the same unchanged tenant agree, and a retry after
 *     the change gets a NEW revision without the old one quietly becoming valid
 *     again;
 *   · a reader that goes to the live table instead of the sealed copy is
 *     refused. That is the legacy path, and it is the one that would make all
 *     of the above decorative.
 */

const connection = process.env.PARALLLY_ISOLATION_TEST_URL;

(connection ? describe : describe.skip)('what a commercial answer was measured against', () => {
    jest.setTimeout(180_000);

    const metrics = new LoadMetrics('commercial authority under concurrent edits');
    const tenants = [0, 1].map(() => ({
        tenantId: randomUUID(),
        schema: `tenant_commercial_${randomUUID().replace(/-/g, '')}`,
    }));
    let pool: any;
    let service: EvaluationRevisionService;

    const query = async (sql: string, params: any[] = []) => (await pool.query(sql, params)).rows;

    beforeAll(async () => {
        const url = new URL(connection!);
        if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !isDisposableDatabaseUrl(url)) {
            throw new Error('disposable_eval_database_required');
        }
        pool = new Pool({ connectionString: connection, max: 8 });
        await query('CREATE TABLE IF NOT EXISTS public.tenants(id uuid PRIMARY KEY,schema_name text NOT NULL)');
        for (const tenant of tenants) {
            await query('INSERT INTO public.tenants(id,schema_name) VALUES($1::uuid,$2)', [tenant.tenantId, tenant.schema]);
            await query(`CREATE SCHEMA "${tenant.schema}"`);
            // The four commercial shapes, each in its own table, because they
            // fail in different places: the catalogue price, the stock level,
            // the policy text and the window an offer is valid in.
            await query(`CREATE TABLE "${tenant.schema}".services(
                id uuid PRIMARY KEY, name text NOT NULL, price numeric NOT NULL, currency text NOT NULL,
                is_active boolean NOT NULL DEFAULT true)`);
            await query(`CREATE TABLE "${tenant.schema}".products(
                id uuid PRIMARY KEY, name text NOT NULL, price numeric NOT NULL, stock integer NOT NULL)`);
            // The full canonical column set, because `captureStructuredKnowledge`
            // seals exactly these and a narrower table would answer `absent` —
            // which would make the seal tests below pass by measuring nothing.
            await query(`CREATE TABLE "${tenant.schema}".policies(
                id uuid PRIMARY KEY, type text NOT NULL, title text NOT NULL, content text NOT NULL,
                version integer NOT NULL DEFAULT 1, effective_from timestamp, effective_to timestamp,
                is_active boolean NOT NULL DEFAULT true,
                created_at timestamp NOT NULL DEFAULT NOW(), updated_at timestamp NOT NULL DEFAULT NOW())`);
            await query(`CREATE TABLE "${tenant.schema}".faqs(
                id uuid PRIMARY KEY, question text NOT NULL, answer text NOT NULL, category text,
                tags text[], order_index integer, is_published boolean NOT NULL DEFAULT true,
                views integer NOT NULL DEFAULT 0, search_tsv tsvector,
                created_at timestamp NOT NULL DEFAULT NOW(), updated_at timestamp NOT NULL DEFAULT NOW())`);
            await query(`CREATE TABLE "${tenant.schema}".commercial_offers(
                id uuid PRIMARY KEY, title text NOT NULL, discount_percent integer NOT NULL,
                valid_from date, valid_to date)`);
            await query(`INSERT INTO "${tenant.schema}".services VALUES($1::uuid,'Corte',45000,'COP',true)`, [randomUUID()]);
            await query(`INSERT INTO "${tenant.schema}".products VALUES($1::uuid,'Shampoo',32000,7)`, [randomUUID()]);
            await query(`INSERT INTO "${tenant.schema}".policies(id,type,title,content)
                VALUES($1::uuid,'terms','Condiciones','Cancelás hasta 48 horas antes.')`, [randomUUID()]);
            await query(`INSERT INTO "${tenant.schema}".faqs(id,question,answer)
                VALUES($1::uuid,'¿Cuánto sale el corte?','Cuarenta y cinco mil pesos.')`, [randomUUID()]);
            await query(`INSERT INTO "${tenant.schema}".commercial_offers VALUES($1::uuid,'2x1 martes',50,'2026-01-01','2026-12-31')`, [randomUUID()]);
        }
        const prisma = {
            $transaction: async (work: any, options: any) => {
                const client = await pool.connect();
                await client.query(`BEGIN ISOLATION LEVEL ${options?.isolationLevel === 'RepeatableRead' ? 'REPEATABLE READ' : 'READ COMMITTED'}`);
                try {
                    const result = await work({
                        $queryRawUnsafe: async (sql: string, ...params: any[]) => (await client.query(sql, params)).rows,
                        $executeRawUnsafe: async (sql: string, ...params: any[]) => (await client.query(sql, params)).rowCount,
                    });
                    await client.query('COMMIT');
                    return result;
                } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
            },
        };
        service = new EvaluationRevisionService(prisma as any,
            { evaluationRoutingSignature: async () => 'router-fixed' } as any);
    }, 120_000);

    afterAll(async () => {
        if (!pool) return;
        try {
            metrics.print();
            for (const tenant of tenants) {
                if (!/^tenant_commercial_[a-f0-9]{32}$/.test(tenant.schema)) throw new Error('invalid_cleanup_scope');
                await query(`DROP SCHEMA IF EXISTS "${tenant.schema}" CASCADE`);
                await query('DELETE FROM public.tenants WHERE id=$1::uuid', [tenant.tenantId]);
            }
        } finally { await pool.end(); }
    });

    const capture = (tenantId: string) => metrics.time('capture', () => service.capture(tenantId));

    // ── One dimension at a time, because they fail in different tables ──────

    it.each([
        ['price', 'services', `UPDATE services SET price = 52000`],
        ['stock', 'products', `UPDATE products SET stock = 0`],
        ['policy', 'policies', `UPDATE policies SET content = 'Cancelás hasta 24 horas antes.'`],
        ['terms', 'commercial_offers', `UPDATE commercial_offers SET valid_to = '2026-06-30'`],
    ])('refuses evidence measured before a %s change, and names the table', async (_dimension, table, edit) => {
        const [tenant] = tenants;
        const before = await capture(tenant.tenantId);
        await query(`SET search_path TO "${tenant.schema}"; ${edit}`);
        // Not "re-measure and carry on": the run that read the old price has to
        // be refused, and the refusal has to say what moved — an evaluation
        // that cannot name the price it was measured against is not evidence.
        await expect(service.assertCurrent(before)).rejects.toThrow(
            new RegExp(`evaluation_dependencies_changed:.*tenant\\.${table}`));
    });

    it('restores nothing by putting the value back', async () => {
        const [tenant] = tenants;
        await query(`SET search_path TO "${tenant.schema}"; UPDATE services SET price = 45000`);
        const before = await capture(tenant.tenantId);
        await query(`SET search_path TO "${tenant.schema}"; UPDATE services SET price = 99000`);
        await expect(service.assertCurrent(before)).rejects.toThrow('evaluation_dependencies_changed');
        await query(`SET search_path TO "${tenant.schema}"; UPDATE services SET price = 45000`);
        // A price that went away and came back is still a price the run did not
        // see for part of its life, and the revision says so: putting the value
        // back does NOT put the revision back. Anything softer would make every
        // guard here defeatable by a second edit.
        const after = await capture(tenant.tenantId);
        expect(after.revision).not.toBe(before.revision);
        await expect(service.assertCurrent(before)).rejects.toThrow('evaluation_dependencies_changed');
        await expect(service.assertCurrent(after)).resolves.toBeUndefined();
    });

    it('does not expire one tenant\'s evidence on another tenant\'s edit', async () => {
        const [first, second] = tenants;
        const evidence = await capture(second.tenantId);
        await query(`SET search_path TO "${first.schema}"; UPDATE services SET price = 61000`);
        // Two businesses on one platform is the normal case. A shared
        // invalidation would make every tenant's evidence expire on a
        // neighbour's edit, which is indistinguishable from the guard not
        // working at all.
        await expect(service.assertCurrent(evidence)).resolves.toBeUndefined();
        await query(`SET search_path TO "${first.schema}"; UPDATE services SET price = 45000`);
    });

    it('agrees between two workers, and gives a retry a new revision', async () => {
        const [tenant] = tenants;
        const [left, right] = await Promise.all([capture(tenant.tenantId), capture(tenant.tenantId)]);
        // Two workers reading an unchanged tenant have to agree, or the
        // revision is measuring the reader instead of the data.
        expect(left.revision).toBe(right.revision);

        await query(`SET search_path TO "${tenant.schema}"; UPDATE products SET stock = 3`);
        const retried = await capture(tenant.tenantId);
        expect(retried.revision).not.toBe(left.revision);
        // And the old evidence stays refused. A retry produces new evidence; it
        // does not rehabilitate the evidence that was already stale.
        await expect(service.assertCurrent(left)).rejects.toThrow('evaluation_dependencies_changed');
        await expect(service.assertCurrent(retried)).resolves.toBeUndefined();
    });

    it('survives eight concurrent captures while the catalogue is being edited', async () => {
        const [tenant] = tenants;
        const revisions = new Set<string>();
        const edits = (async () => {
            for (let round = 0; round < 4; round += 1) {
                await query(`SET search_path TO "${tenant.schema}"; UPDATE services SET price = ${40000 + round * 1000}`);
            }
        })();
        const captures = Array.from({ length: 8 }, () => capture(tenant.tenantId)
            .then(manifest => { revisions.add(manifest.revision); }));
        await Promise.all([edits, ...captures]);
        // Each capture is one MVCC read, so every revision it produces
        // corresponds to a state the database actually had. What must never
        // happen is a capture that fails, because a failed capture under load
        // is an evaluation nobody can start.
        expect(revisions.size).toBeGreaterThan(0);
        metrics.note(`8 concurrent captures during 4 price edits produced ${revisions.size} distinct revisions`);
    });

    // ── The legacy path, which would make the rest decorative ───────────────

    it('refuses a sealed reader pointed at a capture that is not its own', async () => {
        const [first, second] = tenants;
        const sealed = await service.captureStructuredKnowledge(first.tenantId);
        // Same shape, different tenant. A sealed reader that answered anyway
        // would be reading somebody else's policies — the exact failure the
        // seal exists to make impossible.
        expect(() => resolveStructuredKnowledgeCapture(sealed, second.tenantId)).toThrow();
        expect(() => resolveStructuredKnowledgeCapture(sealed, first.tenantId)).not.toThrow();
    });

    it('refuses a sealed reader whose contents were edited after sealing', async () => {
        const [tenant] = tenants;
        const sealed = await service.captureStructuredKnowledge(tenant.tenantId);
        expect(sealed.policies.state).toBe('present');
        expect(sealed.policies.rows.length).toBeGreaterThan(0);
        const tampered = JSON.parse(JSON.stringify(sealed));
        tampered.policies.rows[0] = { ...tampered.policies.rows[0], content: 'Cancelás hasta 2 horas antes.' };
        // The integrity hash is the whole point of sealing: a policy edited
        // inside the copy has to be refused as loudly as one edited in the
        // table, or the copy is just a slower way of reading live data.
        expect(() => resolveStructuredKnowledgeCapture(tampered, tenant.tenantId)).toThrow();
    });

    it('reads its structured answer from the sealed copy, not from the live table', async () => {
        const [tenant] = tenants;
        const sealed = await service.captureStructuredKnowledge(tenant.tenantId);
        await query(`SET search_path TO "${tenant.schema}"; UPDATE policies SET content = 'Cambio posterior al sellado.'`);
        const relation = structuredKnowledgeRelation(sealed, tenant.tenantId, 'policies', 1,
            AGENT_TEST_EXECUTION_CONTEXT);
        const serialized = JSON.stringify(relation);
        // The live table now says something else. The sealed reader must still
        // answer what it captured — a run that mixed the two would be reporting
        // on a policy that never existed at any single instant.
        expect(serialized).not.toContain('Cambio posterior al sellado');
        await query(`SET search_path TO "${tenant.schema}"; UPDATE policies SET content = 'Cancelás hasta 48 horas antes.'`);
    });

    it('refuses the sealed reader outside a read-only execution context', async () => {
        const [tenant] = tenants;
        const sealed = await service.captureStructuredKnowledge(tenant.tenantId);
        // This is the legacy path in its purest form: the same reader, called
        // from a context that is allowed to write. Refusing it is what stops a
        // sealed answer being produced inside a turn that could also be
        // changing the thing it just sealed.
        expect(() => structuredKnowledgeRelation(sealed, tenant.tenantId, 'policies', 1))
            .toThrow('evaluation_structured_knowledge_readonly_required');
        expect(() => structuredKnowledgeRelation(sealed, tenant.tenantId, 'policies', 0,
            AGENT_TEST_EXECUTION_CONTEXT)).toThrow('evaluation_structured_knowledge_parameter_invalid');
    });

    it('keeps the catalogue capture on a read-only repeatable-read transaction', async () => {
        const [tenant] = tenants;
        let isolation: string | undefined;
        let readOnly = false;
        const database = serviceCatalogCaptureDatabase({
            $transaction: async (work: any, options: any) => {
                isolation = options?.isolationLevel;
                const client = await pool.connect();
                await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
                try {
                    return await work({
                        $executeRawUnsafe: async (sql: string) => { if (/READ ONLY/i.test(sql)) readOnly = true; return 0; },
                        $queryRawUnsafe: async (sql: string, ...params: any[]) => (await client.query(sql, params)).rows,
                    });
                } finally { await client.query('ROLLBACK'); client.release(); }
            },
        } as any);
        await database.readTransaction(async q => q('SELECT 1'));
        // Both halves matter and for different reasons: repeatable read is what
        // makes the copy a single instant, and read-only is what stops a
        // capture from being a writer nobody audited.
        expect({ isolation, readOnly }).toEqual({ isolation: 'RepeatableRead', readOnly: true });
        expect(tenant.tenantId).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('has a commercial reader for every dimension the inventory claims', () => {
        // The bridge between the computed inventory and this suite: what is
        // being frozen here is the same set of tables the inventory says a
        // commercial answer is built from.
        const tables = new Set(commercialOnly().flatMap(reader => Object.keys(reader.tables)));
        for (const table of ['services', 'products', 'policies', 'commercial_offers']) {
            expect({ table, inInventory: tables.has(table) }).toEqual({ table, inInventory: true });
        }
    });
});
