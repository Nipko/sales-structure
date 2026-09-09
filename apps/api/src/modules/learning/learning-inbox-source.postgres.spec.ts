import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AGENT_TEST_EXECUTION_CONTEXT } from '../../common/types/execution-context';
import { LearningService } from './learning.service';
import { LearningEvaluationService } from './learning-evaluation.service';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { LEARNING_DIMENSIONS, learningHash, learningSnapshotHash, learningSplit } from './learning-contracts';
import { assertLearningInboxSource, LearningInboxSourceUnavailable } from './learning-inbox-source';
import { LLMSourceAuthorityUnavailable } from '../ai/interfaces/llm-source-authority';
import { isolatedEvalNamespaceForPrisma, type EvalNamespaceLease } from '../simulation/isolated-eval-namespace';

const databaseUrl=process.env.LEARNING_EVIDENCE_TEST_DATABASE_URL;
(databaseUrl?describe:describe.skip)('Inbox learning binds reviewed source versions in PostgreSQL',()=>{
    const tenantId=randomUUID(),agentId=randomUUID(),conversationId=randomUUID(),otherContact=randomUUID();
    const schema=`tenant_learning_source_${randomUUID().replace(/-/g,'')}`;
    let contactId=randomUUID();
    while(learningSplit(learningHash(`${tenantId}:contact:${contactId}`))!=='train')contactId=randomUUID();
    let client:PrismaClient,prisma:PrismaService,learning:LearningService;
    let namespaces:ReturnType<typeof isolatedEvalNamespaceForPrisma>;
    const leases:EvalNamespaceLease[]=[];
    const sql=(text:string,params:any[]=[])=>prisma.executeInTenantSchema<any[]>(schema,text,params);
    const knowledge={generateEmbedding:jest.fn(async()=>Array(1536).fill(0).map((_,i)=>i===0?1:0))};
    const judgment={kind:'brand_style',scores:Object.fromEntries(LEARNING_DIMENSIONS.map(k=>[k,4])),exclusions:[],
        responsePattern:'Claro, te ayudo. ¿Qué necesitas resolver?',rationale:'Pregunta útil.',factsRequired:[]};
    const llm={execute:jest.fn(async()=>({content:JSON.stringify(judgment)}))};
    beforeAll(async()=>{
        const url=new URL(databaseUrl!);
        if(!['127.0.0.1','localhost'].includes(url.hostname)||!url.pathname.endsWith('_eval_isolation'))throw new Error('disposable_loopback_database_required');
        client=new PrismaClient({datasourceUrl:databaseUrl});
        await client.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS public.tenants(id UUID PRIMARY KEY,schema_name TEXT)');
        await client.$executeRawUnsafe('INSERT INTO public.tenants(id,schema_name) VALUES($1::uuid,$2)',tenantId,schema);
        await client.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS vector');
        await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
        prisma=Object.create(PrismaService.prototype);prisma.$transaction=client.$transaction.bind(client);
        prisma.getTenantSchemaName=jest.fn(async()=>schema);
        Object.defineProperty(prisma,'tenant',{value:{findUnique:jest.fn(async()=>({language:'es'})),findMany:jest.fn(async()=>[{id:tenantId,schemaName:schema,isActive:true}])}});
        await sql('CREATE TABLE contacts(id UUID PRIMARY KEY,name TEXT,phone TEXT,email TEXT)');
        await sql('CREATE TABLE agent_personas(id UUID PRIMARY KEY,config_json JSONB)');
        await sql('CREATE TABLE conversations(id UUID PRIMARY KEY,contact_id UUID REFERENCES contacts(id),agent_id UUID,channel_type TEXT,qa_revision BIGINT NOT NULL DEFAULT 0)');
        await sql('CREATE TABLE messages(id UUID PRIMARY KEY,conversation_id UUID REFERENCES conversations(id),direction TEXT,content_text TEXT,created_at TIMESTAMPTZ)');
        await sql('CREATE TABLE contact_identities(contact_id UUID,customer_profile_id UUID)');
        await sql('CREATE TABLE customer_memory_erasure(contact_id UUID PRIMARY KEY)');
        await sql('CREATE TABLE tool_execution_ledger(id UUID,conversation_id UUID,tool_name TEXT,status TEXT,response_payload JSONB,confirmed_by_message_id UUID,created_at TIMESTAMPTZ)');
        const ddl=readFileSync(join(__dirname,'../../../prisma/tenant-schema.sql'),'utf8');
        const start=ddl.indexOf('CREATE OR REPLACE FUNCTION "{{SCHEMA_NAME}}".qa_message_revision()');
        const functionEnd=ddl.indexOf('CREATE OR REPLACE TRIGGER qa_conversation_revision',start);
        const triggerStart=ddl.indexOf('CREATE OR REPLACE TRIGGER qa_message_revision',functionEnd);
        const triggerEnd=ddl.indexOf(';',triggerStart)+1;
        expect(start).toBeGreaterThan(0);expect(triggerEnd).toBeGreaterThan(triggerStart);
        await sql(ddl.slice(start,functionEnd).replaceAll('{{SCHEMA_NAME}}',schema));
        await sql(ddl.slice(triggerStart,triggerEnd).replaceAll('{{SCHEMA_NAME}}',schema));
        learning=new LearningService(prisma,knowledge as any,llm as any);
        namespaces=isolatedEvalNamespaceForPrisma(prisma);
        await learning.ensureTables(schema);
    });
    beforeEach(async()=>{
        await sql('TRUNCATE learning_sources,learning_releases,contacts,agent_personas,customer_memory_erasure,contact_identities,tool_execution_ledger CASCADE');
        await sql("INSERT INTO contacts VALUES($1::uuid,'Ana','+573101234567','ana@example.test'),($2::uuid,'Beatriz',NULL,NULL)",[contactId,otherContact]);
        await sql("INSERT INTO agent_personas VALUES($1::uuid,'{}'::jsonb)",[agentId]);
        await sql("INSERT INTO conversations VALUES($1::uuid,$2::uuid,$3::uuid,'whatsapp',0)",[conversationId,contactId,agentId]);
        await sql("INSERT INTO messages VALUES($1::uuid,$3::uuid,'inbound','Soy Ana, necesito orientación.','2026-09-01T12:00:00Z'),($2::uuid,$3::uuid,'outbound','Claro. ¿Qué necesitas resolver?','2026-09-01T12:00:01Z')",[randomUUID(),randomUUID(),conversationId]);
        knowledge.generateEmbedding.mockClear();llm.execute.mockClear();
    });
    afterEach(async()=>{for(const lease of leases.splice(0))await namespaces.dispose(lease);});
    afterAll(async()=>{
        if(!client)return;
        try{if(!/^tenant_learning_source_[a-f\d]{32}$/.test(schema))throw new Error('invalid_cleanup_scope');
            await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
            await client.$executeRawUnsafe('DELETE FROM public.tenants WHERE id=$1::uuid AND schema_name=$2',tenantId,schema);
        }finally{await client.$disconnect();}
    });
    const imported=async()=>{
        const result=await learning.importInbox(tenantId,agentId,conversationId,'reviewer');
        const [source]=await sql('SELECT * FROM learning_sources WHERE id=$1::uuid',[result.sourceId]);
        const [example]=await sql('SELECT id FROM learning_examples WHERE source_id=$1::uuid',[result.sourceId]);
        return {source,example};
    };
    const published=async(source:any,example:any)=>{
        await sql("UPDATE learning_examples SET status='approved',kind='brand_style',response_pattern='Te ayudo.',dedup_status='clear' WHERE id=$1::uuid",[example.id]);
        const id=randomUUID(),snapshot={examples:[{id:example.id,source_id:source.id,kind:'brand_style',language:'es',intent:'general',
            response_pattern:'Te ayudo.',rationale:'Útil',facts_required:[]}],heldout:[]};
        await sql("INSERT INTO learning_releases(id,agent_id,status,example_ids,snapshot,snapshot_hash,created_by) VALUES($1::uuid,$2::uuid,'published',$3::uuid[],$4::jsonb,$5,'reviewer')",
            [id,agentId,[example.id],JSON.stringify(snapshot),learningSnapshotHash(snapshot)]);
        return id;
    };
    it('captures only hashes/identifiers in provenance, keeps originals in Inbox and deduplicates the same version',async()=>{
        const {source}=await imported();
        expect(source.source_evidence).toMatchObject({version:1,kind:'inbox_snapshot',contactId,conversationId,sourceRevision:'2'});
        expect(JSON.stringify(source.source_evidence)).not.toMatch(/Ana|orientación|example.test|57310/);
        expect(JSON.stringify(source.transcript)).not.toMatch(/Ana|example.test|57310/);
        expect(await learning.originalSource(tenantId,agentId,source.id)).toHaveLength(2);
        expect(await learning.importInbox(tenantId,agentId,conversationId,'reviewer')).toMatchObject({duplicate:true,examplesCreated:0});
    });
    it('rejects an import edited between capture and the insertion transaction',async()=>{
        (prisma.tenant.findUnique as jest.Mock).mockImplementationOnce(async()=>{
            await sql("UPDATE messages SET content_text='Edit before import commit' WHERE direction='outbound'");
            return {language:'es'};
        });
        await expect(learning.importInbox(tenantId,agentId,conversationId,'reviewer')).rejects.toBeInstanceOf(LearningInboxSourceUnavailable);
        expect(await sql('SELECT id FROM learning_sources')).toEqual([]);
    });
    it('an explicit reimport after withdrawal creates a fresh review and deduplicates that new active generation',async()=>{
        const {source}=await imported();
        await learning.withdrawSource(tenantId,agentId,source.id);
        const next=await learning.importInbox(tenantId,agentId,conversationId,'reviewer');
        expect(next.sourceId).not.toBe(source.id);expect(next.duplicate).toBe(false);
        expect((await sql('SELECT status FROM learning_examples WHERE source_id=$1::uuid',[next.sourceId]))[0].status).toBe('pending');
        expect(await learning.importInbox(tenantId,agentId,conversationId,'reviewer')).toMatchObject({duplicate:true});
        expect(await sql("SELECT id FROM learning_sources WHERE status='active'")).toHaveLength(1);
    });
    it('keeps an unchanged source valid during unrelated customer activity',async()=>{
        const {source,example}=await imported();await published(source,example);
        const otherConversation=randomUUID();
        await sql("INSERT INTO conversations VALUES($1::uuid,$2::uuid,$3::uuid,'telegram',0)",[otherConversation,otherContact,agentId]);
        await sql("INSERT INTO messages VALUES($1::uuid,$2::uuid,'inbound','Unrelated customer traffic',NOW())",[randomUUID(),otherConversation]);
        expect(await learning.getRuntimeExamples(tenantId,agentId,{language:'es'})).toHaveLength(1);
        expect((await learning.list(tenantId,agentId)).examples[0].sourceAvailability).toBe('current');
    });
    it('analyzes and reviews valid redacted examples while holding the external-use erasure fence',async()=>{
        const {example}=await imported();
        llm.execute.mockImplementationOnce(async()=>{
            const [lock]=await sql('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS acquired',[`agent-privacy:${schema}`]);
            expect(lock.acquired).toBe(false);
            return {content:JSON.stringify(judgment)};
        });
        expect(await learning.analyze(tenantId,agentId,example.id)).toMatchObject({status:'analyzed'});
        expect(await learning.review(tenantId,agentId,example.id,{decision:'approved',revision:1,note:'Reviewed with care',privacyChecked:true,correctnessChecked:true},'reviewer')).toEqual({status:'approved'});
        expect((await learning.list(tenantId,agentId)).examples[0]).toMatchObject({status:'approved',sourceAvailability:'current'});
    });
    it.each(['text','append','delete','reassign','channel','identity','profile','legacy','tamper'])('blocks original, analysis, review and runtime when source changes: %s',async change=>{
        const {source,example}=await imported();const releaseId=await published(source,example);
        expect(await learning.getRuntimeExamples(tenantId,agentId,{language:'es'})).toHaveLength(1);
        if(change==='text')await sql("UPDATE messages SET content_text='Otro texto' WHERE direction='outbound'");
        if(change==='append')await sql("INSERT INTO messages VALUES($1::uuid,$2::uuid,'inbound','Una consulta más',NOW())",[randomUUID(),conversationId]);
        if(change==='delete')await sql("DELETE FROM messages WHERE direction='outbound'");
        if(change==='reassign')await sql('UPDATE conversations SET contact_id=$1::uuid',[otherContact]);
        if(change==='channel')await sql("UPDATE conversations SET channel_type='telegram'");
        if(change==='identity')await sql("UPDATE contacts SET name='Nombre corregido' WHERE id=$1::uuid",[contactId]);
        if(change==='profile')await sql('INSERT INTO contact_identities VALUES($1::uuid,$2::uuid)',[contactId,randomUUID()]);
        if(change==='legacy')await sql('UPDATE learning_sources SET source_evidence=NULL');
        if(change==='tamper')await sql(`UPDATE learning_sources SET transcript='[{"role":"customer","text":"forged"}]'::jsonb`);
        await expect(learning.originalSource(tenantId,agentId,source.id)).rejects.toBeInstanceOf(LearningInboxSourceUnavailable);
        await expect(learning.analyze(tenantId,agentId,example.id)).rejects.toBeInstanceOf(LearningInboxSourceUnavailable);
        await expect(learning.review(tenantId,agentId,example.id,{decision:'approved',revision:1,note:'Reviewed with care',privacyChecked:true,correctnessChecked:true},'reviewer')).rejects.toBeInstanceOf(LearningInboxSourceUnavailable);
        expect(await learning.getRuntimeExamples(tenantId,agentId,{language:'es'})).toEqual([]);
        await expect(learning.getRuntimeExamples(tenantId,agentId,{language:'es',releaseId,executionContext:AGENT_TEST_EXECUTION_CONTEXT})).rejects.toBeInstanceOf(LearningInboxSourceUnavailable);
        const listed=await learning.list(tenantId,agentId);
        expect(listed.examples[0].sourceAvailability).toBe('changed');expect(listed.releases[0].sourceAvailability).toBe('changed');
        expect(JSON.stringify(listed)).not.toMatch(/source_evidence|source_ids|sourceHash/);
        expect(knowledge.generateEmbedding).not.toHaveBeenCalled();expect(llm.execute).not.toHaveBeenCalled();
    });
    it('reimport creates unapproved examples and scrubs earlier releases including holdout derivatives',async()=>{
        const {source,example}=await imported();const id=await published(source,example);
        const holdoutId=randomUUID(),snapshot={examples:[],heldout:[{source_id:source.id,case_messages:source.transcript}]};
        await sql("INSERT INTO learning_releases(id,agent_id,example_ids,snapshot,snapshot_hash,created_by,evaluation) VALUES($1::uuid,$2::uuid,'{}'::uuid[],$3::jsonb,$4,'reviewer',$3::jsonb)",[holdoutId,agentId,JSON.stringify(snapshot),learningSnapshotHash(snapshot)]);
        await sql("UPDATE messages SET content_text='¿En qué puedo ayudarte?' WHERE direction='outbound'");
        const next=await learning.importInbox(tenantId,agentId,conversationId,'reviewer');
        expect(next.sourceId).not.toBe(source.id);
        expect((await sql('SELECT status,source_evidence,transcript FROM learning_sources WHERE id=$1::uuid',[source.id]))[0]).toEqual({status:'withdrawn',source_evidence:null,transcript:[]});
        expect((await sql('SELECT status FROM learning_examples WHERE source_id=$1::uuid',[next.sourceId]))[0].status).toBe('pending');
        expect(await sql('SELECT status,snapshot,evaluation FROM learning_releases WHERE id=ANY($1::uuid[])',[[id,holdoutId]])).toEqual([
            {status:'retired',snapshot:{},evaluation:null},{status:'retired',snapshot:{},evaluation:null}]);
    });
    it('blocks erased sources and clears provenance on transitive erasure',async()=>{
        const {source,example}=await imported();await published(source,example);
        await sql('INSERT INTO customer_memory_erasure VALUES($1::uuid)',[contactId]);
        expect(await learning.getRuntimeExamples(tenantId,agentId,{language:'es'})).toEqual([]);
        await expect(learning.importInbox(tenantId,agentId,conversationId,'reviewer')).rejects.toBeInstanceOf(LearningInboxSourceUnavailable);
        await learning.eraseContactSources(schema,tenantId,[contactId]);
        expect((await sql('SELECT source_evidence FROM learning_sources WHERE id=$1::uuid',[source.id]))[0].source_evidence).toBeNull();
    });
    it('serializes a reviewed-source commit with message edits through the real revision trigger',async()=>{
        const {source}=await imported();
        await prisma.transactionInTenantSchema(schema,async query=>{
            await assertLearningInboxSource(query,source,true);
            await expect(prisma.transactionInTenantSchema(schema,async other=>{
                await other("SELECT set_config('lock_timeout','100ms',true)");
                await other("UPDATE messages SET content_text='Concurrent edit' WHERE direction='outbound'");
            })).rejects.toThrow();
            await assertLearningInboxSource(query,source,true);
        });
        await sql("UPDATE messages SET content_text='Edit after commit' WHERE direction='outbound'");
        await expect(prisma.transactionInTenantSchema(schema,query=>assertLearningInboxSource(query,source,true))).rejects.toBeInstanceOf(LearningInboxSourceUnavailable);
    });
    it('discards an analysis if the original changes while the provider is running',async()=>{
        const {example}=await imported();
        llm.execute.mockImplementationOnce(async()=>{
            await sql("UPDATE messages SET content_text='Edited during analysis' WHERE direction='outbound'");
            return {content:JSON.stringify(judgment)};
        });
        await expect(learning.analyze(tenantId,agentId,example.id)).rejects.toBeInstanceOf(LearningInboxSourceUnavailable);
        expect((await sql('SELECT status,response_pattern FROM learning_examples WHERE id=$1::uuid',[example.id]))[0]).toEqual({status:'failed',response_pattern:null});
    });
    it('protects runtime provider use from withdrawal and rejects the next use after retirement',async()=>{
        const {source,example}=await imported();await published(source,example);
        const selected=await learning.getRuntimeExamples(tenantId,agentId,{language:'es'});
        const authority=learning.runtimeSourceAuthority(tenantId,agentId,selected);
        const response=await authority(async()=>{
            const [lock]=await sql('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS acquired',[`agent-privacy:${schema}`]);
            expect(lock.acquired).toBe(false);
            return {content:'Valid answer',finishReason:'stop'};
        });
        expect(response.content).toBe('Valid answer');
        await learning.withdrawSource(tenantId,agentId,source.id);
        const invoke=jest.fn();await expect(authority(invoke)).rejects.toBeInstanceOf(LLMSourceAuthorityUnavailable);
        expect(invoke).not.toHaveBeenCalled();
    });
    it('discards a runtime response after a source edit without blocking normal Inbox edits',async()=>{
        const {source,example}=await imported();await published(source,example);
        const selected=await learning.getRuntimeExamples(tenantId,agentId,{language:'es'});
        const usage={promptTokens:12,completionTokens:4,totalTokens:16};
        await expect(learning.runtimeSourceAuthority(tenantId,agentId,selected)(async()=>{
            await sql("UPDATE messages SET content_text='Edited while provider runs' WHERE direction='outbound'");
            return {content:'Must be discarded',finishReason:'stop',usage};
        })).rejects.toMatchObject({message:'llm_source_authority_unavailable',usage});
    });
    it.each(['text','hash','tenant_agent','kind'])('does not authorize a forged runtime projection: %s',async change=>{
        const {source,example}=await imported();await published(source,example);
        const selected=await learning.getRuntimeExamples(tenantId,agentId,{language:'es'});
        if(change==='text')selected[0].responsePattern='Forged style';
        if(change==='hash')selected[0].releaseHash='forged';
        if(change==='kind')(selected[0] as any).authority='business_fact';
        const invoke=jest.fn();
        await expect(learning.runtimeSourceAuthority(tenantId,change==='tenant_agent'?randomUUID():agentId,selected)(invoke))
            .rejects.toBeInstanceOf(LLMSourceAuthorityUnavailable);
        expect(invoke).not.toHaveBeenCalled();
    });
    it('limits candidate examples to evaluation and preserves provider errors for normal router failover',async()=>{
        const {source,example}=await imported();const id=await published(source,example);
        const selected=await learning.getRuntimeExamples(tenantId,agentId,{language:'es'});
        await sql("UPDATE learning_releases SET status='candidate' WHERE id=$1::uuid",[id]);
        const invoke=jest.fn(async()=>({content:'Preview',finishReason:'stop' as const}));
        await expect(learning.runtimeSourceAuthority(tenantId,agentId,selected)(invoke)).rejects.toBeInstanceOf(LLMSourceAuthorityUnavailable);
        expect(invoke).not.toHaveBeenCalled();
        expect((await learning.runtimeSourceAuthority(tenantId,agentId,selected,AGENT_TEST_EXECUTION_CONTEXT)(invoke)).content).toBe('Preview');
        const error=new Error('provider outage');
        await expect(learning.runtimeSourceAuthority(tenantId,agentId,selected,AGENT_TEST_EXECUTION_CONTEXT)(async()=>{throw error;})).rejects.toBe(error);
    });
    const evaluationCopy=async(source:any,example:any)=>{
        const releaseId=await published(source,example),attemptId=randomUUID();
        await sql("UPDATE learning_releases SET status='candidate',evaluation_status='running',evaluation=$2::jsonb WHERE id=$1::uuid",[releaseId,JSON.stringify({attemptId})]);
        const [{snapshot_hash:hash}]=await sql('SELECT snapshot_hash FROM learning_releases WHERE id=$1::uuid',[releaseId]);
        const lease=await namespaces.provision(tenantId,schema,['contacts','conversations','messages']);leases.push(lease);
        return{releaseId,attemptId,hash,lease};
    };
    const exists=(lease:EvalNamespaceLease)=>sql('SELECT 1 FROM pg_namespace WHERE nspname=$1',[lease.schemaName]);
    const scopeOf=(copy:Awaited<ReturnType<typeof evaluationCopy>>)=>({releaseId:copy.releaseId,releaseHash:copy.hash,
        attemptId:copy.attemptId,baselineReleaseId:null,baselineReleaseHash:null,namespace:copy.lease});
    it.each(['late_vector','retry'])('uses the actual source transaction for embedding %s protection',async failure=>{
        const {source,example}=await imported();const copy=await evaluationCopy(source,example);
        await learning.registerEvaluationNamespace(tenantId,agentId,copy.releaseId,copy.attemptId,copy.hash,copy.lease);
        const create=jest.fn(async()=>{
            const [lock]=await sql('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS acquired',[`agent-privacy:${schema}`]);
            expect(lock.acquired).toBe(false);
            await sql("UPDATE messages SET content_text='Changed during embedding' WHERE direction='outbound'");
            if(failure==='retry')throw Object.assign(new Error('Temporary provider failure'),{status:503});
            return {data:[{embedding:[0.25,0.5]}],usage:{prompt_tokens:9,total_tokens:9}};
        });
        const provider=new KnowledgeService(prisma,{} as any,{} as any,{} as any,{} as any,llm as any);
        jest.spyOn(provider as any,'ensureOpenAI').mockResolvedValue({embeddings:{create}});
        const request=provider.generateEmbedding('Historical input',tenantId,AGENT_TEST_EXECUTION_CONTEXT,
            learning.runtimeDataSourceAuthority(tenantId,agentId,[],AGENT_TEST_EXECUTION_CONTEXT,scopeOf(copy)));
        await expect(request).rejects.toBeInstanceOf(LLMSourceAuthorityUnavailable);
        if(failure==='late_vector')await expect(request).rejects.toMatchObject({usage:{promptTokens:9,completionTokens:0,totalTokens:9}});
        expect(create).toHaveBeenCalledTimes(1);
    });
    it.each([
        ['analysis','late_vector'],['analysis','retry'],['holdout','late_vector'],['holdout','retry'],
    ])('rechecks %s embeddings in the existing source transaction after %s',async(route,failure)=>{
        const {source,example}=await imported();
        if(route==='holdout')await sql("UPDATE learning_sources SET split='holdout' WHERE id=$1::uuid",[source.id]);
        const create=jest.fn(async()=>{
            const [lock]=await sql('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS acquired',[`agent-privacy:${schema}`]);
            expect(lock.acquired).toBe(false);
            await sql("UPDATE messages SET content_text='Changed during source preparation' WHERE direction='outbound'");
            if(failure==='retry')throw Object.assign(new Error('Transient embedding error'),{status:503});
            return {data:[{embedding:[1,...Array(1535).fill(0)]}],usage:{prompt_tokens:9,total_tokens:9}};
        });
        const provider=new KnowledgeService(prisma,{} as any,{} as any,{} as any,{} as any,llm as any);
        jest.spyOn(provider as any,'ensureOpenAI').mockResolvedValue({embeddings:{create}});
        const service=new LearningService(prisma,provider,llm as any);
        const transaction=jest.spyOn(prisma,'transactionInTenantSchema');
        try{
            const request=route==='analysis'?service.analyze(tenantId,agentId,example.id):(service as any).prepareHoldout(schema,tenantId,agentId);
            await expect(request).rejects.toBeInstanceOf(LLMSourceAuthorityUnavailable);
            // example() checks in a short transaction; preparation owns one more.
            // Retried external attempts reuse the latter, never a nested fence.
            expect(transaction).toHaveBeenCalledTimes(route==='analysis'?2:1);
            expect(create).toHaveBeenCalledTimes(1);expect(llm.execute).not.toHaveBeenCalled();
            expect((await sql('SELECT embedding IS NULL AS absent,response_pattern FROM learning_examples WHERE id=$1::uuid',[example.id]))[0])
                .toEqual({absent:true,response_pattern:null});
        }finally{transaction.mockRestore();}
    });
    it('rechecks the analysis model fallback on the same connection before sending historical text again',async()=>{
        const {example}=await imported();
        const transient=new Error('Transient generation error');
        const first=jest.fn(async()=>{
            await sql("UPDATE messages SET content_text='Changed during analysis provider failure' WHERE direction='outbound'");
            throw transient;
        });
        const second=jest.fn(async()=>({content:JSON.stringify(judgment)}));
        const router={execute:jest.fn(async(request:any)=>{
            await expect(request.withSourceAuthority(first)).rejects.toBe(transient);
            return request.withSourceAuthority(second);
        })};
        const service=new LearningService(prisma,knowledge as any,router as any);
        const transaction=jest.spyOn(prisma,'transactionInTenantSchema');
        try{
            await expect(service.analyze(tenantId,agentId,example.id)).rejects.toBeInstanceOf(LLMSourceAuthorityUnavailable);
            expect(first).toHaveBeenCalledTimes(1);expect(second).not.toHaveBeenCalled();
            expect(transaction).toHaveBeenCalledTimes(2);
            expect((await sql('SELECT status,response_pattern FROM learning_examples WHERE id=$1::uuid',[example.id]))[0])
                .toEqual({status:'failed',response_pattern:null});
        }finally{transaction.mockRestore();}
    });
    it('replaces a worker using the latest checkpoint and denies every late write from its predecessor',async()=>{
        const {source,example}=await imported();const copy=await evaluationCopy(source,example);
        const old=randomUUID(),current=randomUUID();
        await learning.claimEvaluationWorker(tenantId,agentId,copy.releaseId,copy.attemptId,copy.hash,old,null);
        await learning.registerEvaluationNamespace(tenantId,agentId,copy.releaseId,copy.attemptId,copy.hash,copy.lease,old);
        const checkpoint=[{sourceId:source.id,traceHash:'committed-checkpoint'}];
        await learning.checkpointEvaluation(tenantId,agentId,copy.releaseId,copy.attemptId,checkpoint,copy.hash,old);
        const resumed=await learning.claimEvaluationWorker(tenantId,agentId,copy.releaseId,copy.attemptId,copy.hash,current,old);
        expect(resumed).toMatchObject({workerToken:current,results:checkpoint});
        await expect(learning.claimEvaluationWorker(tenantId,agentId,copy.releaseId,copy.attemptId,copy.hash,randomUUID(),old)).rejects.toThrow();
        // An uncertain claim can be retried by its own invocation, without reverting checkpoints.
        expect(await learning.claimEvaluationWorker(tenantId,agentId,copy.releaseId,copy.attemptId,copy.hash,current,old)).toMatchObject({workerToken:current,results:checkpoint});
        await expect(learning.registerEvaluationNamespace(tenantId,agentId,copy.releaseId,copy.attemptId,copy.hash,copy.lease,current)).rejects.toThrow();
        await expect(learning.evaluationRun(tenantId,agentId,copy.releaseId,copy.attemptId,old)).rejects.toThrow();
        for(const token of [old,undefined]){
            await expect(learning.checkpointEvaluation(tenantId,agentId,copy.releaseId,copy.attemptId,[{private:'late'}],copy.hash,token)).rejects.toThrow();
            await expect(learning.registerEvaluationNamespace(tenantId,agentId,copy.releaseId,copy.attemptId,copy.hash,copy.lease,token)).rejects.toThrow();
            const write=jest.fn();
            await expect(learning.withEvaluationSources(tenantId,agentId,copy.releaseId,copy.attemptId,copy.hash,write,false,token)).rejects.toThrow();
            expect(write).not.toHaveBeenCalled();
            await learning.failEvaluation(tenantId,agentId,copy.releaseId,copy.attemptId,'late failure',token);
        }
        expect((await learning.evaluationRun(tenantId,agentId,copy.releaseId,copy.attemptId,current)).results).toEqual(checkpoint);
        // Losing ownership does not prevent removal of this worker's exact old copy.
        expect(await learning.cleanEvaluationNamespaces(tenantId,agentId,copy.releaseId,copy.attemptId,[copy.lease.schemaName])).toBe(1);
        await learning.failEvaluation(tenantId,agentId,copy.releaseId,copy.attemptId,'current failure',current);
        expect((await sql('SELECT evaluation_status,evaluation FROM learning_releases'))[0]).toMatchObject({evaluation_status:'failed',evaluation:{error:'current failure'}});
    });
    it('rejects a model reply when another worker takes over during the external attempt',async()=>{
        const {source,example}=await imported();const copy=await evaluationCopy(source,example);
        const old=randomUUID(),current=randomUUID();
        await learning.claimEvaluationWorker(tenantId,agentId,copy.releaseId,copy.attemptId,copy.hash,old,null);
        const scope={...scopeOf(copy),namespace:undefined,workerToken:old},usage={promptTokens:10,completionTokens:4,totalTokens:14};
        await expect(learning.runtimeSourceAuthority(tenantId,agentId,[],AGENT_TEST_EXECUTION_CONTEXT,scope)(async()=>{
            await learning.claimEvaluationWorker(tenantId,agentId,copy.releaseId,copy.attemptId,copy.hash,current,old);
            return {content:'Old worker reply',usage,finishReason:'stop'};
        })).rejects.toMatchObject({message:'llm_source_authority_unavailable',usage});
        const invoke=jest.fn(async()=>({content:'Current worker reply',finishReason:'stop' as const}));
        expect((await learning.runtimeSourceAuthority(tenantId,agentId,[],AGENT_TEST_EXECUTION_CONTEXT,{...scope,workerToken:current})(invoke)).content)
            .toBe('Current worker reply');
    });
    it('does not let queue recovery fail a worker claimed after the request scan',async()=>{
        const {source,example}=await imported();const copy=await evaluationCopy(source,example);
        const old=randomUUID(),current=randomUUID();
        await learning.claimEvaluationWorker(tenantId,agentId,copy.releaseId,copy.attemptId,copy.hash,old,null);
        const queue={getJob:jest.fn(async()=>({getState:async()=>{
            await learning.claimEvaluationWorker(tenantId,agentId,copy.releaseId,copy.attemptId,copy.hash,current,old);
            return 'failed';
        }})),add:jest.fn()};
        await new LearningEvaluationService(learning,{} as any,{} as any,llm as any,queue as any,prisma).recoverQueuedEvaluations();
        expect(await learning.evaluationRun(tenantId,agentId,copy.releaseId,copy.attemptId,current)).toMatchObject({workerToken:current});
        expect(queue.add).not.toHaveBeenCalled();
    });
    it('allows only the current worker to finalize an otherwise valid complete comparison',async()=>{
        const {source,example}=await imported();const copy=await evaluationCopy(source,example);
        const snapshot={examples:[],heldout:[{source_id:source.id}]};copy.hash=learningSnapshotHash(snapshot);
        await sql("UPDATE learning_releases SET snapshot=$2::jsonb,snapshot_hash=$3,example_ids='{}',evaluation=evaluation||$4::jsonb WHERE id=$1::uuid",
            [copy.releaseId,JSON.stringify(snapshot),copy.hash,JSON.stringify({dependencyHash:'dep',agentSnapshot:{configHash:'config'}})]);
        const old=randomUUID(),current=randomUUID();
        await learning.claimEvaluationWorker(tenantId,agentId,copy.releaseId,copy.attemptId,copy.hash,old,null);
        await learning.claimEvaluationWorker(tenantId,agentId,copy.releaseId,copy.attemptId,copy.hash,current,old);
        const evidence={attemptId:copy.attemptId,releaseHash:copy.hash,baselineReleaseId:null,agentRevision:'config',dependencyHash:'dep',
            results:[{sourceId:source.id,candidateCompleted:true,baselineCompleted:true,candidateScore:90,baselineScore:80,criticalFailures:[],traceHash:'valid'}]};
        for(const token of [old,undefined])await expect(learning.recordEvaluation(tenantId,agentId,copy.releaseId,evidence,token)).rejects.toThrow();
        expect((await learning.recordEvaluation(tenantId,agentId,copy.releaseId,evidence,current)).passed).toBe(true);
        await learning.failEvaluation(tenantId,agentId,copy.releaseId,copy.attemptId,'late failure',old);
        expect((await sql('SELECT evaluation_status,evaluation FROM learning_releases'))[0]).toMatchObject({evaluation_status:'passed',evaluation:{workerToken:current,passed:true}});
        await expect(learning.claimEvaluationWorker(tenantId,agentId,copy.releaseId,copy.attemptId,copy.hash,randomUUID(),current)).rejects.toThrow();
    });
    it('protects heldout input even without selected examples, using one provider transaction and no long conversation locks',async()=>{
        const {source,example}=await imported();const copy=await evaluationCopy(source,example);
        await learning.registerEvaluationNamespace(tenantId,agentId,copy.releaseId,copy.attemptId,copy.hash,copy.lease);
        const transaction=jest.spyOn(prisma,'transactionInTenantSchema');
        try{
            const response=await learning.runtimeSourceAuthority(tenantId,agentId,[],AGENT_TEST_EXECUTION_CONTEXT,scopeOf(copy))(async()=>{
                expect(transaction).toHaveBeenCalledTimes(1);
                const [lock]=await sql('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS acquired',[`agent-privacy:${schema}`]);
                expect(lock.acquired).toBe(false);
                return {content:'Authorized replay',finishReason:'stop'};
            });
            expect(response.content).toBe('Authorized replay');
        }finally{transaction.mockRestore();}
        const usage={promptTokens:10,completionTokens:3,totalTokens:13};
        await expect(learning.runtimeSourceAuthority(tenantId,agentId,[],AGENT_TEST_EXECUTION_CONTEXT,scopeOf(copy))(async()=>{
            // This completes while the provider is running: no source row lock is held.
            await sql("UPDATE messages SET content_text='Changed during heldout replay' WHERE direction='outbound'");
            return {content:'Discard this late reply',usage,finishReason:'stop'};
        })).rejects.toMatchObject({message:'llm_source_authority_unavailable',usage});
    });
    it.each(['attempt','hash','namespace','live_context','registration'])('denies evaluator authority before an external call for %s',async change=>{
        const {source,example}=await imported();const copy=await evaluationCopy(source,example);
        if(change!=='registration')await learning.registerEvaluationNamespace(tenantId,agentId,copy.releaseId,copy.attemptId,copy.hash,copy.lease);
        const scope=scopeOf(copy);
        if(change==='attempt')scope.attemptId=randomUUID();
        if(change==='hash')scope.releaseHash='forged';
        if(change==='namespace')scope.namespace={...copy.lease,token:randomUUID()};
        const invoke=jest.fn();
        await expect(learning.runtimeSourceAuthority(tenantId,agentId,[],change==='live_context'?undefined:AGENT_TEST_EXECUTION_CONTEXT,scope)(invoke))
            .rejects.toBeInstanceOf(LLMSourceAuthorityUnavailable);
        expect(invoke).not.toHaveBeenCalled();
    });
    it('discards a reply if the registered namespace expires during the provider call',async()=>{
        const {source,example}=await imported();const copy=await evaluationCopy(source,example);
        await learning.registerEvaluationNamespace(tenantId,agentId,copy.releaseId,copy.attemptId,copy.hash,copy.lease);
        await expect(learning.runtimeSourceAuthority(tenantId,agentId,[],AGENT_TEST_EXECUTION_CONTEXT,scopeOf(copy))(async()=>{
            await prisma.executeInTenantSchema(copy.lease.schemaName,"UPDATE __eval_namespace SET expires_at=clock_timestamp()-interval '1 second'");
            return {content:'Late reply',finishReason:'stop'};
        })).rejects.toBeInstanceOf(LLMSourceAuthorityUnavailable);
    });
    it('also revalidates baseline sources before judging when the candidate source remains unchanged',async()=>{
        const {source,example}=await imported();const baselineId=await published(source,example);
        const [{snapshot_hash:baselineHash}]=await sql('SELECT snapshot_hash FROM learning_releases WHERE id=$1::uuid',[baselineId]);
        const secondConversation=randomUUID();
        await sql("INSERT INTO conversations VALUES($1::uuid,$2::uuid,$3::uuid,'telegram',0)",[secondConversation,otherContact,agentId]);
        await sql("INSERT INTO messages VALUES($1::uuid,$3::uuid,'inbound','Necesito otro servicio',NOW()),($2::uuid,$3::uuid,'outbound','¿Qué servicio deseas?',NOW())",[randomUUID(),randomUUID(),secondConversation]);
        const importedSecond=await learning.importInbox(tenantId,agentId,secondConversation,'reviewer');
        const [secondSource]=await sql('SELECT * FROM learning_sources WHERE id=$1::uuid',[importedSecond.sourceId]);
        const [secondExample]=await sql('SELECT id FROM learning_examples WHERE source_id=$1::uuid',[secondSource.id]);
        const candidate=await evaluationCopy(secondSource,secondExample);
        await sql('UPDATE learning_releases SET baseline_release_id=$2::uuid WHERE id=$1::uuid',[candidate.releaseId,baselineId]);
        const scope={...scopeOf(candidate),namespace:undefined,baselineReleaseId:baselineId,baselineReleaseHash:baselineHash};
        const invoke=jest.fn(async()=>({content:'Judged',finishReason:'stop' as const}));
        await learning.runtimeSourceAuthority(tenantId,agentId,[],AGENT_TEST_EXECUTION_CONTEXT,scope)(invoke);
        await learning.checkpointEvaluation(tenantId,agentId,candidate.releaseId,candidate.attemptId,[],candidate.hash);
        expect(invoke).toHaveBeenCalledTimes(1);
        await sql("UPDATE messages SET content_text='Changed baseline only' WHERE conversation_id=$1::uuid AND direction='outbound'",[conversationId]);
        await expect(learning.checkpointEvaluation(tenantId,agentId,candidate.releaseId,candidate.attemptId,[],candidate.hash))
            .rejects.toBeInstanceOf(LearningInboxSourceUnavailable);
        await expect(learning.runtimeSourceAuthority(tenantId,agentId,[],AGENT_TEST_EXECUTION_CONTEXT,scope)(invoke)).rejects.toBeInstanceOf(LLMSourceAuthorityUnavailable);
        expect(invoke).toHaveBeenCalledTimes(1);
        // Source validity is independent of the train/holdout split; the original
        // review endpoint deliberately exposes train sources only.
        expect((await assertLearningInboxSource((text,params)=>prisma.executeInTenantSchema(schema,text,params),secondSource))?.conversationId).toBe(secondConversation);
    });
    it('retires registered copies and all baseline descendants after a source withdrawal, even without a live worker',async()=>{
        const {source,example}=await imported();const root=await evaluationCopy(source,example);
        const child=await evaluationCopy(source,example);
        await sql(`UPDATE learning_releases SET baseline_release_id=$2::uuid,snapshot='{"examples":[],"heldout":[]}'::jsonb,
            example_ids='{}'::uuid[],snapshot_hash=$3 WHERE id=$1::uuid`,[child.releaseId,root.releaseId,learningSnapshotHash({examples:[],heldout:[]})]);
        child.hash=learningSnapshotHash({examples:[],heldout:[]});
        for(const copy of [root,child]){
            await learning.registerEvaluationNamespace(tenantId,agentId,copy.releaseId,copy.attemptId,copy.hash,copy.lease);
            await learning.withEvaluationSources(tenantId,agentId,copy.releaseId,copy.attemptId,copy.hash,async()=>{
                await prisma.executeInTenantSchema(copy.lease.schemaName,"INSERT INTO contacts(id,name) VALUES($1::uuid,'PRIVATE_REPLAY_COPY')",[randomUUID()]);
            });
            expect(await exists(copy.lease)).toHaveLength(1);
        }
        // No worker/session object performs teardown. The durable source index does.
        await learning.withdrawSource(tenantId,agentId,source.id);
        for(const copy of [root,child])expect(await exists(copy.lease)).toHaveLength(0);
        expect(await sql('SELECT status,snapshot,evaluation,evaluation_namespaces,evaluation_status FROM learning_releases')).toEqual([
            {status:'retired',snapshot:{},evaluation:null,evaluation_namespaces:null,evaluation_status:'failed'},
            {status:'retired',snapshot:{},evaluation:null,evaluation_namespaces:null,evaluation_status:'failed'}]);
        await expect(learning.checkpointEvaluation(tenantId,agentId,root.releaseId,root.attemptId,[{private:'late-result'}],root.hash)).rejects.toThrow();
    });
    it('retracts what a published release produced when it is rolled back, and says who did it',async()=>{
        // `rollback` flipped one status column. It disposed no evaluation
        // namespace, redacted no derived reply and recorded no actor — so the
        // words a withdrawn release had already produced stayed in the outbox,
        // in the widget's deferred replies and in the envelope a turn would be
        // resumed from, ready to be delivered after the rollback. The function
        // that retracts all of it existed and had three callers, none of them
        // the one operator action most likely to need it.
        const {source,example}=await imported();
        const copy=await evaluationCopy(source,example);
        await learning.registerEvaluationNamespace(tenantId,agentId,copy.releaseId,copy.attemptId,copy.hash,copy.lease);
        await learning.withEvaluationSources(tenantId,agentId,copy.releaseId,copy.attemptId,copy.hash,async()=>{
            await prisma.executeInTenantSchema(copy.lease.schemaName,
                "INSERT INTO contacts(id,name) VALUES($1::uuid,'PRIVATE_REPLAY_COPY')",[randomUUID()]);
        });
        expect(await exists(copy.lease)).toHaveLength(1);
        await sql("UPDATE learning_releases SET status='published',published_at=NOW() WHERE id=$1::uuid",[copy.releaseId]);

        const result=await learning.rollback(tenantId,agentId,copy.releaseId,'operator-1');
        expect(result).toMatchObject({retired:copy.releaseId});
        expect((result as any).retractedReleases).toBeGreaterThanOrEqual(1);

        // The frozen holdout, the judge traces and the sandbox copy go with it.
        expect(await exists(copy.lease)).toHaveLength(0);
        const [row]=await sql(`SELECT status,snapshot,evaluation,evaluation_namespaces,retired_by,retired_at
            FROM learning_releases WHERE id=$1::uuid`,[copy.releaseId]);
        expect(row).toMatchObject({status:'retired',snapshot:{},evaluation:null,evaluation_namespaces:null,
            retired_by:'operator-1'});
        expect(row.retired_at).toBeTruthy();
    });

    it('refuses to roll back a release that is not published, and retracts nothing',async()=>{
        const {source,example}=await imported();
        const copy=await evaluationCopy(source,example);
        await learning.registerEvaluationNamespace(tenantId,agentId,copy.releaseId,copy.attemptId,copy.hash,copy.lease);
        await expect(learning.rollback(tenantId,agentId,copy.releaseId,'operator-1')).rejects.toThrow();
        // A refused rollback is not a quiet retraction: the candidate keeps its
        // snapshot and its namespace registration.
        expect((await sql('SELECT status FROM learning_releases WHERE id=$1::uuid',[copy.releaseId]))[0].status)
            .toBe('candidate');
        expect((await sql('SELECT evaluation_namespaces FROM learning_releases WHERE id=$1::uuid',[copy.releaseId]))[0]
            .evaluation_namespaces).toHaveLength(1);
    });

    it('rejects a forged namespace, superseded attempt and changed source before copying',async()=>{
        const {source,example}=await imported();const copy=await evaluationCopy(source,example);
        await expect(learning.registerEvaluationNamespace(tenantId,agentId,copy.releaseId,copy.attemptId,copy.hash,{...copy.lease,token:randomUUID()})).rejects.toThrow();
        await expect(learning.registerEvaluationNamespace(tenantId,agentId,copy.releaseId,randomUUID(),copy.hash,copy.lease)).rejects.toThrow();
        expect((await sql('SELECT evaluation_namespaces FROM learning_releases'))[0].evaluation_namespaces).toBeNull();
        await learning.registerEvaluationNamespace(tenantId,agentId,copy.releaseId,copy.attemptId,copy.hash,copy.lease);
        await sql("UPDATE messages SET content_text='Changed before copy' WHERE direction='outbound'");
        const write=jest.fn();
        await expect(learning.withEvaluationSources(tenantId,agentId,copy.releaseId,copy.attemptId,copy.hash,write)).rejects.toBeInstanceOf(LearningInboxSourceUnavailable);
        expect(write).not.toHaveBeenCalled();
        await learning.withdrawSource(tenantId,agentId,source.id);
        expect(await exists(copy.lease)).toHaveLength(0);
    });
    it('keeps provenance and source state when the registered namespace owner no longer matches',async()=>{
        const {source,example}=await imported();const copy=await evaluationCopy(source,example);
        await learning.registerEvaluationNamespace(tenantId,agentId,copy.releaseId,copy.attemptId,copy.hash,copy.lease);
        try{
            await prisma.executeInTenantSchema(copy.lease.schemaName,'UPDATE __eval_namespace SET owner_token=$1::uuid',[randomUUID()]);
            await expect(learning.withdrawSource(tenantId,agentId,source.id)).rejects.toThrow('eval_namespace_owner_mismatch');
            expect(await exists(copy.lease)).toHaveLength(1);
            expect((await sql('SELECT status FROM learning_sources WHERE id=$1::uuid',[source.id]))[0].status).toBe('active');
            expect((await sql('SELECT evaluation_namespaces FROM learning_releases'))[0].evaluation_namespaces).toHaveLength(1);
        }finally{
            await prisma.executeInTenantSchema(copy.lease.schemaName,'UPDATE __eval_namespace SET owner_token=$1::uuid',[copy.lease.token]);
        }
        await learning.eraseContactSources(schema,tenantId,[contactId]);
        expect(await exists(copy.lease)).toHaveLength(0);
    });
    it('cleans only the finishing worker names and leaves other names or attempts recoverable',async()=>{
        const {source,example}=await imported();const copy=await evaluationCopy(source,example);
        const other=await namespaces.provision(tenantId,schema,['contacts','conversations','messages']);leases.push(other);
        for(const lease of [copy.lease,other])await learning.registerEvaluationNamespace(tenantId,agentId,copy.releaseId,copy.attemptId,copy.hash,lease);
        expect(await learning.cleanEvaluationNamespaces(tenantId,agentId,copy.releaseId,randomUUID(),[copy.lease.schemaName])).toBe(0);
        // Normal sandbox disposal may already have committed. Registry cleanup is idempotent.
        await namespaces.dispose(copy.lease);
        expect(await learning.cleanEvaluationNamespaces(tenantId,agentId,copy.releaseId,copy.attemptId,[copy.lease.schemaName])).toBe(1);
        expect(await exists(other)).toHaveLength(1);
        expect((await sql('SELECT evaluation_namespaces FROM learning_releases'))[0].evaluation_namespaces.map((v:any)=>v.schemaName)).toEqual([other.schemaName]);
        expect(await learning.cleanEvaluationNamespaces(tenantId,agentId,copy.releaseId,copy.attemptId,[copy.lease.schemaName])).toBe(0);
        expect(await learning.cleanEvaluationNamespaces(tenantId,agentId,copy.releaseId,copy.attemptId,[other.schemaName])).toBe(1);
        expect((await sql('SELECT evaluation_namespaces FROM learning_releases'))[0].evaluation_namespaces).toBeNull();
    });
    it('recovers queues through Prisma and removes expired terminal copies using the actual ownership marker',async()=>{
        const {source,example}=await imported();
        const terminal=await evaluationCopy(source,example),active=await evaluationCopy(source,example),missing=await evaluationCopy(source,example),completed=await evaluationCopy(source,example);
        for(const copy of [terminal,active])await learning.registerEvaluationNamespace(tenantId,agentId,copy.releaseId,copy.attemptId,copy.hash,copy.lease);
        await sql("UPDATE learning_releases SET evaluation_status='failed' WHERE id=$1::uuid",[terminal.releaseId]);
        // A registry timestamp is diagnostic; the namespace marker is authoritative.
        await prisma.executeInTenantSchema(terminal.lease.schemaName,"UPDATE __eval_namespace SET expires_at=clock_timestamp()-interval '1 second'");
        await sql("UPDATE learning_releases SET evaluation_namespaces=jsonb_set(evaluation_namespaces,'{0,expiresAt}','\"2000-01-01T00:00:00Z\"') WHERE id=$1::uuid",[active.releaseId]);
        const queue={getJob:jest.fn(async(id:string)=>id===`learning-${active.attemptId}`?{getState:async()=> 'active'}:
            id===`learning-${completed.attemptId}`?{getState:async()=> 'completed'}:undefined),add:jest.fn()};
        const recovery=new LearningEvaluationService(learning,{} as any,{} as any,llm as any,queue as any,prisma);
        await recovery.recoverQueuedEvaluations();
        expect(await exists(terminal.lease)).toHaveLength(0);expect(await exists(active.lease)).toHaveLength(1);
        expect((await sql('SELECT evaluation_namespaces FROM learning_releases WHERE id=$1::uuid',[terminal.releaseId]))[0].evaluation_namespaces).toBeNull();
        expect(queue.add).toHaveBeenCalledTimes(1);
        expect(queue.add.mock.calls[0][1]).toEqual({tenantId,agentId,releaseId:missing.releaseId,attemptId:missing.attemptId});
        expect((await sql('SELECT evaluation_status,evaluation FROM learning_releases WHERE id=$1::uuid',[completed.releaseId]))[0])
            .toMatchObject({evaluation_status:'failed',evaluation:{error:'worker_interrupted',passed:false}});
    });
    it('rejects late checkpoints and final evidence after the exact heldout source changes',async()=>{
        const {source,example}=await imported();const copy=await evaluationCopy(source,example);
        // Isolate the commit path from the release-construction split tests.
        const snapshot={examples:[],heldout:[{source_id:source.id}]};copy.hash=learningSnapshotHash(snapshot);
        await sql("UPDATE learning_releases SET snapshot=$2::jsonb,snapshot_hash=$3,example_ids='{}',evaluation=evaluation||$4::jsonb WHERE id=$1::uuid",
            [copy.releaseId,JSON.stringify(snapshot),copy.hash,JSON.stringify({dependencyHash:'dep',agentSnapshot:{configHash:'config'}})]);
        const evidence={attemptId:copy.attemptId,releaseHash:copy.hash,baselineReleaseId:null,agentRevision:'config',dependencyHash:'dep',
            results:[{sourceId:source.id,candidateCompleted:true,baselineCompleted:true,candidateScore:90,baselineScore:80,criticalFailures:[],traceHash:'trace'}]};
        await learning.checkpointEvaluation(tenantId,agentId,copy.releaseId,copy.attemptId,evidence.results,copy.hash);
        expect((await sql('SELECT evaluation FROM learning_releases'))[0].evaluation.results).toEqual(evidence.results);
        expect((await learning.recordEvaluation(tenantId,agentId,copy.releaseId,evidence)).passed).toBe(true);
        await sql("UPDATE learning_releases SET evaluation_status='running' WHERE id=$1::uuid",[copy.releaseId]);
        await sql("UPDATE messages SET content_text='Changed after replay' WHERE direction='outbound'");
        await expect(learning.checkpointEvaluation(tenantId,agentId,copy.releaseId,copy.attemptId,[{private:'late trace'}],copy.hash)).rejects.toBeInstanceOf(LearningInboxSourceUnavailable);
        await expect(learning.recordEvaluation(tenantId,agentId,copy.releaseId,evidence)).rejects.toBeInstanceOf(LearningInboxSourceUnavailable);
        expect(JSON.stringify((await sql('SELECT evaluation FROM learning_releases'))[0])).not.toContain('late trace');
    });
    it('reaps expired copies for inactive tenants without restarting their evaluation jobs',async()=>{
        const {source,example}=await imported();const copy=await evaluationCopy(source,example);
        await learning.registerEvaluationNamespace(tenantId,agentId,copy.releaseId,copy.attemptId,copy.hash,copy.lease);
        await prisma.executeInTenantSchema(copy.lease.schemaName,"UPDATE __eval_namespace SET expires_at=clock_timestamp()-interval '1 second'");
        (prisma.tenant.findMany as jest.Mock).mockResolvedValueOnce([{id:tenantId,schemaName:schema,isActive:false}]);
        const queue={getJob:jest.fn(),add:jest.fn()};
        await new LearningEvaluationService(learning,{} as any,{} as any,llm as any,queue as any,prisma).recoverQueuedEvaluations();
        expect(await exists(copy.lease)).toHaveLength(0);expect(queue.getJob).not.toHaveBeenCalled();expect(queue.add).not.toHaveBeenCalled();
    });
});
