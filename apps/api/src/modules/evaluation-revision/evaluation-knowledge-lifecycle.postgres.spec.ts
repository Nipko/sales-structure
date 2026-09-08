import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { spawn } from 'child_process';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { KNOWLEDGE_CONFLICT_SCHEMA } from '../kb-health/knowledge-conflict.schema';
import { withAgentSourceFence } from '../../common/utils/agent-source-fence';
import { AGENT_TEST_EXECUTION_CONTEXT } from '../../common/types/execution-context';
import { revisionHash } from './evaluation-revision';
import { disposeKnowledgeReplica, knowledgeReplicaSchema, knowledgeSourceRevision, KNOWLEDGE_REPLICA_SLOT_BYTES,
    type EvaluationKnowledgeReplica } from './evaluation-knowledge-replica';
import { acquireKnowledgeReplica, bootstrapKnowledgeReplicaLifecycle, reapKnowledgeReplicas,
    releaseKnowledgeReplica, retireKnowledgeReplicasInTransaction } from './evaluation-knowledge-lifecycle';
import { ensureSyntheticGlobalTables } from '../../common/__fixtures__/synthetic-global-tables';

const url = process.env.KNOWLEDGE_MEMORY_TEST_DATABASE_URL;
const REGISTRY = 'public.evaluation_knowledge_usages';
(url ? describe : describe.skip)('Knowledge replica lifecycle with real PostgreSQL, independent workers and privacy fences', () => {
    const tenantId = randomUUID(), schema = `tenant_raglife_${randomUUID().replace(/-/g, '')}`;
    const agentId = randomUUID(), otherAgent = randomUUID(), docId = randomUUID(), caseId = randomUUID();
    let client: PrismaClient, prisma: PrismaService;
    const vector = JSON.stringify([1, ...Array(1535).fill(0)]);
    const sql = (statement: string, ...params: any[]) => client.$queryRawUnsafe(statement, ...params) as Promise<any[]>;
    const acquire = (token: string = randomUUID(), agent: string = agentId, ttlMs?: number, connection = prisma) =>
        acquireKnowledgeReplica(connection, { tenantId, agentId: agent, snapshotToken: token, ttlMs });
    const readable = (copy: EvaluationKnowledgeReplica) => knowledgeReplicaSchema(prisma, copy, tenantId, AGENT_TEST_EXECUTION_CONTEXT);
    const sourceRevision = () => client.$transaction(tx => knowledgeSourceRevision(tx as any, schema), { isolationLevel: 'RepeatableRead' });
    const barrier = () => { let release!: () => void; const promise = new Promise<void>(done => release = done); return { promise, release }; };
    const asPrisma = (connection: PrismaClient, transaction = connection.$transaction.bind(connection)): PrismaService =>
        Object.assign(Object.create(PrismaService.prototype), { tenant: connection.tenant,
            $transaction: transaction, $queryRawUnsafe: connection.$queryRawUnsafe.bind(connection),
            $executeRawUnsafe: connection.$executeRawUnsafe.bind(connection) });

    beforeAll(async () => {
        const parsed = new URL(url!);
        if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) || parsed.pathname !== '/parallly_knowledge_eval_isolation')
            throw new Error('disposable_loopback_database_required');
        client = new PrismaClient({ datasourceUrl: url }); prisma = asPrisma(client);
        await client.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
        const vectorExtension = await sql("SELECT 1 FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='vector' AND n.nspname='public'");
        if (vectorExtension.length !== 1) throw new Error('disposable_public_pgvector_required');
        await ensureSyntheticGlobalTables(sql => client.$executeRawUnsafe(sql));
        await client.$executeRawUnsafe('ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true');
        await sql('INSERT INTO public.tenants(id,schema_name) VALUES($1::uuid,$2)', tenantId, schema);
        await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
        const ddl = readFileSync(resolve(__dirname, '../../../prisma/tenant-schema.sql'), 'utf8').replaceAll('{{SCHEMA_NAME}}', schema);
        for (const statement of (prisma as any).splitSqlStatements(ddl)) {
            if (/^(CREATE TABLE IF NOT EXISTS|ALTER TABLE)\s+"[^"]+"\."(knowledge_documents|knowledge_embeddings|faqs|policies|companies|agent_personas)"/i.test(statement))
                await client.$executeRawUnsafe(statement);
        }
        await client.$executeRawUnsafe(`ALTER TABLE "${schema}".knowledge_embeddings ADD COLUMN search_tsv tsvector`);
        await client.$executeRawUnsafe(`CREATE TABLE "${schema}".messages(id uuid PRIMARY KEY,body text)`);
        for (const statement of KNOWLEDGE_CONFLICT_SCHEMA)
            await client.$transaction(async tx => { await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}",public`); await tx.$executeRawUnsafe(statement); });
        await sql(`INSERT INTO "${schema}".agent_personas(id,name,config_json) VALUES($1::uuid,'Synthetic A','{}'),($2::uuid,'Synthetic B','{}')`, agentId, otherAgent);
        await bootstrapKnowledgeReplicaLifecycle(prisma);
    });
    beforeEach(async () => {
        await sql('UPDATE public.tenants SET is_active=true,schema_name=$2 WHERE id=$1::uuid', tenantId, schema);
        await sql(`UPDATE "${schema}".agent_personas SET is_active=true,config_json='{}'`);
        await client.$executeRawUnsafe(`TRUNCATE "${schema}".knowledge_documents,"${schema}".knowledge_embeddings,"${schema}".faqs,
            "${schema}".policies,"${schema}".companies,"${schema}".knowledge_conflict_cases,"${schema}".knowledge_conflict_decisions CASCADE`);
        await sql(`INSERT INTO "${schema}".knowledge_documents(id,title,content_text,status,version,audience,language)
            VALUES($1::uuid,'Synthetic source','Source v1','ready',1,'customer','es')`, docId);
        await sql(`INSERT INTO "${schema}".knowledge_embeddings(document_id,chunk_index,chunk_text,embedding,search_tsv)
            VALUES($1::uuid,0,'Chunk v1',$2::vector,to_tsvector('simple','Chunk v1'))`, docId, vector);
        await sql(`INSERT INTO "${schema}".faqs(question,answer) VALUES('Synthetic question','FAQ v1')`);
        await sql(`INSERT INTO "${schema}".policies(type,title,content) VALUES('terms','Synthetic policy','Policy v1')`);
        await sql(`INSERT INTO "${schema}".companies(name,about,is_primary) VALUES('Synthetic company','Business v1',true)`);
        await sql(`INSERT INTO "${schema}".knowledge_conflict_cases(id,pair_key,source_a,source_b,quote_a,quote_b,detail,document_a)
            VALUES($1::uuid,$2,'{}','{}','Quote A','Quote B','Private reason',$3::uuid)`, caseId, randomUUID(), docId);
        await sql(`INSERT INTO "${schema}".knowledge_conflict_decisions(case_id,revision,decision,reason,actor_id,source_a_hash,source_b_hash,scope)
            VALUES($1::uuid,1,'prefer_a','Private reason',$2::uuid,'a','b','{}')`, caseId, randomUUID());
    });
    afterEach(async () => {
        if (!client) return;
        await sql('UPDATE public.tenants SET is_active=false,schema_name=$2 WHERE id=$1::uuid', tenantId, schema);
        await reapKnowledgeReplicas(prisma, { tenantId });
        expect(await sql('SELECT nspname FROM pg_namespace WHERE starts_with(nspname,$1)', `tenant_eval_${tenantId.replace(/-/g, '').slice(0, 8)}_`)).toEqual([]);
    });
    afterAll(async () => {
        if (!client) return;
        try {
            await sql(`DELETE FROM ${REGISTRY} WHERE tenant_id=$1::uuid`, tenantId);
            if (!/^tenant_raglife_[a-f0-9]{32}$/.test(schema)) throw new Error('invalid_test_cleanup_scope');
            await client.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
            await sql('DELETE FROM public.tenants WHERE id=$1::uuid', tenantId);
        } finally { await client.$disconnect(); }
    });

    it('shares a corpus across agents, ignores agent config/messages, and releases only its own usage', async () => {
        const first = await acquire();
        await sql(`INSERT INTO "${schema}".messages VALUES($1::uuid,'Unrelated operational traffic')`, randomUUID());
        await sql(`UPDATE "${schema}".agent_personas SET config_json='{"style":"changed"}'`);
        const second = await acquire(undefined, otherAgent);
        expect(second.lease).toEqual(first.lease); expect(second.management).toEqual(first.management);
        expect(second.usage!.token).not.toBe(first.usage!.token);
        await expect(disposeKnowledgeReplica(prisma, first)).rejects.toThrow('managed_release_required');
        expect(await releaseKnowledgeReplica(prisma, first)).toEqual({ released: true, removed: false });
        await expect(readable(first)).rejects.toThrow('usage_lost'); expect(await readable(second)).toBe(second.lease.schemaName);
        expect(await releaseKnowledgeReplica(prisma, second)).toEqual({ released: true, removed: true });
        await expect(acquire(first.usage!.token)).rejects.toThrow('usage_retired');
        const newCopy = await acquire(); expect(newCopy.lease.token).not.toBe(first.lease.token);
        expect(await releaseKnowledgeReplica(prisma, first)).toEqual({ released: true, removed: false });
        expect(await readable(newCopy)).toBe(newCopy.lease.schemaName);
    });

    it('recovers the exact committed reference after a lost ACK without extending its deadline or changing revision', async () => {
        const token = randomUUID();
        await expect(acquire(token, agentId, 60_000).then(() => { throw new Error('synthetic_ACK_lost'); })).rejects.toThrow('ACK_lost');
        const [row] = await sql(`SELECT reference FROM ${REGISTRY} WHERE tenant_id=$1::uuid AND usage_token=$2::uuid`, tenantId, token);
        await sql(`UPDATE "${schema}".knowledge_documents SET content_text='Source v2'`);
        const recovered = await acquire(token, agentId, 3600_000);
        expect(recovered).toEqual(row.reference);
        const nextSnapshot = await acquire(); expect(nextSnapshot.management!.sourceRevision).not.toBe(recovered.management!.sourceRevision);
        expect((await sql(`SELECT content_text FROM "${recovered.lease.schemaName}".knowledge_documents`))[0].content_text).toBe('Source v1');
    });

    it.each([false, true])('serializes independent Node processes with real Prisma clients (same snapshot token=%s)', async sameToken => {
        const worker = (token: string) => new Promise<EvaluationKnowledgeReplica>((done, reject) => {
            const program = `const {PrismaClient}=require('@prisma/client');const {acquireKnowledgeReplica}=require(process.env.LIFECYCLE_MODULE);
                const client=new PrismaClient({datasourceUrl:process.env.KNOWLEDGE_MEMORY_TEST_DATABASE_URL});
                const prisma={$transaction:client.$transaction.bind(client),$queryRawUnsafe:client.$queryRawUnsafe.bind(client),
                transactionInTenantSchema:(schema,work,options)=>client.$transaction(async tx=>{await tx.$executeRawUnsafe('SET LOCAL search_path TO "'+schema+'",public');
                    return work((sql,params=[])=>tx.$queryRawUnsafe(sql,...params));},options)};
                acquireKnowledgeReplica(prisma,JSON.parse(process.env.SYNTHETIC_USAGE)).then(value=>process.stdout.write(JSON.stringify(value)))
                    .catch(error=>{process.stderr.write(error.stack);process.exitCode=1;}).finally(()=>client.$disconnect());`;
            const child = spawn(process.execPath, ['-r', require.resolve('ts-node/register/transpile-only'), '-e', program], {
                env: { ...process.env, TS_NODE_SKIP_PROJECT: 'true', TS_NODE_COMPILER_OPTIONS: JSON.stringify({ module: 'commonjs', moduleResolution: 'node', target: 'ES2022' }),
                    LIFECYCLE_MODULE: resolve(__dirname, 'evaluation-knowledge-lifecycle.ts'), SYNTHETIC_USAGE: JSON.stringify({ tenantId, agentId, snapshotToken: token }) },
                stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
            });
            let output = '', error = ''; child.stdout.on('data', bytes => output += bytes); child.stderr.on('data', bytes => error += bytes);
            child.on('error', reject); child.on('close', code => code === 0 ? done(JSON.parse(output)) : reject(new Error(error)));
        });
        const token = randomUUID();
        const [a, b] = await Promise.all([worker(token), worker(sameToken ? token : randomUUID())]);
        expect(a.lease).toEqual(b.lease);
        if (sameToken) expect(a).toEqual(b); else expect(a.usage!.token).not.toBe(b.usage!.token);
        expect(await sql(`SELECT token FROM "${a.lease.schemaName}".__eval_knowledge_usages`)).toHaveLength(sameToken ? 1 : 2);
    }, 30_000);

    it('does not start the MVCC snapshot until a competing lifecycle owner has committed', async () => {
        const held = barrier(), continueWork = barrier();
        const first = client.$transaction(async tx => {
            await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text', `evaluation-knowledge:${tenantId}`);
            held.release(); await continueWork.promise;
            await tx.$executeRawUnsafe(`UPDATE "${schema}".knowledge_documents SET content_text='Committed while coordinator waits'`);
        });
        await held.promise;
        const second = acquire();
        continueWork.release(); await first;
        const copy = await second;
        expect((await sql(`SELECT content_text FROM "${copy.lease.schemaName}".knowledge_documents`))[0].content_text).toBe('Committed while coordinator waits');
    });

    it('keeps the seven signatures and copied rows in one MVCC revision during a concurrent edit', async () => {
        let edited = false;
        const before = await sourceRevision();
        const connection = asPrisma(client, ((work: any, options: any) => client.$transaction(async tx => work({
            $executeRawUnsafe: tx.$executeRawUnsafe.bind(tx),
            $queryRawUnsafe: async (statement: string, ...params: any[]) => {
                const rows = await tx.$queryRawUnsafe(statement, ...params);
                if (!edited && statement.includes('AS bytes,') && statement.includes(`FROM "${schema}"."knowledge_documents"`)) {
                    edited = true;
                    await sql(`UPDATE "${schema}".knowledge_documents SET content_text='Concurrent document'`);
                    await sql(`UPDATE "${schema}".knowledge_embeddings SET chunk_text='Concurrent chunk'`);
                }
                return rows;
            },
        }), options)) as any);
        const copy = await acquire(undefined, agentId, undefined, connection);
        expect(edited).toBe(true); expect(copy.management!.sourceRevision).toBe(before);
        expect((await sql(`SELECT content_text FROM "${copy.lease.schemaName}".knowledge_documents`))[0].content_text).toBe('Source v1');
        expect((await sql(`SELECT chunk_text FROM "${copy.lease.schemaName}".knowledge_embeddings`))[0].chunk_text).toBe('Chunk v1');
        expect(await sourceRevision()).not.toBe(before);
    });

    it.each([
        ['knowledge_documents', "content_text='Changed document'"], ['knowledge_embeddings', "chunk_text='Changed chunk'"],
        ['faqs', "answer='Changed FAQ'"], ['policies', "content='Changed policy'"], ['companies', "about='Changed business'"],
        ['knowledge_conflict_cases', "quote_a='Changed quoted evidence'"], ['knowledge_conflict_decisions', "decision='prefer_b'"],
    ])('invalidates reuse for the relevant %s projection', async (table, mutation) => {
        const first = await acquire(); await sql(`UPDATE "${schema}"."${table}" SET ${mutation}`);
        const second = await acquire(); expect(second.management!.sourceRevision).not.toBe(first.management!.sourceRevision);
        expect(second.lease.schemaName).not.toBe(first.lease.schemaName); expect(await readable(first)).toBe(first.lease.schemaName);
    });

    it('detects selected-column structure, precision and relation absence even when values do not change', async () => {
        const first = await acquire();
        await client.$executeRawUnsafe(`ALTER TABLE "${schema}".faqs ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC'`);
        try {
            const second = await acquire(); expect(second.management!.sourceRevision).not.toBe(first.management!.sourceRevision);
            await client.$executeRawUnsafe(`ALTER TABLE "${schema}".faqs RENAME TO faqs_saved`);
            try {
                const absent = await acquire(); expect(absent.collections.faqs.state).toBe('absent');
                expect(absent.management!.sourceRevision).not.toBe(second.management!.sourceRevision);
            } finally { await client.$executeRawUnsafe(`ALTER TABLE "${schema}".faqs_saved RENAME TO faqs`); }
        } finally { await client.$executeRawUnsafe(`ALTER TABLE "${schema}".faqs ALTER COLUMN updated_at TYPE timestamp USING updated_at AT TIME ZONE 'UTC'`); }
    });

    it('enforces four distinct 512 MiB logical reservations without dropping an active revision', async () => {
        const copies: EvaluationKnowledgeReplica[] = [];
        for (let i = 0; i < 4; i++) {
            await sql(`UPDATE "${schema}".knowledge_documents SET content_text=$1`, `Version ${i}`);
            copies.push(await acquire());
        }
        expect(new Set(copies.map(copy => copy.lease.schemaName)).size).toBe(4);
        expect(copies.map(copy => copy.management!.reservedBytes)).toEqual(Array(4).fill(KNOWLEDGE_REPLICA_SLOT_BYTES));
        await sql(`UPDATE "${schema}".knowledge_documents SET content_text='Version five'`);
        await expect(acquire()).rejects.toThrow('slots_exhausted');
        for (const copy of copies) expect(await readable(copy)).toBe(copy.lease.schemaName);
        await releaseKnowledgeReplica(prisma, copies[0]);
        const fifth = await acquire(); expect(fifth.lease.schemaName).toBe(copies[0].lease.schemaName);
        expect(fifth.lease.token).not.toBe(copies[0].lease.token);
    });

    it('rejects a wrong agent, forged owner and changed tenant binding while allowing evaluation of an inactive owned agent', async () => {
        const copy = await acquire();
        await expect(acquire(copy.usage!.token, otherAgent)).rejects.toThrow('usage_owner_mismatch');
        await expect(acquire(undefined, randomUUID())).rejects.toThrow('agent_unavailable');
        await expect(releaseKnowledgeReplica(prisma, { ...copy, usage: { ...copy.usage!, agentId: otherAgent } })).rejects.toThrow('usage_owner_mismatch');
        await expect(releaseKnowledgeReplica(prisma, { ...copy, usage: { ...copy.usage!, token: randomUUID() } })).rejects.toThrow('usage_owner_mismatch');
        const forged = structuredClone(copy); forged.lease.token = randomUUID();
        const { integrityHash, usage, ...body } = forged; forged.integrityHash = revisionHash(body);
        await expect(releaseKnowledgeReplica(prisma, forged)).rejects.toThrow('usage_owner_mismatch');
        await sql(`UPDATE "${schema}".agent_personas SET is_active=false WHERE id=$1::uuid`, agentId);
        expect(await acquire(copy.usage!.token)).toEqual(copy);
        await sql('UPDATE public.tenants SET schema_name=$2 WHERE id=$1::uuid', tenantId, 'tenant_other_synthetic');
        await expect(readable(copy)).rejects.toThrow('lease_lost');
        await sql('UPDATE public.tenants SET schema_name=$2 WHERE id=$1::uuid', tenantId, schema);
        expect(await readable(copy)).toBe(copy.lease.schemaName);
    });

    it('keeps a healthy usage when another expires and never resurrects the expired token', async () => {
        const first = await acquire(undefined, agentId, 1000), second = await acquire();
        await sql('SELECT pg_sleep(1.05)::text');
        expect((await reapKnowledgeReplicas(prisma, { tenantId })).removed).toBe(0);
        await expect(acquire(first.usage!.token)).rejects.toThrow('usage_retired');
        expect(await readable(second)).toBe(second.lease.schemaName);
    });

    it('reaps inactive and deleted tenants, retaining only non-revivable metadata tombstones', async () => {
        const copy = await acquire();
        await sql('UPDATE public.tenants SET is_active=false WHERE id=$1::uuid', tenantId);
        expect((await reapKnowledgeReplicas(prisma, { tenantId })).removed).toBe(1);
        await expect(readable(copy)).rejects.toThrow();
        expect((await sql(`SELECT state FROM ${REGISTRY} WHERE tenant_id=$1::uuid AND usage_token=$2::uuid`, tenantId, copy.usage!.token))[0].state).toBe('retired');
        await sql('UPDATE public.tenants SET is_active=true WHERE id=$1::uuid', tenantId);
        await expect(acquire(copy.usage!.token)).rejects.toThrow('usage_retired');
        const second = await acquire();
        await sql('DELETE FROM public.tenants WHERE id=$1::uuid', tenantId);
        try { expect((await reapKnowledgeReplicas(prisma, { tenantId })).removed).toBe(1); }
        finally { await sql('INSERT INTO public.tenants(id,schema_name) VALUES($1::uuid,$2)', tenantId, schema); }
        await expect(readable(second)).rejects.toThrow();
    });

    it('finishes capture while an exclusive erasure is queued without reacquiring a shared fence', async () => {
        let erasure: Promise<any> | undefined, queued = false;
        const connection = asPrisma(client, ((work: any, options: any) => client.$transaction(async tx => work({
            $executeRawUnsafe: tx.$executeRawUnsafe.bind(tx),
            $queryRawUnsafe: async (statement: string, ...params: any[]) => {
                const rows = await tx.$queryRawUnsafe(statement, ...params);
                if (!queued && statement.includes('evaluation-knowledge:') === false && params[0] === `evaluation-knowledge:${tenantId}`) {
                    queued = true;
                    erasure = client.$transaction(async erase => {
                        await erase.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text', `agent-privacy:${schema}`);
                        await retireKnowledgeReplicasInTransaction(erase as any, tenantId, schema);
                        await erase.$executeRawUnsafe(`DELETE FROM "${schema}".knowledge_documents`);
                    }, { timeout: 10_000 });
                    for (let attempt = 0; attempt < 100; attempt++) {
                        const waiters = await sql("SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted AND database=(SELECT oid FROM pg_database WHERE datname=current_database())");
                        if (waiters.length) break;
                        if (attempt === 99) throw new Error('erasure_did_not_queue');
                        await new Promise(done => setTimeout(done, 5));
                    }
                }
                return rows;
            },
        }), options)) as any);
        const copy = await acquire(undefined, agentId, undefined, connection);
        expect(queued).toBe(true); await erasure;
        await expect(readable(copy)).rejects.toThrow();
        await expect(acquire(copy.usage!.token)).rejects.toThrow('usage_retired');
        expect(await sql(`SELECT id FROM "${schema}".knowledge_documents`)).toEqual([]);
    }, 20_000);

    it('refuses lifecycle work inside an existing source-use callback instead of opening nested lock/DDL transactions', async () => {
        await withAgentSourceFence(prisma, schema, async () => {
            await expect(acquire()).rejects.toThrow('lifecycle_inside_source_use');
        });
    });

    it('requires the exact source exclusive privacy fence before retiring active references', async () => {
        const copy = await acquire();
        await expect(client.$transaction(tx => retireKnowledgeReplicasInTransaction(tx as any, tenantId, schema)))
            .rejects.toThrow('exclusive_privacy_required');
        await expect(client.$transaction(async tx => {
            await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text', 'agent-privacy:tenant_wrong_source');
            return retireKnowledgeReplicasInTransaction(tx as any, tenantId, schema);
        })).rejects.toThrow('exclusive_privacy_required');
        expect(await readable(copy)).toBe(copy.lease.schemaName);
    });

    it('rejects a corrupt shared corpus without creating a replacement or granting another usage', async () => {
        const copy = await acquire();
        await sql(`UPDATE "${copy.lease.schemaName}".knowledge_embeddings SET chunk_text='Tampered copy'`);
        await expect(acquire()).rejects.toThrow('content_changed');
        expect(await sql(`SELECT token FROM "${copy.lease.schemaName}".__eval_knowledge_usages`)).toHaveLength(1);
        expect(await sql(`SELECT usage_token FROM ${REGISTRY} WHERE tenant_id=$1::uuid AND state='active'`, tenantId)).toHaveLength(1);
    });

    it('rolls back release when an external dependency prevents exact owned teardown', async () => {
        const copy = await acquire();
        await client.$executeRawUnsafe(`CREATE VIEW "${schema}".external_copy_dependency AS SELECT id FROM "${copy.lease.schemaName}".knowledge_documents`);
        try {
            await expect(releaseKnowledgeReplica(prisma, copy)).rejects.toThrow();
            expect(await readable(copy)).toBe(copy.lease.schemaName);
            expect((await sql(`SELECT state FROM ${REGISTRY} WHERE tenant_id=$1::uuid AND usage_token=$2::uuid`, tenantId, copy.usage!.token))[0].state).toBe('active');
        } finally { await client.$executeRawUnsafe(`DROP VIEW "${schema}".external_copy_dependency`); }
        expect((await releaseKnowledgeReplica(prisma, copy)).removed).toBe(true);
    });

    it('refuses a replaced namespace owner instead of deleting its rows during release or sweep', async () => {
        const copy = await acquire();
        await sql(`UPDATE "${copy.lease.schemaName}".__eval_namespace SET owner_token=$1::uuid`, randomUUID());
        try {
            await expect(releaseKnowledgeReplica(prisma, copy)).rejects.toThrow('slot_owner_mismatch');
            expect((await reapKnowledgeReplicas(prisma, { tenantId })).failures).toEqual([
                { tenantId, code: 'evaluation_knowledge_slot_owner_mismatch' },
            ]);
            expect(await sql(`SELECT id FROM "${copy.lease.schemaName}".knowledge_documents`)).toHaveLength(1);
        } finally { await sql(`UPDATE "${copy.lease.schemaName}".__eval_namespace SET owner_token=$1::uuid`, copy.lease.token); }
    });

    it('advances pagination past an unreadable tenant and still cleans the next inactive tenant', async () => {
        const ids = ['fffffff0-', 'fffffff1-'].map(prefix => prefix + randomUUID().slice(9));
        const schemas = ids.map(() => `tenant_ragpage_${randomUUID().replace(/-/g, '')}`);
        const after = 'ffffffef-ffff-4fff-bfff-ffffffffffff';
        const copies: EvaluationKnowledgeReplica[] = [];
        try {
            for (let i = 0; i < 2; i++) {
                await sql('INSERT INTO public.tenants(id,schema_name) VALUES($1::uuid,$2)', ids[i], schemas[i]);
                await client.$executeRawUnsafe(`CREATE SCHEMA "${schemas[i]}"`);
                await client.$executeRawUnsafe(`CREATE TABLE "${schemas[i]}".agent_personas(id uuid PRIMARY KEY)`);
                await sql(`INSERT INTO "${schemas[i]}".agent_personas VALUES($1::uuid)`, agentId);
                copies.push(await acquireKnowledgeReplica(prisma, { tenantId: ids[i], agentId, snapshotToken: randomUUID() }));
                await sql('UPDATE public.tenants SET is_active=false WHERE id=$1::uuid', ids[i]);
            }
            // Restrict the sweep to this verified synthetic range before it can
            // touch a namespace; another suite's unrelated fixture is excluded.
            expect((await sql(`SELECT id FROM (SELECT id FROM public.tenants UNION SELECT tenant_id AS id FROM ${REGISTRY}) t
                WHERE id>$1::uuid ORDER BY id`, after)).map(row => row.id)).toEqual(ids);
            await sql(`UPDATE "${copies[0].lease.schemaName}".__eval_namespace SET owner_token=$1::uuid`, randomUUID());
            const pageOne = await reapKnowledgeReplicas(prisma, { afterTenantId: after, limit: 1 });
            expect(pageOne.failures).toEqual([{ tenantId: ids[0], code: 'evaluation_knowledge_slot_owner_mismatch' }]);
            expect(pageOne.nextCursor).toBe(ids[0]);
            const pageTwo = await reapKnowledgeReplicas(prisma, { afterTenantId: pageOne.nextCursor!, limit: 1 });
            expect(pageTwo).toMatchObject({ processedTenants: 1, removed: 1, nextCursor: null, failures: [] });
        } finally {
            if (copies[0]) await sql(`UPDATE "${copies[0].lease.schemaName}".__eval_namespace SET owner_token=$1::uuid`, copies[0].lease.token);
            for (let i = 0; i < 2; i++) {
                await reapKnowledgeReplicas(prisma, { tenantId: ids[i] });
                await sql(`DELETE FROM ${REGISTRY} WHERE tenant_id=$1::uuid`, ids[i]);
                if (!/^tenant_ragpage_[a-f0-9]{32}$/.test(schemas[i])) throw new Error('invalid_test_cleanup_scope');
                await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemas[i]}" CASCADE`);
                await sql('DELETE FROM public.tenants WHERE id=$1::uuid', ids[i]);
            }
        }
    });
});
