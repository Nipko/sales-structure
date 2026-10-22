import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { PoliciesService } from './policies.service';
import { isDisposableDatabaseUrl } from '../../common/__fixtures__/disposable-database';

const connection = process.env.POLICY_ATOMIC_SQL_TEST_URL;
(connection ? describe : describe.skip)('policy version atomicity in disposable PostgreSQL', () => {
    const schema = `tenant_policyatomic_${randomUUID().replace(/-/g, '')}`, other = `${schema}_other`, id = randomUUID();
    let client: PrismaClient;
    const read = (s = schema) => client.$queryRawUnsafe<any[]>(`SELECT id,title,content,version,is_active FROM "${s}".policies ORDER BY version`);
    function service(options: { failVersion?: boolean; observeCommit?: boolean } = {}) {
        const s = Object.create(PoliciesService.prototype) as any;
        s.ensureSchema = jest.fn().mockResolvedValue(schema);
        const wrap = (db: any) => ({
            $executeRawUnsafe: (...args: any[]) => db.$executeRawUnsafe(...args),
            $queryRawUnsafe: (sql: string, ...args: any[]) => options.failVersion && sql.includes('MAX(version)')
                ? db.$queryRawUnsafe('SELECT synthetic_missing_column') : db.$queryRawUnsafe(sql, ...args),
        });
        let transactionResolved = false;
        s.prisma = { ...wrap(client), $transaction: async (fn: any, opts: any) => {
            transactionResolved = false;
            const result = await client.$transaction(tx => fn(wrap(tx)), opts);
            transactionResolved = true;
            return result;
        } };
        const committed: number[] = [];
        const observations: Promise<void>[] = [];
        s.redis = { del: jest.fn(async () => {
            if (options.observeCommit) expect(transactionResolved).toBe(true);
        }) };
        s.events = { emit: jest.fn(() => {
            if (!options.observeCommit) return;
            // Cache completion is deliberately independent of the committed
            // response. Verify the actual transaction boundary, then read back
            // the durable row when the dependency notification is emitted.
            expect(transactionResolved).toBe(true);
            const observation = read().then(rows => {
                const active = rows.filter(p => p.is_active);
                expect(active).toHaveLength(1); committed.push(active[0].version);
            });
            observation.catch(() => undefined); // Assert through the awaited observation below.
            observations.push(observation);
        }) };
        return { s, committed, observations };
    }
    beforeAll(async () => {
        const url = new URL(connection!), base = url.pathname.slice(1);
        if (!['parallly_policy_a_eval_isolation', 'parallly_policy_b_eval_isolation'].includes(base)
            || !isDisposableDatabaseUrl(url, base)) throw Error('owned_disposable_database_required');
        client = new PrismaClient({ datasourceUrl: connection! });
        for (const s of [schema, other]) {
            await client.$executeRawUnsafe(`CREATE SCHEMA "${s}"`);
            await client.$executeRawUnsafe(`CREATE TABLE "${s}".policies (
                id uuid PRIMARY KEY DEFAULT gen_random_uuid(),type text NOT NULL,title text NOT NULL,content text NOT NULL CHECK(content <> 'Synthetic rejected insert'),
                version integer NOT NULL,is_active boolean NOT NULL,effective_from timestamp DEFAULT NOW(),effective_to timestamp,
                created_by text,created_at timestamp DEFAULT NOW(),updated_at timestamp DEFAULT NOW())`);
            await client.$executeRawUnsafe(`CREATE UNIQUE INDEX active_policy ON "${s}".policies(type) WHERE is_active=true`);
            await client.$executeRawUnsafe(`CREATE FUNCTION "${s}".skip_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
                IF NEW.content='Synthetic skipped insert' THEN RETURN NULL; END IF; RETURN NEW; END $$`);
            await client.$executeRawUnsafe(`CREATE TRIGGER skip_insert BEFORE INSERT ON "${s}".policies FOR EACH ROW EXECUTE FUNCTION "${s}".skip_insert()`);
        }
    });
    beforeEach(async () => {
        for (const s of [schema, other]) {
            await client.$executeRawUnsafe(`DELETE FROM "${s}".policies`);
            await client.$executeRawUnsafe(`INSERT INTO "${s}".policies(id,type,title,content,version,is_active) VALUES($1::uuid,'privacy','Synthetic original','Synthetic original text',1,true)`, id);
        }
    });
    afterAll(async () => {
        if (!client) return;
        for (const s of [schema, other]) {
            if (!/^tenant_policyatomic_[a-f0-9]{32}(_other)?$/.test(s)) throw Error('unsafe_cleanup_scope');
            await client.$executeRawUnsafe(`DROP SCHEMA "${s}" CASCADE`);
        }
        await client.$disconnect();
    });
    jest.setTimeout(45000);
    const input = (content: string) => ({ type: 'privacy', title: 'Synthetic replacement', content });
    async function unchanged(h: ReturnType<typeof service>) {
        expect(await read()).toMatchObject([{ id, version: 1, is_active: true, content: 'Synthetic original text' }]);
        expect(await read()).toHaveLength(1); expect(h.s.redis.del).not.toHaveBeenCalled(); expect(h.s.events.emit).not.toHaveBeenCalled();
    }
    it('POLICYTX_A_INSERT rolls back retirement when INSERT violates a constraint', async () => {
        const h = service(); await expect(h.s.upsert('synthetic-tenant', input('Synthetic rejected insert'))).rejects.toThrow(); await unchanged(h);
    });
    it('POLICYTX_A_VERSION rolls back retirement when the version read fails', async () => {
        const h = service({ failVersion: true }); await expect(h.s.upsert('synthetic-tenant', input('Synthetic replacement text'))).rejects.toThrow(); await unchanged(h);
    });
    it('POLICYTX_A_EMPTY rolls back when INSERT returns no row', async () => {
        const h = service(); await expect(h.s.upsert('synthetic-tenant', input('Synthetic skipped insert'))).rejects.toThrow(); await unchanged(h);
    });
    it('POLICYTX_B_COMMIT invalidates cache and emits only after the replacement is committed', async () => {
        const h = service({ observeCommit: true }); const result = await h.s.upsert('synthetic-tenant', input('Synthetic committed text'));
        await Promise.all(h.observations);
        expect(result).toMatchObject({ version: 2, content: 'Synthetic committed text', isActive: true }); expect(h.committed).toEqual([2]); expect(h.s.events.emit).toHaveBeenCalledTimes(1);
    });
    it('POLICYTX_B_HISTORY preserves exact sequential versions with one active policy', async () => {
        const h = service({ observeCommit: true }); await h.s.upsert('synthetic-tenant', input('Synthetic v2\nexact text')); await Promise.all(h.observations);
        await h.s.upsert('synthetic-tenant', input('Synthetic v3\nexact text')); await Promise.all(h.observations);
        expect((await read()).map(p => [p.version, p.is_active, p.content])).toEqual([[1, false, 'Synthetic original text'], [2, false, 'Synthetic v2\nexact text'], [3, true, 'Synthetic v3\nexact text']]); expect(h.committed).toEqual([2, 3]);
    });
    it('POLICYTX_B_ISOLATION leaves the other synthetic tenant with the same UUID unchanged', async () => {
        const before = await read(other), h = service(); await h.s.upsert('synthetic-tenant', input('Synthetic selected tenant update')); expect(await read(other)).toEqual(before); expect((await read()).filter(p => p.is_active)).toHaveLength(1);
    });
});
