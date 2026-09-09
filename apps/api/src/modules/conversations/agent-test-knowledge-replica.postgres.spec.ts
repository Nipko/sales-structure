import { randomUUID } from 'crypto';
import { AsyncResource } from 'async_hooks';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PersonaService } from '../persona/persona.service';
import { RegionalProfileService } from '../tenants/regional-profile.service';
import { BusinessInfoService } from '../business-info/business-info.service';
import { VerticalsService } from '../verticals/verticals.service';
import { VerticalTurnContextService } from './vertical-turn-context.service';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { KnowledgeConflictService } from '../kb-health/knowledge-conflict.service';
import { KNOWLEDGE_CONFLICT_SCHEMA } from '../kb-health/knowledge-conflict.schema';
import { EvaluationRevisionService } from '../evaluation-revision/evaluation-revision.service';
import { EvaluationKnowledgeService } from '../evaluation-revision/evaluation-knowledge.service';
import { acquireKnowledgeReplica, bootstrapKnowledgeReplicaLifecycle, reapKnowledgeReplicas, releaseKnowledgeReplica, retireKnowledgeReplicasInTransaction } from '../evaluation-revision/evaluation-knowledge-lifecycle';
import { knowledgeReplicaSchema } from '../evaluation-revision/evaluation-knowledge-replica';
import { revisionHash } from '../evaluation-revision/evaluation-revision';
import { withReviewedRegressionScenarios } from '../quality/regressions/quality-regression-runtime';
import { readRegressionSource } from '../quality/regressions/quality-regression-source';
import { QUALITY_REGRESSION_SCHEMA } from '../quality/regressions/quality-regression-schema';
import { LLMRouterService } from '../ai/router/llm-router.service';
import type { LLMRequestOptions, LLMResponse } from '../ai/interfaces/illm-provider.interface';
import { AGENT_TEST_EXECUTION_CONTEXT } from '../../common/types/execution-context';
import { AgentTestService } from './agent-test.service';
import { AIToolExecutorService } from './ai-tool-executor.service';
import { ToolExecutionControlService } from './tool-execution-control.service';
import { sealEvaluationSnapshot, type AgentEvaluationSnapshot } from './agent-evaluation-snapshot';
import { agentTurnFixture, publishTools } from './__fixtures__/agent-turn.fixture';
import { ComplianceService } from '../compliance/compliance.service';
import { ensureSyntheticGlobalTables } from '../../common/__fixtures__/synthetic-global-tables';
import { DISPOSABLE_KNOWLEDGE_DATABASE, isDisposableDatabaseUrl } from '../../common/__fixtures__/disposable-database';

const url = process.env.KNOWLEDGE_MEMORY_TEST_DATABASE_URL;
const REGISTRY = 'public.evaluation_knowledge_usages';

/** Real capture, manifest, snapshot resolver, session/core/adapters, tool
 * admission, SQL retrieval and provider-attempt authority. Only external model,
 * embedding, quota/cost and unrelated disabled-domain I/O are substituted. */
