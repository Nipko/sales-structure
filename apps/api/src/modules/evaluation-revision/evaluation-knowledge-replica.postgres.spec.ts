import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { KnowledgeConflictService } from '../kb-health/knowledge-conflict.service';
import { KNOWLEDGE_CONFLICT_SCHEMA } from '../kb-health/knowledge-conflict.schema';
import { AGENT_TEST_EXECUTION_CONTEXT } from '../../common/types/execution-context';
import { captureKnowledgeReplica, disposeKnowledgeReplica, knowledgeReplicaSchema, resolveKnowledgeReplica,
    knowledgeReplicaSlotName, KNOWLEDGE_REPLICA_SLOTS, KNOWLEDGE_REPLICA_SLOT_BYTES,
    type EvaluationKnowledgeReplica } from './evaluation-knowledge-replica';
import { EvaluationRevisionService } from './evaluation-revision.service';
import { revisionHash } from './evaluation-revision';
import { isolatedEvalNamespaceForPrisma } from '../simulation/isolated-eval-namespace';

const url = process.env.KNOWLEDGE_MEMORY_TEST_DATABASE_URL;
(url ? describe : describe.skip)('RAG replicas through PostgreSQL/pgvector and canonical readers', () => {
    const tenantId = randomUUID(), schema = `tenant_ragcopy_${randomUUID().replace(/-/g, '')}`;
    const agentId = randomUUID(), foreignAgent = randomUUID(), docId = randomUUID(), secondDocId = randomUUID();
    const faqId = randomUUID(), policyId = randomUUID(), businessId = randomUUID();
    const textA = 'Las consultas están disponibles todos los lunes a las nueve.';
    const textB = 'Las consultas están disponibles todos los lunes a las diez.';
    const vector = (offset = 0) => JSON.stringify([1, offset, ...Array(1534).fill(0)]);
    let client: PrismaClient, prisma: PrismaService, knowledge: KnowledgeService, conflicts: KnowledgeConflictService;
    let replicas: EvaluationKnowledgeReplica[], embedding: jest.SpyInstance, sourceReader: jest.SpyInstance, cache: any;
    const sql = (statement: string, ...params: any[]) => client.$queryRawUnsafe(statement, ...params) as Promise<any[]>;
    const local = (statement: string, params: any[] = []) => prisma.executeInTenantSchema<any[]>(schema, statement, params);
    const capture = async (connection = prisma) => { const copy = await captureKnowledgeReplica(connection, tenantId); replicas.push(copy); return copy; };
    const scope = { agentId, audience: 'customer' as const, jurisdiction: 'CO' };
    const search = (replica?: EvaluationKnowledgeReplica, language = 'es', query = 'consultas lunes') => knowledge.searchRelevant(tenantId, query, 10,
        { ...scope, executionContext: AGENT_TEST_EXECUTION_CONTEXT, evaluationKnowledge: replica, similarityThreshold: 0.1, language });
    const facts = (rows: any[]) => rows.map(({ retrievalId, retrievalBatchId, ...row }) => row);

    beforeAll(async () => {
        const parsed = new URL(url!);
        if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) || parsed.pathname !== '/parallly_knowledge_eval_isolation')
            throw new Error('disposable_loopback_database_required');
        client = new PrismaClient({ datasourceUrl: url });
        prisma = Object.assign(Object.create(PrismaService.prototype), { tenant: client.tenant,
            $transaction: client.$transaction.bind(client), $queryRawUnsafe: client.$queryRawUnsafe.bind(client),
            $executeRawUnsafe: client.$executeRawUnsafe.bind(client) });
        await client.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
        const extensions = await sql("SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='vector'");
        if (extensions.length !== 1 || extensions[0].nspname !== 'public') throw new Error('disposable_public_pgvector_required');
        await client.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS public.tenants(id UUID PRIMARY KEY,schema_name TEXT,is_active BOOLEAN DEFAULT true)');
        await client.$executeRawUnsafe('INSERT INTO public.tenants(id,schema_name) VALUES($1::uuid,$2)', tenantId, schema);
        await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
        const ddl = readFileSync(resolve(__dirname, '../../../prisma/tenant-schema.sql'), 'utf8').replaceAll('{{SCHEMA_NAME}}', schema);
        for (const statement of (prisma as any).splitSqlStatements(ddl)) {
            if (/^(CREATE TABLE IF NOT EXISTS|ALTER TABLE)\s+"[^"]+"\."(knowledge_documents|knowledge_embeddings|faqs|policies|companies)"/i.test(statement))
                await client.$executeRawUnsafe(statement);
        }
        await client.$executeRawUnsafe(`ALTER TABLE "${schema}".knowledge_embeddings ADD COLUMN search_tsv tsvector`);
        for (const statement of KNOWLEDGE_CONFLICT_SCHEMA)
            await client.$transaction(async tx => { await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}",public`); await tx.$executeRawUnsafe(statement); });
        conflicts = new KnowledgeConflictService(prisma, {} as any);
        cache = { get: jest.fn(() => { throw new Error('production_cache_read'); }),
            set: jest.fn(() => { throw new Error('production_cache_write'); }), tenantKey: jest.fn(() => 'forbidden') };
        knowledge = new KnowledgeService(prisma, cache, {} as any, {} as any, {} as any, {} as any, undefined, conflicts);
        embedding = jest.spyOn(knowledge, 'generateEmbedding').mockResolvedValue(JSON.parse(vector()));
        sourceReader = jest.spyOn(prisma, 'getTenantSchemaName');
    });
    beforeEach(async () => {
        replicas = [];
        await client.$executeRawUnsafe(`TRUNCATE "${schema}".knowledge_documents,"${schema}".knowledge_embeddings,
            "${schema}".faqs,"${schema}".policies,"${schema}".companies,"${schema}".knowledge_conflict_cases,
            "${schema}".knowledge_conflict_decisions CASCADE`);
        await sql(`INSERT INTO "${schema}".knowledge_documents(id,title,content_text,status,version,audience,language,file_url)
            VALUES($1::uuid,'Consultas',$3,'ready',2,'customer','es','private-synthetic-storage'),
                ($2::uuid,'Otra fuente',$4,'ready',1,'customer','es','private-synthetic-storage')`, docId, secondDocId, textA, textB);
        await sql(`INSERT INTO "${schema}".knowledge_embeddings(document_id,chunk_index,chunk_text,embedding,search_tsv)
            VALUES($1::uuid,0,$3,$5::vector,to_tsvector('spanish',$3)),($2::uuid,0,$4,$6::vector,to_tsvector('spanish',$4))`,
            docId, secondDocId, textA, textB, vector(), vector(0.1));
        await sql(`INSERT INTO "${schema}".faqs(id,question,answer) VALUES($1::uuid,'¿Horario de consultas?',$2)`, faqId, textB);
        await sql(`INSERT INTO "${schema}".policies(id,type,title,content,version) VALUES($1::uuid,'terms','Condiciones',$2,2)`, policyId, textB);
        await sql(`INSERT INTO "${schema}".companies(id,name,about,is_primary,metadata) VALUES($1::uuid,'Synthetic business',$2,true,'{"private":"supplier"}')`, businessId, textB);
        sourceReader.mockClear(); embedding.mockClear(); cache.get.mockClear(); cache.set.mockClear();
    });
    afterEach(async () => { for (const replica of replicas) await disposeKnowledgeReplica(prisma, replica); });
    afterAll(async () => {
        if (!client) return;
        try {
            if (!/^tenant_ragcopy_[a-f0-9]{32}$/.test(schema)) throw new Error('invalid_test_cleanup_scope');
            await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
            await client.$executeRawUnsafe('DELETE FROM public.tenants WHERE id=$1::uuid', tenantId);
        } finally { await client.$disconnect(); }
    });

    it.each(['es', 'en', 'pt', 'fr'])('preserves canonical vector/keyword search and source fields in %s', async language => {
        const expected = facts(await search(undefined, language)), copy = await capture();
        sourceReader.mockClear();
        expect(await knowledge.tenantHasKnowledge(tenantId, AGENT_TEST_EXECUTION_CONTEXT, { ...scope, evaluationKnowledge: copy })).toBe(true);
        expect(facts(await search(copy, language))).toEqual(expected);
        expect(sourceReader).not.toHaveBeenCalled(); expect(cache.get).not.toHaveBeenCalled(); expect(cache.set).not.toHaveBeenCalled();
        expect(JSON.stringify(copy)).not.toContain(textA); expect(JSON.stringify(copy)).not.toContain('embedding":');
        expect(JSON.stringify(await sql(`SELECT to_jsonb(d) AS row FROM "${copy.lease.schemaName}".knowledge_documents d`)))
            .not.toContain('private-synthetic-storage');
    });

    it('retains complete eligible collections and enforces audience, agent, jurisdiction and validity gates', async () => {
        const hiddenIds = [];
        for (const [audience, agents, regulated, country, from, to, status] of [
            ['internal', [], false, null, null, null, 'ready'], ['customer', [foreignAgent], false, null, null, null, 'ready'],
            ['customer', [], true, 'MX', null, null, 'ready'], ['customer', [], false, null, '2199-01-01', null, 'ready'],
            ['customer', [], false, null, null, '2000-01-01', 'ready'], ['customer', [], false, null, null, null, 'pending'],
        ] as any[]) {
            const id = randomUUID(); hiddenIds.push(id);
            await sql(`INSERT INTO "${schema}".knowledge_documents(id,title,content_text,status,audience,agent_ids,is_regulated,jurisdiction,valid_from,valid_to)
                VALUES($1::uuid,'Consultas ocultas',$2,$3,$4,$5::uuid[],$6,$7,$8::date,$9::date)`, id, textA, status, audience, agents, regulated, country, from, to);
            await sql(`INSERT INTO "${schema}".knowledge_embeddings(document_id,chunk_index,chunk_text,embedding)
                VALUES($1::uuid,0,$2,$3::vector)`, id, textA, vector());
        }
        const copy = await capture();
        expect(copy.collections.knowledge_documents.rows).toBe(7); expect(copy.collections.knowledge_embeddings.rows).toBe(7);
        expect((await search(copy)).map(row => row.document_id).sort()).toEqual([docId, secondDocId].sort());
        expect(facts(await search(copy))).toEqual(facts(await search()));
    });

    it.each(['document', 'faq', 'policy', 'business'] as const)('preserves reviewed document conflicts against %s sources', async kind => {
        const a = (conflicts as any).source('document', (await local('SELECT to_jsonb(s) AS row FROM knowledge_documents s WHERE id=$1::uuid', [docId]))[0].row);
        const tables = { document: 'knowledge_documents', faq: 'faqs', policy: 'policies', business: 'companies' };
        const ids = { document: secondDocId, faq: faqId, policy: policyId, business: businessId };
        const b = (conflicts as any).source(kind, (await local(`SELECT to_jsonb(s) AS row FROM ${tables[kind]} s WHERE id=$1::uuid`, [ids[kind]]))[0].row);
        const quoteB = kind === 'business' ? `about: ${textB}` : textB;
        const rows = await local(`INSERT INTO knowledge_conflict_cases(pair_key,source_a,source_b,quote_a,quote_b,detail,document_a)
            VALUES($1,$2::jsonb,$3::jsonb,$4,$5,'Synthetic review',$6::uuid) RETURNING id`, [randomUUID(), JSON.stringify(a), JSON.stringify(b), textA, quoteB, docId]);
        await local(`INSERT INTO knowledge_conflict_decisions(case_id,revision,decision,reason,actor_id,source_a_hash,source_b_hash,scope)
            VALUES($1::uuid,1,'prefer_a','Private synthetic reviewer reason',$2::uuid,$3,$4,$5::jsonb)`,
            [rows[0].id, randomUUID(), a.hash, b.hash, JSON.stringify(scope)]);
        const copy = await capture(), expected = facts(await search());
        expect(expected[0].conflicts).toHaveLength(1); expect(expected[0].conflicts[0].state).toBe('reviewed_preference');
        expect(facts(await search(copy))).toEqual(expected);
        const decisions = await sql(`SELECT to_jsonb(d) AS row FROM "${copy.lease.schemaName}".knowledge_conflict_decisions d`);
        expect(JSON.stringify(decisions)).not.toContain('Private synthetic reviewer reason');
        expect(decisions[0].row.actor_id).toBeUndefined();
    });

    it('keeps historical corpus values while the global dependency guard rejects changed sources', async () => {
        const revisions = new EvaluationRevisionService(prisma, { evaluationRoutingSignature: async () => 'synthetic-router' } as any);
        const manifest = await revisions.capture(tenantId), copy = await capture(), before = facts(await search(copy));
        await sql(`UPDATE "${schema}".knowledge_documents SET audience='internal',version=version+1 WHERE id=$1::uuid`, docId);
        await sql(`UPDATE "${schema}".knowledge_embeddings SET chunk_text='Changed source' WHERE document_id=$1::uuid`, docId);
        expect(facts(await search(copy))).toEqual(before);
        await expect(revisions.assertCurrent(manifest)).rejects.toThrow('evaluation_dependencies_changed');
    });

    it('copies documents and embeddings from one MVCC revision during a concurrent source edit', async () => {
        let edited = false;
        const connection = { $transaction: (work: any, options: any) => client.$transaction(async tx => work({
            $queryRawUnsafe: tx.$queryRawUnsafe.bind(tx),
            $executeRawUnsafe: async (statement: string, ...params: any[]) => {
                const result = await tx.$executeRawUnsafe(statement, ...params);
                if (!edited && /^INSERT INTO "tenant_eval_.*\."knowledge_documents"/.test(statement)) {
                    edited = true;
                    await sql(`UPDATE "${schema}".knowledge_embeddings SET chunk_text='Concurrent chunk' WHERE document_id=$1::uuid`, docId);
                }
                return result;
            },
        }), options) } as PrismaService;
        const copy = await capture(connection);
        expect(edited).toBe(true); expect((await search(copy))[0].chunk_text).toBe(textA);
        expect((await local('SELECT chunk_text FROM knowledge_embeddings WHERE document_id=$1::uuid', [docId]))[0].chunk_text).toBe('Concurrent chunk');
    });

    it('rejects scope changes, forged seals and operational use before embeddings are requested', async () => {
        const copy = await capture();
        expect(() => resolveKnowledgeReplica(copy, randomUUID())).toThrow('replica_required');
        const changed = structuredClone(copy); changed.collections.knowledge_documents.rows++;
        await expect(search(changed)).rejects.toThrow('integrity_mismatch');
        await expect(knowledge.searchRelevant(tenantId, 'consultas', 5, { ...scope, evaluationKnowledge: copy })).rejects.toThrow('readonly_required');
        const wrongOwner = structuredClone(copy); wrongOwner.lease.token = randomUUID();
        const { integrityHash, ...body } = wrongOwner; wrongOwner.integrityHash = revisionHash(body);
        await expect(search(wrongOwner)).rejects.toThrow('lease_lost');
        expect(embedding).not.toHaveBeenCalled();
    });

    it('detects a modified replica and expires its read authority without querying a live fallback', async () => {
        const copy = await capture();
        await sql(`UPDATE "${copy.lease.schemaName}".knowledge_embeddings SET chunk_text='Tampered copy' WHERE document_id=$1::uuid`, docId);
        await expect(search(copy)).rejects.toThrow('content_changed');
        await sql(`UPDATE "${copy.lease.schemaName}".__eval_namespace SET expires_at=clock_timestamp()-interval '1 second'`);
        await expect(search(copy)).rejects.toThrow('lease_lost');
        expect(sourceReader).not.toHaveBeenCalled(); expect(embedding).not.toHaveBeenCalled();
    });

    it('supports legacy vector-only storage without repairing source columns or inventing keyword data', async () => {
        await client.$executeRawUnsafe(`ALTER TABLE "${schema}".knowledge_embeddings RENAME COLUMN search_tsv TO search_tsv_saved`);
        try {
            const copy = await capture(); expect(copy.keywordSearch).toBe('absent');
            expect(facts(await search(copy))).toEqual(facts(await search()));
            expect((await sql(`SELECT count(*)::int AS c FROM "${copy.lease.schemaName}".knowledge_embeddings WHERE search_tsv IS NOT NULL`))[0].c).toBe(0);
        } finally { await client.$executeRawUnsafe(`ALTER TABLE "${schema}".knowledge_embeddings RENAME COLUMN search_tsv_saved TO search_tsv`); }
    });

    it('rejects views and rolls back partial replicas after an unreadable projection', async () => {
        const owned = async () => (await sql("SELECT nspname FROM pg_namespace WHERE nspname LIKE $1 ORDER BY nspname", `tenant_eval_${tenantId.replace(/-/g, '').slice(0, 8)}_%`)).map(row => row.nspname);
        const before = await owned();
        await client.$executeRawUnsafe(`ALTER TABLE "${schema}".knowledge_embeddings RENAME COLUMN embedding TO embedding_saved`);
        try { await expect(capture()).rejects.toThrow('column_unsupported'); }
        finally { await client.$executeRawUnsafe(`ALTER TABLE "${schema}".knowledge_embeddings RENAME COLUMN embedding_saved TO embedding`); }
        expect(await owned()).toEqual(before);
        await client.$executeRawUnsafe(`ALTER TABLE "${schema}".companies RENAME TO companies_saved`);
        try {
            await client.$executeRawUnsafe(`CREATE VIEW "${schema}".companies AS SELECT * FROM "${schema}".companies_saved`);
            await expect(capture()).rejects.toThrow('relation_unsupported');
        } finally {
            await client.$executeRawUnsafe(`DROP VIEW IF EXISTS "${schema}".companies`);
            await client.$executeRawUnsafe(`ALTER TABLE "${schema}".companies_saved RENAME TO companies`);
        }
        expect(await owned()).toEqual(before);
    });

    it('uses the common owned cleanup after expiry and permits repeated disposal', async () => {
        const copy = await capture();
        await sql(`UPDATE "${copy.lease.schemaName}".__eval_namespace SET expires_at=clock_timestamp()-interval '1 second'`);
        expect(await isolatedEvalNamespaceForPrisma(prisma).reapExpired(tenantId, schema)).toBe(1);
        await disposeKnowledgeReplica(prisma, copy);
        await expect(knowledgeReplicaSchema(prisma, copy, tenantId, AGENT_TEST_EXECUTION_CONTEXT)).rejects.toThrow('read_failed');
        expect((await local('SELECT COUNT(*)::int AS c FROM knowledge_documents'))[0].c).toBe(2);
    });

    it('distinguishes an empty corpus from an absent relation and detects first eligible content', async () => {
        await local("UPDATE knowledge_documents SET status='pending'");
        const revisions = new EvaluationRevisionService(prisma, { evaluationRoutingSignature: async () => 'synthetic-router' } as any);
        const manifest = await revisions.capture(tenantId), empty = await capture();
        expect(empty.collections.knowledge_documents).toMatchObject({ state: 'present', rows: 0 });
        expect(await knowledge.tenantHasKnowledge(tenantId, AGENT_TEST_EXECUTION_CONTEXT, { ...scope, evaluationKnowledge: empty })).toBe(false);
        await local("UPDATE knowledge_documents SET status='ready' WHERE id=$1::uuid", [docId]);
        await expect(revisions.assertCurrent(manifest)).rejects.toThrow('evaluation_dependencies_changed');
        await client.$executeRawUnsafe(`ALTER TABLE "${schema}".knowledge_documents RENAME TO knowledge_documents_saved`);
        try {
            const absent = await capture();
            expect(absent.collections.knowledge_documents).toMatchObject({ state: 'absent', rows: 0 });
            await expect(knowledge.tenantHasKnowledge(tenantId, AGENT_TEST_EXECUTION_CONTEXT, { ...scope, evaluationKnowledge: absent })).rejects.toThrow();
        } finally { await client.$executeRawUnsafe(`ALTER TABLE "${schema}".knowledge_documents_saved RENAME TO knowledge_documents`); }
    });

    it('rejects an over-capacity corpus instead of silently truncating it or leaving a partial namespace', async () => {
        await sql(`INSERT INTO "${schema}".knowledge_documents(title,content_text,status)
            SELECT 'Synthetic capacity source','Synthetic source text','ready' FROM generate_series(1,100001)`);
        await expect(capture()).rejects.toThrow('capacity_exceeded');
        expect(await sql("SELECT nspname FROM pg_namespace WHERE nspname LIKE $1", `tenant_eval_${tenantId.replace(/-/g, '').slice(0, 8)}_%`)).toEqual([]);
    });

    it('rejects unreviewed source column types before creating a replica', async () => {
        await client.$executeRawUnsafe(`CREATE DOMAIN "${schema}".custom_revision AS integer`);
        await client.$executeRawUnsafe(`ALTER TABLE "${schema}".knowledge_documents ALTER COLUMN version TYPE "${schema}".custom_revision`);
        try { await expect(capture()).rejects.toThrow('column_unsupported'); }
        finally {
            await client.$executeRawUnsafe(`ALTER TABLE "${schema}".knowledge_documents ALTER COLUMN version TYPE integer`);
            await client.$executeRawUnsafe(`DROP DOMAIN "${schema}".custom_revision`);
        }
        expect(await sql("SELECT nspname FROM pg_namespace WHERE nspname LIKE $1", `tenant_eval_${tenantId.replace(/-/g, '').slice(0, 8)}_%`)).toEqual([]);
    });

    it('rejects a replica after the tenant source binding changes', async () => {
        const copy = await capture();
        await sql('UPDATE public.tenants SET schema_name=$2 WHERE id=$1::uuid', tenantId, 'tenant_changed_synthetic');
        try { await expect(search(copy)).rejects.toThrow('lease_lost'); }
        finally { await sql('UPDATE public.tenants SET schema_name=$2 WHERE id=$1::uuid', tenantId, schema); }
        expect(embedding).not.toHaveBeenCalled();
    });

    it('records a managed capture and requires its own unexpired usage before reading', async () => {
        const usage = { token: randomUUID(), agentId };
        const copy = await captureKnowledgeReplica(prisma, tenantId, 3600_000, { slot: 0, sourceRevision: revisionHash('synthetic-source'), usage });
        replicas.push(copy);
        expect(copy.lease.schemaName).toBe(knowledgeReplicaSlotName(tenantId, 0));
        expect(copy.management).toMatchObject({ slot: 0, reservedBytes: KNOWLEDGE_REPLICA_SLOT_BYTES });
        const [stored] = await sql(`SELECT descriptor,logical_bytes::text AS bytes FROM "${copy.lease.schemaName}".__eval_knowledge_capture`);
        expect(stored.descriptor.usage).toBeUndefined();
        expect(stored.descriptor.integrityHash).toBe(copy.integrityHash);
        expect(Number(stored.bytes)).toBeGreaterThan(0);
        expect(Number(stored.bytes)).toBeLessThan(KNOWLEDGE_REPLICA_SLOT_BYTES);
        expect(facts(await search(copy))).toEqual(facts(await search()));
        embedding.mockClear(); sourceReader.mockClear();
        const missing = structuredClone(copy); delete missing.usage;
        await expect(search(missing)).rejects.toThrow('usage_required');
        await expect(search({ ...copy, usage: { ...usage, agentId: foreignAgent } })).rejects.toThrow('usage_lost');
        await expect(search({ ...copy, usage: { ...usage, token: randomUUID() } })).rejects.toThrow('usage_lost');
        await sql(`UPDATE "${copy.lease.schemaName}".__eval_knowledge_usages SET expires_at=clock_timestamp()-interval '1 second' WHERE token=$1::uuid`, usage.token);
        await expect(search(copy)).rejects.toThrow('usage_lost');
        expect(embedding).not.toHaveBeenCalled(); expect(sourceReader).not.toHaveBeenCalled();
    });

    it('lets exactly one concurrent capture own a slot and preserves it after the other capture fails', async () => {
        const allocate = () => captureKnowledgeReplica(prisma, tenantId, 3600_000,
            { slot: 1, sourceRevision: revisionHash('same-source'), usage: { token: randomUUID(), agentId } });
        const results = await Promise.allSettled([allocate(), allocate()]);
        const winners = results.filter((result): result is PromiseFulfilledResult<EvaluationKnowledgeReplica> => result.status === 'fulfilled');
        replicas.push(...winners.map(result => result.value));
        expect(winners).toHaveLength(1);
        const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
        expect(failure?.reason.message).toBe('evaluation_knowledge_slot_busy');
        expect(await knowledgeReplicaSchema(prisma, winners[0].value, tenantId, AGENT_TEST_EXECUTION_CONTEXT)).toBe(knowledgeReplicaSlotName(tenantId, 1));
        expect(await sql(`SELECT token FROM "${winners[0].value.lease.schemaName}".__eval_knowledge_usages`)).toEqual([{ token: winners[0].value.usage!.token }]);
        await expect(allocate()).rejects.toThrow('slot_busy');
        expect(facts(await search(winners[0].value))).toEqual(facts(await search()));
    });

    it('bounds managed allocation to distinct tenant slots before any copy is written', async () => {
        const slots = Array.from({ length: KNOWLEDGE_REPLICA_SLOTS }, (_, slot) => knowledgeReplicaSlotName(tenantId, slot));
        expect(new Set(slots).size).toBe(KNOWLEDGE_REPLICA_SLOTS);
        expect(knowledgeReplicaSlotName(foreignAgent, 0)).not.toBe(slots[0]);
        for (const slot of [-1, KNOWLEDGE_REPLICA_SLOTS, 0.5]) {
            await expect(captureKnowledgeReplica(prisma, tenantId, 3600_000,
                { slot, sourceRevision: revisionHash('source'), usage: { token: randomUUID(), agentId } })).rejects.toThrow('allocation_invalid');
        }
        expect(await sql('SELECT nspname FROM pg_namespace WHERE nspname=ANY($1::text[])', slots)).toEqual([]);
    });

    it('preserves source timestamp/instant semantics in conflict source hashes', async () => {
        await client.$executeRawUnsafe(`ALTER TABLE "${schema}".knowledge_documents ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC'`);
        await client.$executeRawUnsafe(`ALTER TABLE "${schema}".policies ALTER COLUMN effective_from TYPE timestamptz USING effective_from AT TIME ZONE 'UTC'`);
        try {
            await sql(`UPDATE "${schema}".knowledge_documents SET updated_at='2026-09-01 23:30:00.123456+00' WHERE id=$1::uuid`, docId);
            await sql(`UPDATE "${schema}".policies SET effective_from='2026-08-01 23:30:00+00' WHERE id=$1::uuid`, policyId);
            const copy = await capture();
            for (const [kind, table, id] of [['document', 'knowledge_documents', docId], ['policy', 'policies', policyId]]) {
                const source = (await sql(`SELECT to_jsonb(s) AS row FROM "${schema}"."${table}" s WHERE id=$1::uuid`, id))[0].row;
                const captured = (await sql(`SELECT to_jsonb(s) AS row FROM "${copy.lease.schemaName}"."${table}" s WHERE id=$1::uuid`, id))[0].row;
                expect((conflicts as any).source(kind, captured)).toEqual((conflicts as any).source(kind, source));
            }
        } finally {
            await client.$executeRawUnsafe(`ALTER TABLE "${schema}".knowledge_documents ALTER COLUMN updated_at TYPE timestamp USING updated_at AT TIME ZONE 'UTC'`);
            await client.$executeRawUnsafe(`ALTER TABLE "${schema}".policies ALTER COLUMN effective_from TYPE timestamp USING effective_from AT TIME ZONE 'UTC'`);
        }
    });
});
