import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FaqsService } from '../faqs/faqs.service';
import { PoliciesService } from '../policies/policies.service';
import { AGENT_TEST_EXECUTION_CONTEXT } from '../../common/types/execution-context';
import { captureStructuredKnowledge, structuredKnowledgeRelation } from './evaluation-structured-knowledge';
import { serviceCatalogCaptureDatabase, type CaptureDatabase } from './evaluation-service-catalog-capture';
import { EvaluationRevisionService } from './evaluation-revision.service';
import { agentTurnFixture, publishTools } from '../conversations/__fixtures__/agent-turn.fixture';
import { AIToolExecutorService } from '../conversations/ai-tool-executor.service';
import { ensureSyntheticGlobalTables } from '../../common/__fixtures__/synthetic-global-tables';
import { isDisposableDatabaseUrl } from '../../common/__fixtures__/disposable-database';

const url = process.env.PARALLLY_ISOLATION_TEST_URL;
(url ? describe : describe.skip)('Captured FAQs/policies through canonical PostgreSQL readers', () => {
    const tenantId = randomUUID(), schema = `tenant_structured_${randomUUID().replace(/-/g, '')}`;
    const faqId = randomUUID(), policyId = randomUUID();
    let client: PrismaClient, prisma: PrismaService, database: CaptureDatabase;
    let faqs: FaqsService, policies: PoliciesService, tenants: any, redis: any;
    const sql = (text: string, ...params: any[]) => client.$queryRawUnsafe<any[]>(text, ...params);
    beforeAll(async () => {
        const parsed = new URL(url!);
        if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) || !isDisposableDatabaseUrl(parsed))
            throw new Error('disposable_loopback_database_required');
        client = new PrismaClient({ datasourceUrl: url });
        prisma = Object.create(PrismaService.prototype);
        Object.assign(prisma, { tenant: client.tenant, $transaction: client.$transaction.bind(client),
            $queryRawUnsafe: client.$queryRawUnsafe.bind(client), $executeRawUnsafe: client.$executeRawUnsafe.bind(client) });
        database = serviceCatalogCaptureDatabase(prisma);
        await client.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
        await ensureSyntheticGlobalTables(sql => client.$executeRawUnsafe(sql));
        await client.$executeRawUnsafe('INSERT INTO public.tenants(id,schema_name) VALUES($1::uuid,$2)', tenantId, schema);
        await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
        const ddl = readFileSync(resolve(__dirname, '../../../prisma/tenant-schema.sql'), 'utf8').replaceAll('{{SCHEMA_NAME}}', schema);
        for (const statement of (prisma as any).splitSqlStatements(ddl)) {
            if (/^(CREATE TABLE IF NOT EXISTS|ALTER TABLE)\s+"[^"]+"\."(faqs|policies)"/i.test(statement))
                await client.$executeRawUnsafe(statement);
        }
    });
    beforeEach(async () => {
        await client.$executeRawUnsafe(`TRUNCATE "${schema}".faqs, "${schema}".policies`);
        await sql(`INSERT INTO "${schema}".faqs(id,question,answer,category,tags,order_index,search_tsv)
            VALUES($1::uuid,'¿Horario de atención?','Lunes a viernes.','horarios',ARRAY['atención'],1,
                to_tsvector('simple','Horario de atención Lunes a viernes horarios'))`, faqId);
        await sql(`INSERT INTO "${schema}".faqs(question,answer,order_index,search_tsv,is_published)
            VALUES('retour échange','FAQ française',2,to_tsvector('simple','retour échange'),true),
                  ('horário de atenção','FAQ portuguesa',3,NULL,true),
                  ('attention schedule','English FAQ',4,to_tsvector('simple','attention schedule'),true),
                  ('atención confidencial','Unpublished synthetic text',5,NULL,false)`);
        await sql(`INSERT INTO "${schema}".policies(id,type,title,content,version,is_active,created_by)
            VALUES($1::uuid,'return','Devoluciones','Cambios durante siete días.',2,true,'private-synthetic-author'),
                  (gen_random_uuid(),'return','Anterior','Inactive synthetic content',1,false,'private-synthetic-author')`, policyId);
        tenants = { getSchemaName: jest.fn().mockResolvedValue(schema) };
        const forbidden = jest.fn(() => { throw new Error('production_cache_write_forbidden'); });
        redis = { getJson: forbidden, setJson: forbidden, del: forbidden };
        faqs = new FaqsService(prisma, redis, tenants);
        policies = new PoliciesService(prisma, redis, tenants);
    });
    afterAll(async () => {
        if (!client) return;
        try {
            if (!/^tenant_structured_[a-f0-9]{32}$/.test(schema)) throw new Error('invalid_cleanup_scope');
            await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
            await client.$executeRawUnsafe('DELETE FROM public.tenants WHERE id=$1::uuid', tenantId);
        } finally { await client.$disconnect(); }
    });

    it.each(['atencion', 'retour', 'atencao', 'attention', "' OR true --", 'absent topic'])
    ('preserves canonical full-text/folding/null/empty semantics for %s', async query => {
        const captured = await captureStructuredKnowledge(database, tenantId);
        const expected = await faqs.search(tenantId, query, 3, AGENT_TEST_EXECUTION_CONTEXT);
        tenants.getSchemaName.mockClear();
        tenants.getSchemaName.mockRejectedValue(new Error('source_schema_read_forbidden'));
        expect(await faqs.search(tenantId, query, 3, AGENT_TEST_EXECUTION_CONTEXT, JSON.parse(JSON.stringify(captured))))
            .toEqual(expected);
        expect(tenants.getSchemaName).not.toHaveBeenCalled();
        expect(redis.getJson).not.toHaveBeenCalled();
    });

    it('captures only eligible reader fields and preserves exact policy version/date values', async () => {
        const captured = await captureStructuredKnowledge(database, tenantId);
        const text = JSON.stringify(captured);
        for (const hidden of ['private-synthetic-author', 'Unpublished synthetic text', 'Inactive synthetic content'])
            expect(text).not.toContain(hidden);
        expect(captured.faqs.rows).toHaveLength(4); expect(captured.policies.rows).toHaveLength(1);
        const expected = await policies.getActive(tenantId, 'return', AGENT_TEST_EXECUTION_CONTEXT);
        tenants.getSchemaName.mockClear();
        expect(await policies.getActive(tenantId, 'return', AGENT_TEST_EXECUTION_CONTEXT, captured)).toEqual(expected);
        expect(await policies.getActive(tenantId, 'shipping', AGENT_TEST_EXECUTION_CONTEXT, captured)).toBeNull();
        expect(tenants.getSchemaName).not.toHaveBeenCalled();
    });

    it('ranks indexed matches before null vectors and breaks ties identically in live and captured queries', async () => {
        const firstId = '11111111-1111-4111-8111-111111111111', lastId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
        await sql(`INSERT INTO "${schema}".faqs(id,question,answer,order_index,search_tsv) VALUES
            ($1::uuid,'tie last','fixture',10,NULL),($2::uuid,'tie first','fixture',10,NULL)`, lastId, firstId);
        const captured = await captureStructuredKnowledge(database, tenantId);
        for (const source of [undefined, captured]) {
            expect((await faqs.search(tenantId, 'horario', 3, AGENT_TEST_EXECUTION_CONTEXT, source))[0].id).toBe(faqId);
            expect((await faqs.search(tenantId, 'tie', 2, AGENT_TEST_EXECUTION_CONTEXT, source)).map(row => row.id))
                .toEqual([firstId, lastId]);
        }
    });

    it('reads immutable captured collections; changes and newly eligible rows still invalidate the global guard', async () => {
        const revisions = new EvaluationRevisionService(prisma, { evaluationRoutingSignature: async () => 'fixture-router' } as any);
        const manifest = await revisions.capture(tenantId), captured = await captureStructuredKnowledge(database, tenantId);
        await sql(`UPDATE "${schema}".faqs SET answer='Changed answer' WHERE id=$1::uuid`, faqId);
        await sql(`UPDATE "${schema}".policies SET content='Changed policy' WHERE id=$1::uuid`, policyId);
        await sql(`UPDATE "${schema}".faqs SET is_published=true WHERE is_published=false`);
        // Direct leaf-port inspection demonstrates historical data; callers must
        // still run the live manifest guard, which rejects this snapshot below.
        expect((await faqs.search(tenantId, 'horario', 3, AGENT_TEST_EXECUTION_CONTEXT, captured))[0].answer).toBe('Lunes a viernes.');
        expect((await policies.getActive(tenantId, 'return', AGENT_TEST_EXECUTION_CONTEXT, captured))?.content).toBe('Cambios durante siete días.');
        await expect(revisions.assertCurrent(manifest)).rejects.toThrow('evaluation_dependencies_changed');
    });

    it('records present-empty collections and detects the first published source', async () => {
        await sql(`UPDATE "${schema}".faqs SET is_published=false`);
        await sql(`UPDATE "${schema}".policies SET is_active=false`);
        const revisions = new EvaluationRevisionService(prisma, { evaluationRoutingSignature: async () => 'fixture-router' } as any);
        const manifest = await revisions.capture(tenantId), captured = await captureStructuredKnowledge(database, tenantId);
        expect(captured.faqs).toEqual({ state: 'present', rows: [] });
        expect(await faqs.search(tenantId, 'atencion', 3, AGENT_TEST_EXECUTION_CONTEXT, captured)).toEqual([]);
        expect(await policies.getActive(tenantId, 'return', AGENT_TEST_EXECUTION_CONTEXT, captured)).toBeNull();
        await sql(`UPDATE "${schema}".faqs SET is_published=true WHERE id=$1::uuid`, faqId);
        await expect(revisions.assertCurrent(manifest)).rejects.toThrow('evaluation_dependencies_changed');
    });

    it('uses one read-only MVCC revision even if another connection edits between the two collections', async () => {
        const interleaved: CaptureDatabase = { readTransaction: work => database.readTransaction(query => work(async (statement, params) => {
            const result = await query(statement, params);
            if (statement.includes(`FROM "${schema}"."faqs"`))
                await sql(`UPDATE "${schema}".policies SET content='Concurrent policy' WHERE id=$1::uuid`, policyId);
            return result;
        })) };
        const captured = await captureStructuredKnowledge(interleaved, tenantId);
        expect(captured.policies.rows[0].content).toBe('Cambios durante siete días.');
        expect((await policies.getActive(tenantId, 'return', AGENT_TEST_EXECUTION_CONTEXT))?.content).toBe('Concurrent policy');
        await expect(database.readTransaction(query => query(`UPDATE "${schema}".faqs SET views=views+1`)))
            .rejects.toThrow();
    });

    it('distinguishes missing relations from empty collections and rejects hidden live views without DDL repair', async () => {
        await client.$executeRawUnsafe(`ALTER TABLE "${schema}".faqs RENAME TO faqs_saved`);
        try {
            const absent = await captureStructuredKnowledge(database, tenantId);
            expect(absent.faqs).toEqual({ state: 'absent', rows: [] });
            expect(() => structuredKnowledgeRelation(absent, tenantId, 'faqs', 3, AGENT_TEST_EXECUTION_CONTEXT))
                .toThrow('source_absent:faqs');
            await client.$executeRawUnsafe(`CREATE VIEW "${schema}".faqs AS SELECT * FROM "${schema}".faqs_saved`);
            try { await expect(captureStructuredKnowledge(database, tenantId)).rejects.toThrow('relation_unsupported'); }
            finally { await client.$executeRawUnsafe(`DROP VIEW "${schema}".faqs`); }
        } finally { await client.$executeRawUnsafe(`ALTER TABLE "${schema}".faqs_saved RENAME TO faqs`); }
    });

    it('rejects unreadable projections and cross-tenant scopes without a live fallback', async () => {
        const captured = await captureStructuredKnowledge(database, tenantId);
        await expect(policies.getActive(randomUUID(), 'return', AGENT_TEST_EXECUTION_CONTEXT, captured)).rejects.toThrow('knowledge_required');
        await expect(policies.getActive(tenantId, 'return', undefined, captured)).rejects.toThrow('readonly_required');
        await client.$executeRawUnsafe(`ALTER TABLE "${schema}".faqs RENAME COLUMN search_tsv TO search_tsv_saved`);
        try { await expect(captureStructuredKnowledge(database, tenantId)).rejects.toThrow(); }
        finally { await client.$executeRawUnsafe(`ALTER TABLE "${schema}".faqs RENAME COLUMN search_tsv_saved TO search_tsv`); }
    });

    it('runs Agent Test with the sealed collections, real tool handlers and live dependency guards', async () => {
        const f = agentTurnFixture({ tenantsService: tenants });
        const revisions = new EvaluationRevisionService(prisma, { evaluationRoutingSignature: async () => 'fixture-router' } as any);
        f.revisions.capture = revisions.capture.bind(revisions);
        f.revisions.assertCurrent = revisions.assertCurrent.bind(revisions);
        f.revisions.captureStructuredKnowledge = revisions.captureStructuredKnowledge.bind(revisions);
        const executor = Object.assign(Object.create(AIToolExecutorService.prototype), {
            prisma, faqsService: faqs, policiesService: policies,
            paymentOperations: {},
            logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
            toolExecutionControl: { preflight: jest.fn().mockResolvedValue({ allowed: true }), complete: jest.fn(), fail: jest.fn() },
        }) as AIToolExecutorService;
        f.toolExecutor.execute.mockImplementation(executor.execute.bind(executor));
        publishTools(f, ['search_faqs', 'get_policy']);
        f.llmRouter.execute.mockResolvedValueOnce({ content: '', toolCalls: [
            { id: 'faq', function: { name: 'search_faqs', arguments: JSON.stringify({ query: 'retour' }) } },
            { id: 'policy', function: { name: 'get_policy', arguments: JSON.stringify({ type: 'return' }) } },
        ] }).mockResolvedValue({ content: 'Información consultada.' });
        const response = await f.service.test(tenantId, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { message: 'Consulta las preguntas y la política de cambios' });
        expect(response.debug.runtimeError).toBeUndefined();
        expect(response.debug.toolCalls.map((row: any) => row.result)).toEqual([
            { faqs: [expect.objectContaining({ answer: 'FAQ française' })] },
            { type: 'return', title: 'Devoluciones', content: 'Cambios durante siete días.', version: 2 },
        ]);
        expect(redis.getJson).not.toHaveBeenCalled();
    });
});