(url ? describe : describe.skip)('Agent Test automatically consumes an owned RAG replica with PostgreSQL/Prisma', () => {
    const tenantId = randomUUID(), agentId = randomUUID(), otherAgentId = randomUUID();
    const schema = `tenant_agentrag_${randomUUID().replace(/-/g, '')}`;
    const publicDoc = randomUUID(), regulatedDoc = randomUUID();
    const fact = 'El servicio de orientación dura treinta minutos.';
    const regulatedFact = 'La orientación de Colombia se atiende con información vigente.';
    const embeddingVector = [1, ...Array(1535).fill(0)];
    const answer: LLMResponse = { content: fact, finishReason: 'stop', usage: { promptTokens: 12, completionTokens: 8, totalTokens: 20 } };
    let client: PrismaClient, secondClient: PrismaClient, prisma: PrismaService, secondPrisma: PrismaService;
    let service: AgentTestService, knowledge: KnowledgeService, managed: EvaluationKnowledgeService;
    let revisions: EvaluationRevisionService, fixture: ReturnType<typeof agentTurnFixture>;
    let primary: { providerName: string; generate: jest.Mock }, fallback: { providerName: string; generate: jest.Mock };
    let embeddingProvider: jest.Mock, schemasRead: jest.SpyInstance, snapshots: AgentEvaluationSnapshot[];
    const sql = (statement: string, ...params: any[]) => client.$queryRawUnsafe(statement, ...params) as Promise<any[]>;
    const asPrisma = (connection: PrismaClient): PrismaService => Object.assign(Object.create(PrismaService.prototype), {
        tenant: connection.tenant, $transaction: connection.$transaction.bind(connection),
        $queryRawUnsafe: connection.$queryRawUnsafe.bind(connection), $executeRawUnsafe: connection.$executeRawUnsafe.bind(connection),
    });
    const capture = async (id = agentId) => {
        const snapshot = await service.captureSnapshot(tenantId, id); snapshots.push(snapshot); return snapshot;
    };
    const turn = (snapshot?: AgentEvaluationSnapshot, input: Record<string, unknown> = {}) => service.test(tenantId, agentId,
        { message: '¿Qué información tienen sobre el servicio de orientación?', ...input } as any,
        snapshot ? { agentSnapshot: snapshot } : undefined);
    const providerCount = () => primary.generate.mock.calls.length + fallback.generate.mock.calls.length;
    const searchSchemas = () => schemasRead.mock.calls.filter(([, statement]) =>
        typeof statement === 'string' && /FROM knowledge_embeddings ke/.test(statement)).map(([selected]) => selected);

    beforeAll(async () => {
        const parsed = new URL(url!);
        if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) || !isDisposableDatabaseUrl(parsed, DISPOSABLE_KNOWLEDGE_DATABASE))
            throw new Error('disposable_loopback_database_required');
        client = new PrismaClient({ datasourceUrl: url }); secondClient = new PrismaClient({ datasourceUrl: url });
        prisma = asPrisma(client); secondPrisma = asPrisma(secondClient);
        await client.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
        const vector = await sql("SELECT 1 FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='vector' AND n.nspname='public'");
        if (vector.length !== 1) throw new Error('disposable_public_pgvector_required');
        await ensureSyntheticGlobalTables(sql => client.$executeRawUnsafe(sql));
        for (const [column, type] of Object.entries({ settings: "JSONB DEFAULT '{}'", industry: 'TEXT', language: "TEXT DEFAULT 'es'",
            operating_currency: 'TEXT', billing_country: 'TEXT', operating_country: 'TEXT', operating_timezone: 'TEXT',
            default_locale: 'TEXT', phone_region: 'TEXT', address_schema_id: 'TEXT', country_pack_id: 'TEXT', country_pack_version: 'TEXT' }))
            await client.$executeRawUnsafe(`ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS ${column} ${type}`);
        await sql(`INSERT INTO public.tenants(id,schema_name,is_active,industry,language,operating_country,operating_currency,settings)
            VALUES($1::uuid,$2,true,'retail','es','CO','COP',$3::jsonb)`, tenantId, schema,
            JSON.stringify({ businessHours: { enabled: false, timezone: 'America/Bogota' }, verticalConfig: { industry: 'retail', subType: 'moda' } }));
        await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
        const ddl = readFileSync(resolve(__dirname, '../../../prisma/tenant-schema.sql'), 'utf8').replaceAll('{{SCHEMA_NAME}}', schema);
        for (const statement of (prisma as any).splitSqlStatements(ddl))
            if (/^(CREATE TABLE IF NOT EXISTS|ALTER TABLE)\s+"[^"]+"\."(knowledge_documents|knowledge_embeddings|faqs|policies|companies|agent_personas)"/i.test(statement))
                await client.$executeRawUnsafe(statement);
        await client.$executeRawUnsafe(`ALTER TABLE "${schema}".knowledge_embeddings ADD COLUMN IF NOT EXISTS search_tsv tsvector`);
        for (const statement of KNOWLEDGE_CONFLICT_SCHEMA)
            await client.$transaction(async tx => { await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}",public`); await tx.$executeRawUnsafe(statement); });
        await bootstrapKnowledgeReplicaLifecycle(prisma);
    });

    beforeEach(async () => {
        snapshots = [];
        await sql('UPDATE public.tenants SET is_active=true WHERE id=$1::uuid', tenantId);
        await client.$executeRawUnsafe(`TRUNCATE "${schema}".knowledge_documents,"${schema}".knowledge_embeddings,"${schema}".faqs,
            "${schema}".policies,"${schema}".companies,"${schema}".knowledge_conflict_cases,"${schema}".knowledge_conflict_decisions,"${schema}".agent_personas CASCADE`);
        const config = { language: 'es', industry: 'retail', persona: { name: 'Synthetic reader', role: 'Orientar con información del negocio' },
            behavior: { rules: [], forbiddenTopics: [], handoffTriggers: [] }, hours: { timezone: 'America/Bogota' },
            tools: {}, rag: { enabled: true, topK: 10, similarityThreshold: 0.05 },
            llm: { temperature: 0, memory: { longTerm: false }, kbReranker: false } };
        await sql(`INSERT INTO "${schema}".agent_personas(id,name,config_json,channels)
            VALUES($1::uuid,'Synthetic reader',$3::jsonb,ARRAY['web_widget']),($2::uuid,'Other synthetic reader',$3::jsonb,ARRAY['web_widget'])`,
            agentId, otherAgentId, JSON.stringify(config));
        await sql(`INSERT INTO "${schema}".knowledge_documents(id,title,content_text,status,version,audience,language,agent_ids,is_regulated,jurisdiction)
            VALUES($1::uuid,'Orientación',$3,'ready',2,'customer','es',ARRAY[$5::uuid],false,NULL),
                ($2::uuid,'Orientación Colombia',$4,'ready',3,'customer','es',ARRAY[$5::uuid],true,'CO')`,
            publicDoc, regulatedDoc, fact, regulatedFact, agentId);
        await sql(`INSERT INTO "${schema}".knowledge_embeddings(document_id,chunk_index,chunk_text,embedding,search_tsv)
            VALUES($1::uuid,0,$3,$5::vector,to_tsvector('spanish',$3)),($2::uuid,0,$4,$5::vector,to_tsvector('spanish',$4))`,
            publicDoc, regulatedDoc, fact, regulatedFact, JSON.stringify(embeddingVector));
        await sql(`INSERT INTO "${schema}".faqs(question,answer) VALUES('¿Cómo funciona?','Información pública de orientación')`);
        await sql(`INSERT INTO "${schema}".policies(type,title,content) VALUES('terms','Condiciones','Condiciones públicas de orientación')`);
        await sql(`INSERT INTO "${schema}".companies(name,about,is_primary) VALUES('Synthetic business','Orientación del negocio',true)`);

        const forbidden = (name: string) => jest.fn(() => { throw new Error(`unexpected_effect:${name}`); });
        const redis = { get: forbidden('redis.get'), getJson: forbidden('redis.getJson'), set: forbidden('redis.set'),
            setJson: forbidden('redis.setJson'), del: forbidden('redis.del') };
        const events = { emit: forbidden('event.emit') };
        const tenants = { getSchemaName: (id: string) => prisma.getTenantSchemaName(id) };
        const persona = new PersonaService(prisma, redis as any, tenants as any, {} as any, events as any);
        primary = { providerName: 'openai', generate: jest.fn(async (_request: LLMRequestOptions) => answer) };
        fallback = { providerName: 'deepseek', generate: jest.fn(async (_request: LLMRequestOptions) => ({ ...answer, content: 'Forbidden fallback answer' })) };
        const keys = { isConfigured: async (name: string) => ['openai', 'deepseek'].includes(name) };
        const router = new LLMRouterService([primary, fallback] as any, redis as any, keys as any, events as any);
        // Cost accounting is operational I/O, not authority/routing logic.
        jest.spyOn(router as any, 'trackStats').mockResolvedValue(undefined);
        revisions = new EvaluationRevisionService(prisma, router);
        managed = new EvaluationKnowledgeService(prisma, revisions);
        const conflicts = new KnowledgeConflictService(prisma, {} as any);
        knowledge = new KnowledgeService(prisma, redis as any, {} as any, {} as any, {} as any, router, events as any, conflicts);
        embeddingProvider = jest.fn(async () => ({ data: [{ embedding: embeddingVector }], usage: { prompt_tokens: 7, total_tokens: 7 } }));
        jest.spyOn(knowledge as any, 'ensureOpenAI').mockResolvedValue({ embeddings: { create: embeddingProvider } });
        const control = Object.assign(Object.create(ToolExecutionControlService.prototype), { prisma });
        const executor = Object.assign(Object.create(AIToolExecutorService.prototype), { prisma, redis, knowledgeService: knowledge,
            toolExecutionControl: control, paymentOperations: { preparePaymentLink: forbidden('payment.prepare') },
            eventEmitter: events, logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() } });
        const business = new BusinessInfoService(prisma, redis as any, tenants as any);
        const verticals = new VerticalsService(prisma, redis as any, {} as any);
        fixture = agentTurnFixture({ prisma, redis, personaService: persona, tenantsService: tenants, llmRouter: router, revisions,
            knowledgeService: knowledge, toolExecutor: executor, eventEmitter: events, businessInfoService: business,
            regionalProfile: new RegionalProfileService(prisma, redis as any), verticalTurnContext: new VerticalTurnContextService(prisma, verticals) });
        publishTools(fixture, ['search_knowledge_base']);
        service = new AgentTestService(persona, tenants as any, fixture.throttle, fixture.runtime, undefined, undefined,
            revisions, fixture.mcp, fixture.integrations, managed);
        schemasRead = jest.spyOn(prisma, 'executeInTenantSchema');
    });

    afterEach(async () => {
        schemasRead?.mockRestore();
        if (!client) return;
        await sql('UPDATE public.tenants SET is_active=false WHERE id=$1::uuid', tenantId);
        const cleaned = await reapKnowledgeReplicas(prisma, { tenantId });
        expect(cleaned.failures).toEqual([]);
        expect(await sql('SELECT nspname FROM pg_namespace WHERE starts_with(nspname,$1)', `tenant_eval_${tenantId.replace(/-/g, '').slice(0, 8)}_`)).toEqual([]);
    });
    afterAll(async () => {
        if (!client) return;
        try {
            await sql(`DELETE FROM ${REGISTRY} WHERE tenant_id=$1::uuid`, tenantId);
            if (!/^tenant_agentrag_[a-f0-9]{32}$/.test(schema)) throw new Error('invalid_test_cleanup_scope');
            await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
            await sql('DELETE FROM public.tenants WHERE id=$1::uuid AND schema_name=$2', tenantId, schema);
        } finally { await Promise.all([client.$disconnect(), secondClient.$disconnect()]); }
    });

    it('captures its corpus automatically and seals only a managed reference, without embedding or source corpus in the snapshot', async () => {
        const snapshot = await capture();
        expect(snapshot.knowledgeInputs).toMatchObject({ lease: { tenantId, sourceSchema: schema }, usage: { agentId } });
        expect(snapshot.knowledgeInputs!.management).toBeDefined();
        expect(snapshot.manifest!.dependencies.find(item => item.key === 'frozen.knowledge_replica')).toBeDefined();
        expect(JSON.stringify(snapshot.knowledgeInputs)).not.toContain(fact);
        expect(JSON.stringify(snapshot.knowledgeInputs)).not.toContain('embedding":');
        const [stored] = await sql(`SELECT reference,state FROM ${REGISTRY} WHERE tenant_id=$1::uuid AND usage_token=$2::uuid`,
            tenantId, snapshot.knowledgeInputs!.usage!.token);
        expect(stored.reference).toEqual(snapshot.knowledgeInputs); expect(stored.state).toBe('active');
        await expect(service.assertSnapshotExecutable(snapshot)).resolves.toBeUndefined();
        expect(embeddingProvider).not.toHaveBeenCalled(); expect(providerCount()).toBe(0);
    });

    it('uses one captured reference in automatic context and the tool, ignoring model/client scope and replica arguments', async () => {
        const hidden: string[] = [];
        for (const [audience, agent, country, until] of [
            ['internal', agentId, null, null], ['customer', otherAgentId, null, null],
            ['customer', agentId, 'MX', null], ['customer', agentId, 'CO', '2000-01-01'],
        ]) {
            const id = randomUUID(); hidden.push(id);
            await sql(`INSERT INTO "${schema}".knowledge_documents(id,title,content_text,status,audience,agent_ids,is_regulated,jurisdiction,valid_to)
                VALUES($1::uuid,'Excluded source','Excluded private content','ready',$2,ARRAY[$3::uuid],$4,$5,$6::date)`,
                id, audience, agent, !!country, country, until);
            await sql(`INSERT INTO "${schema}".knowledge_embeddings(document_id,chunk_index,chunk_text,embedding)
                VALUES($1::uuid,0,'Excluded private content',$2::vector)`, id, JSON.stringify(embeddingVector));
        }
        primary.generate.mockResolvedValueOnce({ content: '', finishReason: 'tool_calls', toolCalls: [{ id: 'knowledge-call',
            function: { name: 'search_knowledge_base', arguments: JSON.stringify({ query: 'orientación', limit: 10,
                evaluationKnowledge: { lease: { schemaName: schema } }, knowledgeInputs: { lease: { schemaName: schema } },
                tenantId: randomUUID(), agentId: otherAgentId, audience: 'internal', jurisdiction: 'MX' }) } }], usage: answer.usage });
        const result = await turn(undefined, { knowledgeInputs: { lease: { schemaName: schema } }, agentSnapshot: { agentId: otherAgentId } });
        const snapshot = (service as any).sessions.getSnapshot(result.debug.runtimeSessionId, tenantId, agentId) as AgentEvaluationSnapshot;
        snapshots.push(snapshot);
        const tool = result.debug.toolCalls.find(call => call.name === 'search_knowledge_base')!;
        expect(tool.result).toMatchObject({ status: 'ok', source: 'tenant_db' });
        expect(result.debug.runtimeError).toBeUndefined(); expect(result.reply).toBe(fact);
        expect(result.debug.ragHits.map((hit: any) => hit.documentId).sort()).toEqual([publicDoc, regulatedDoc].sort());
        expect((tool.result as any).chunks.map((chunk: any) => chunk.documentId).sort()).toEqual([publicDoc, regulatedDoc].sort());
        expect(result.debug.systemPrompt).toContain(fact); expect(result.debug.systemPrompt).not.toContain('Excluded private content');
        expect(JSON.stringify(tool.result)).not.toContain('Excluded private content');
        expect(searchSchemas().length).toBeGreaterThanOrEqual(4); // vector + keyword pools for each real reader
        expect([...new Set(searchSchemas())]).toEqual([snapshot.knowledgeInputs!.lease.schemaName]);
        expect(embeddingProvider).toHaveBeenCalledTimes(2); expect(primary.generate).toHaveBeenCalledTimes(2);
        expect(fallback.generate).not.toHaveBeenCalled(); expect(fixture.eventEmitter.emit).not.toHaveBeenCalled();
        expect(fixture.outboundQueue.enqueue).not.toHaveBeenCalled();
    });

    it('rejects a reference from another agent even after a trusted caller reseals the surrounding snapshot', async () => {
        const snapshot = await capture(), other = await capture(otherAgentId);
        const forged = structuredClone(snapshot); forged.knowledgeInputs = other.knowledgeInputs; sealEvaluationSnapshot(forged);
        await expect(turn(forged)).rejects.toThrow('knowledge_scope_mismatch');
        await expect(service.test(randomUUID(), agentId, { message: 'orientación' }, { agentSnapshot: snapshot })).rejects.toThrow('scope_mismatch');
        expect(providerCount()).toBe(0); expect(embeddingProvider).not.toHaveBeenCalled();
    });

    it('keeps completed snapshot review distinct from permission to execute after its usage is released', async () => {
        const snapshot = await capture();
        await managed.release(snapshot);
        await expect(service.assertSnapshotCurrent(snapshot)).resolves.toBeUndefined();
        await expect(turn(snapshot)).rejects.toThrow(/evaluation_knowledge_/);
        expect(providerCount()).toBe(0); expect(embeddingProvider).not.toHaveBeenCalled();
    });

    it('fails before any external attempt when the replica SQL relation is unreadable, without reading live corpus instead', async () => {
        const snapshot = await capture(), replicaSchema = snapshot.knowledgeInputs!.lease.schemaName;
        await client.$executeRawUnsafe(`ALTER TABLE "${replicaSchema}".knowledge_embeddings RENAME COLUMN embedding TO unreadable_embedding`);
        try {
            await expect(turn(snapshot)).rejects.toThrow();
            expect(providerCount()).toBe(0); expect(embeddingProvider).not.toHaveBeenCalled();
            expect(searchSchemas()).toEqual([]);
        } finally { await client.$executeRawUnsafe(`ALTER TABLE "${replicaSchema}".knowledge_embeddings RENAME COLUMN unreadable_embedding TO embedding`); }
    });

    it('invalidates the global manifest on a changed source while leaving its immutable corpus historical', async () => {
        const snapshot = await capture();
        await sql(`UPDATE "${schema}".knowledge_documents SET audience='internal',version=version+1 WHERE id=$1::uuid`, publicDoc);
        const [old] = await sql(`SELECT audience,version FROM "${snapshot.knowledgeInputs!.lease.schemaName}".knowledge_documents WHERE id=$1::uuid`, publicDoc);
        expect(old).toEqual({ audience: 'customer', version: 2 });
        await expect(service.assertSnapshotCurrent(snapshot)).rejects.toThrow('evaluation_dependencies_changed');
        await expect(turn(snapshot)).rejects.toThrow('evaluation_dependencies_changed');
        expect(providerCount()).toBe(0); expect(embeddingProvider).not.toHaveBeenCalled();
    });

    it.each(['embedding', 'answer'] as const)('discards a source changed during the %s provider attempt without retrying an old prompt', async phase => {
        const snapshot = await capture();
        const mutate = async () => sql(`UPDATE "${schema}".knowledge_documents SET audience='internal',version=version+1 WHERE id=$1::uuid`, publicDoc);
        if (phase === 'embedding') embeddingProvider.mockImplementationOnce(async () => {
            await mutate(); return { data: [{ embedding: embeddingVector }], usage: { prompt_tokens: 7, total_tokens: 7 } };
        });
        else primary.generate.mockImplementationOnce(async () => { await mutate(); return { ...answer, content: 'PRIVATE OUTPUT MUST BE DISCARDED' }; });
        await expect(turn(snapshot)).rejects.toThrow(/(source_authority_unavailable|evaluation_dependencies_changed)/);
        expect(embeddingProvider).toHaveBeenCalledTimes(1);
        expect(primary.generate).toHaveBeenCalledTimes(phase === 'embedding' ? 0 : 1);
        expect(fallback.generate).not.toHaveBeenCalled();
        expect(fixture.eventEmitter.emit).not.toHaveBeenCalled(); expect(fixture.outboundQueue.enqueue).not.toHaveBeenCalled();
    });

    it('rejects a usage that expires on the real PostgreSQL clock during generation, without a fallback provider', async () => {
        const snapshot = await capture();
        // Acquire a real short-lived usage for the same captured corpus. This is
        // server-only test setup, not an input accepted from the client/model.
        const short = await acquireKnowledgeReplica(prisma, { tenantId, agentId, snapshotToken: randomUUID(), ttlMs: 2500 });
        await managed.release(snapshot);
        snapshot.knowledgeInputs = short; sealEvaluationSnapshot(snapshot);
        primary.generate.mockImplementationOnce(async () => {
            await sql('SELECT pg_sleep(2.6)::text');
            return { ...answer, content: 'EXPIRED OUTPUT MUST BE DISCARDED' };
        });
        await expect(turn(snapshot)).rejects.toThrow(/(source_authority_unavailable|evaluation_knowledge_)/);
        expect(primary.generate).toHaveBeenCalledTimes(1); expect(fallback.generate).not.toHaveBeenCalled();
        await expect(knowledgeReplicaSchema(prisma, short, tenantId, AGENT_TEST_EXECUTION_CONTEXT)).rejects.toThrow('usage_lost');
    }, 30_000);

    it('discards an in-flight answer when an independent owner releases its usage, and does not retry the read/tool', async () => {
        const snapshot = await capture();
        const independentWorker = new AsyncResource('synthetic-independent-knowledge-cleanup');
        primary.generate.mockImplementationOnce(async () => {
            // Separate Prisma owner stands for the independent cleanup worker;
            // it was created outside the provider's async source scope, as a
            // separately dispatched worker would be. No fence is bypassed.
            const retired = await independentWorker.runInAsyncScope(() => releaseKnowledgeReplica(secondPrisma, snapshot.knowledgeInputs!));
            expect(retired.released).toBe(true);
            return { ...answer, content: 'RETIRED OUTPUT MUST BE DISCARDED' };
        });
        await expect(turn(snapshot)).rejects.toThrow(/(source_authority_unavailable|evaluation_knowledge_)/);
        expect(primary.generate).toHaveBeenCalledTimes(1); expect(fallback.generate).not.toHaveBeenCalled();
        expect(embeddingProvider).toHaveBeenCalledTimes(1);
        const [row] = await sql(`SELECT state FROM ${REGISTRY} WHERE tenant_id=$1::uuid AND usage_token=$2::uuid`, tenantId, snapshot.knowledgeInputs!.usage!.token);
        expect(row.state).toBe('released');
        expect(fixture.eventEmitter.emit).not.toHaveBeenCalled(); expect(fixture.outboundQueue.enqueue).not.toHaveBeenCalled();
    });

    it('commits or rolls back corpus retirement together with Compliance source erasure', async () => {
        const contactId=randomUUID(),factId=randomUUID();
        for(const ddl of [
            'contact_identities(contact_id uuid,customer_profile_id uuid)',
            'conversations(id uuid PRIMARY KEY,contact_id uuid,metadata jsonb)',
            'customer_memory_facts(id uuid,owner_kind text,owner_id uuid,source_contact_id uuid)',
            'customer_memories(contact_id uuid)',
        ]) await client.$executeRawUnsafe(`CREATE TABLE "${schema}".${ddl}`);
        const native=prisma.transactionInTenantSchema.bind(prisma);
        let rejectDelete=true;
        const transaction=jest.spyOn(prisma,'transactionInTenantSchema').mockImplementation(((name:string,work:any,options:any)=>
            native(name,q=>work(async(statement:string,params:any[])=>{
                if(rejectDelete&&statement.includes('DELETE FROM customer_memory_facts'))throw new Error('synthetic_erasure_rollback');
                return q(statement,params);
            }),options)) as any);
        try{
            await sql(`INSERT INTO "${schema}".customer_memory_facts VALUES($1::uuid,'contact',$2::uuid,$2::uuid)`,factId,contactId);
            const snapshot=await capture(),corpus=snapshot.knowledgeInputs!;
            const compliance=new ComplianceService(prisma);
            await expect((compliance as any).eraseCustomerMemory(schema,contactId,tenantId)).rejects.toThrow('synthetic_erasure_rollback');
            await expect(knowledgeReplicaSchema(prisma,corpus,tenantId,AGENT_TEST_EXECUTION_CONTEXT)).resolves.toBe(corpus.lease.schemaName);
            expect(await sql(`SELECT state FROM ${REGISTRY} WHERE usage_token=$1::uuid`,corpus.usage!.token)).toEqual([{state:'active'}]);
            rejectDelete=false;
            await (compliance as any).eraseCustomerMemory(schema,contactId,tenantId);
            expect(await sql(`SELECT state FROM ${REGISTRY} WHERE usage_token=$1::uuid`,corpus.usage!.token)).toEqual([{state:'retired'}]);
            expect(await sql('SELECT 1 FROM pg_namespace WHERE nspname=$1',corpus.lease.schemaName)).toEqual([]);
            await expect(knowledgeReplicaSchema(prisma,corpus,tenantId,AGENT_TEST_EXECUTION_CONTEXT)).rejects.toThrow();
        }finally{
            transaction.mockRestore();
            for(const table of ['contact_identities','conversations','customer_memory_facts','customer_memories','customer_memory_erasure'])
                await client.$executeRawUnsafe(`DROP TABLE IF EXISTS "${schema}"."${table}"`);
        }
    });

    it('reuses the reviewed-regression source transaction for the RAG provider guard while exclusive erasure is queued', async () => {
        const contact = randomUUID(), conversation = randomUUID(), inbound = randomUUID(), ledger = randomUUID(), caseId = randomUUID();
        // A reviewed synthetic failure, not customer data or an automatic human
        // approval flow. The runtime validates its real source fingerprint and
        // approved scenario before and after use using canonical SQL readers.
        for (const statement of [
            `CREATE TABLE "${schema}".contacts(id uuid PRIMARY KEY)`,
            `CREATE TABLE "${schema}".conversations(id uuid PRIMARY KEY,contact_id uuid,channel_type text,qa_revision bigint,
                agent_persona_id uuid,agent_config_version integer,agent_attribution_conflicted boolean,was_handed_off boolean)`,
            `CREATE TABLE "${schema}".messages(id uuid PRIMARY KEY,conversation_id uuid,direction text,content_text text,created_at timestamptz DEFAULT now())`,
            `CREATE TABLE "${schema}".customer_memory_erasure(contact_id uuid PRIMARY KEY)`,
            `CREATE TABLE "${schema}".tool_execution_ledger(id uuid PRIMARY KEY,conversation_id uuid,contact_id uuid,tool_name text,
                status text,updated_at timestamptz DEFAULT now(),args_hash text,confirmed_by_message_id uuid,
                confirmation_source_message_id uuid,request_source_message_id uuid)`,
        ]) await client.$executeRawUnsafe(statement);
        for (const statement of QUALITY_REGRESSION_SCHEMA) await prisma.executeInTenantSchema(schema, statement);
        await sql(`INSERT INTO "${schema}".contacts VALUES($1::uuid)`, contact);
        await sql(`INSERT INTO "${schema}".conversations VALUES($1::uuid,$2::uuid,'web_widget',1,$3::uuid,1,false,false)`, conversation, contact, agentId);
        await sql(`INSERT INTO "${schema}".messages(id,conversation_id,direction,content_text) VALUES($1::uuid,$2::uuid,'inbound','Orientación del negocio')`, inbound, conversation);
        await sql(`INSERT INTO "${schema}".tool_execution_ledger(id,conversation_id,contact_id,tool_name,status,args_hash,request_source_message_id)
            VALUES($1::uuid,$2::uuid,$3::uuid,'search_knowledge_base','failed','synthetic-reviewed-args',$4::uuid)`, ledger, conversation, contact, inbound);
        const source = await prisma.transactionInTenantSchema(schema, query => readRegressionSource(query, 'tool_ledger', ledger, agentId));
        const definition = { key: `quality_regression:${caseId}:1`, regressionCaseId: caseId, regressionRevision: 1,
            regressionAgentId: agentId, regressionSourceHash: source.fingerprint, regressionSourceRevision: '1',
            messages: ['Orientación del negocio'], criteria: 'Answer using current reviewed knowledge' };
        const approvedHash = revisionHash(definition);
        await sql(`INSERT INTO "${schema}".quality_regression_cases(id,agent_id,source_contact_id,source_conversation_id,source_kind,
            source_evidence_id,source_message_ids,source_revision,source_hash,source_agent_version,state,revision,scope,proposal,approved_scenario,approved_hash,created_by)
            VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,'tool_ledger',$5::uuid,ARRAY[$6::uuid],1,$7,1,'approved',1,
                '{"channel":"web_widget"}','{}',$8::jsonb,$9,$10::uuid)`,
            caseId, agentId, contact, conversation, ledger, inbound, source.fingerprint, JSON.stringify(definition), approvedHash, randomUUID());
        const scenario = { ...definition, regressionApprovedHash: approvedHash };
        const snapshot = await capture();
        const native = prisma.transactionInTenantSchema.bind(prisma);
        const sourceLockPids: number[] = [];
        let erasure: Promise<number> | undefined, erased = false;
        // Bound the prior deadlock pattern: a second S request behind the queued
        // X would time out rather than leave a test waiting for production TTLs.
        prisma.transactionInTenantSchema = ((name: string, work: any, options: any) => native(name, async query => {
            await query("SET LOCAL lock_timeout='500ms'");
            return work(async (statement: string, params: any[] = []) => {
                if (statement.includes('pg_advisory_xact_lock_shared') && params[0] === `agent-privacy:${schema}`)
                    sourceLockPids.push((await query<any[]>('SELECT pg_backend_pid() AS pid'))[0].pid);
                return query(statement, params);
            });
        }, options)) as any;
        primary.generate.mockImplementationOnce(async () => {
            expect(erased).toBe(false); expect(sourceLockPids).toHaveLength(1); return answer;
        });
        try {
            const result = await withReviewedRegressionScenarios(prisma, schema, [scenario], agentId, 'web_widget', async () => {
                const outerPid = sourceLockPids[0];
                expect(outerPid).toBeGreaterThan(0);
                let queued!: (pid: number) => void;
                const started = new Promise<number>(done => { queued = done; });
                erasure = secondClient.$transaction(async tx => {
                    const [worker] = await tx.$queryRawUnsafe('SELECT pg_backend_pid() AS pid') as any[];
                    queued(worker.pid);
                    await tx.$executeRawUnsafe("SET LOCAL lock_timeout='5s'");
                    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text', `agent-privacy:${schema}`);
                    await tx.$executeRawUnsafe(`INSERT INTO "${schema}".customer_memory_erasure(contact_id) VALUES($1::uuid)`, contact);
                    const removed = await retireKnowledgeReplicasInTransaction(tx as any, tenantId, schema);
                    await tx.$executeRawUnsafe(`DELETE FROM "${schema}".quality_regression_cases WHERE id=$1::uuid`, caseId);
                    return removed;
                }, { timeout: 10000 }).then(count => { erased = true; return count; });
                const workerPid = await started;
                let blockers: number[] = [];
                for (let check = 0; check < 100; check++) {
                    blockers = (await sql('SELECT pg_blocking_pids($1::int) AS blockers', workerPid))[0].blockers;
                    if (blockers.includes(outerPid)) break;
                    await new Promise(done => setTimeout(done, 5));
                }
                expect(blockers).toContain(outerPid);
                const response = await turn(snapshot);
                expect(erased).toBe(false); expect(sourceLockPids).toEqual([outerPid]);
                return response;
            });
            expect(result.reply).toBe(fact); expect(result.debug.runtimeError).toBeUndefined();
            expect(primary.generate).toHaveBeenCalledTimes(1); expect(fallback.generate).not.toHaveBeenCalled();
            expect(await erasure).toBe(1); expect(erased).toBe(true);
            expect((await sql(`SELECT state FROM ${REGISTRY} WHERE tenant_id=$1::uuid AND usage_token=$2::uuid`,
                tenantId, snapshot.knowledgeInputs!.usage!.token))[0].state).toBe('retired');
            await expect(turn(snapshot)).rejects.toThrow(/(evaluation_dependencies_changed|evaluation_knowledge_)/);
        } finally {
            prisma.transactionInTenantSchema = native;
            if (erasure) await erasure.catch(() => undefined);
        }
    }, 15000);
});
