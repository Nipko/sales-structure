import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LearningService } from './learning.service';
import { learningHash, learningSnapshotHash, type RuntimeLearningExample } from './learning-contracts';
import { learningInboxEvidence, readLearningInboxSource } from './learning-inbox-source';
import { assertRuntimeLearningFootprint, createRuntimeLearningFootprint } from './learning-runtime-footprint';
import { LLMSourceAuthorityUnavailable } from '../ai/interfaces/llm-source-authority';
import { AGENT_TEST_EXECUTION_CONTEXT } from '../../common/types/execution-context';

const databaseUrl = process.env.LEARNING_EVIDENCE_TEST_DATABASE_URL || process.env.KNOWLEDGE_MEMORY_TEST_DATABASE_URL;
(databaseUrl ? describe : describe.skip)('runtime learning footprint admission in PostgreSQL', () => {
    const tenantId = randomUUID(), agentId = randomUUID();
    const schema = `tenant_learning_footprint_${randomUUID().replace(/-/g,'')}`;
    let client: PrismaClient, prisma: PrismaService, learning: LearningService;
    const sql = (query: string, params: any[] = []) => prisma.executeInTenantSchema<any[]>(schema, query, params);
    const expected = { tenantId, agentId };
    beforeAll(async () => {
        const url = new URL(databaseUrl!);
        if (!['127.0.0.1','localhost'].includes(url.hostname) || !url.pathname.endsWith('_eval_isolation'))
            throw new Error('disposable_loopback_database_required');
        client = new PrismaClient({ datasourceUrl: databaseUrl });
        await client.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS public.tenants(id UUID PRIMARY KEY,schema_name TEXT)');
        await client.$executeRawUnsafe('INSERT INTO public.tenants(id,schema_name) VALUES($1::uuid,$2)', tenantId, schema);
        await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
        prisma = Object.create(PrismaService.prototype);
        prisma.$transaction = client.$transaction.bind(client);
        prisma.getTenantSchemaName = jest.fn(async () => schema);
        await sql('CREATE TABLE contacts(id UUID PRIMARY KEY,name TEXT,phone TEXT,email TEXT)');
        await sql('CREATE TABLE conversations(id UUID PRIMARY KEY,contact_id UUID REFERENCES contacts(id),agent_id UUID,channel_type TEXT,qa_revision BIGINT NOT NULL DEFAULT 0)');
        await sql('CREATE TABLE messages(id UUID PRIMARY KEY,conversation_id UUID REFERENCES conversations(id),direction TEXT,content_text TEXT,created_at TIMESTAMPTZ)');
        await sql('CREATE TABLE contact_identities(contact_id UUID,customer_profile_id UUID)');
        await sql('CREATE TABLE customer_memory_erasure(contact_id UUID PRIMARY KEY)');
        const ddl = readFileSync(join(__dirname,'../../../prisma/tenant-schema.sql'),'utf8');
        const start = ddl.indexOf('CREATE OR REPLACE FUNCTION "{{SCHEMA_NAME}}".qa_message_revision()');
        const end = ddl.indexOf('CREATE OR REPLACE TRIGGER qa_conversation_revision', start);
        const trigger = ddl.indexOf('CREATE OR REPLACE TRIGGER qa_message_revision', end);
        expect(start).toBeGreaterThan(0); expect(trigger).toBeGreaterThan(end);
        await sql(ddl.slice(start,end).replaceAll('{{SCHEMA_NAME}}',schema));
        await sql(ddl.slice(trigger,ddl.indexOf(';',trigger)+1).replaceAll('{{SCHEMA_NAME}}',schema));
        learning = new LearningService(prisma, {} as any, {} as any);
        await learning.ensureTables(schema);
    });
    beforeEach(async () => {
        await sql('TRUNCATE learning_sources,learning_releases,contacts,customer_memory_erasure,contact_identities CASCADE');
    });
    afterAll(async () => {
        if (!client) return;
        try {
            if (!/^tenant_learning_footprint_[a-f\d]{32}$/.test(schema)) throw new Error('invalid_cleanup_scope');
            await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
            await client.$executeRawUnsafe('DELETE FROM public.tenants WHERE id=$1::uuid AND schema_name=$2',tenantId,schema);
        } finally { await client.$disconnect(); }
    });
    async function fixture() {
        const sources: Array<{id:string;conversationId:string;contactId:string}> = [];
        for (const split of ['train','holdout']) {
            const id=randomUUID(), contactId=randomUUID(), conversationId=randomUUID();
            await sql("INSERT INTO contacts VALUES($1::uuid,'Customer',NULL,NULL)",[contactId]);
            await sql("INSERT INTO conversations VALUES($1::uuid,$2::uuid,$3::uuid,'web_widget',0)",[conversationId,contactId,agentId]);
            await sql(`INSERT INTO messages VALUES($1::uuid,$3::uuid,'inbound','Please help.','2026-09-01T12:00:00Z'),
                ($2::uuid,$3::uuid,'outbound','How can I help?','2026-09-01T12:00:01Z')`,[randomUUID(),randomUUID(),conversationId]);
            const source = await readLearningInboxSource((query,params)=>prisma.executeInTenantSchema(schema,query,params),conversationId);
            await sql(`INSERT INTO learning_sources(id,agent_id,source_kind,source_key,group_key,source_contact_id,source_conversation_id,
                split,channel,language,transcript,content_hash,created_by,source_evidence)
                VALUES($1::uuid,$2::uuid,'inbox',$3,$4,$5::uuid,$6::uuid,$7,'web_widget','en',$8::jsonb,$9,'fixture',$10::jsonb)`,
                [id,agentId,learningHash(id),learningHash(contactId),contactId,conversationId,split,JSON.stringify(source.messages),
                    learningSnapshotHash(source.messages),JSON.stringify(learningInboxEvidence(agentId,source,source.messages))]);
            sources.push({id,conversationId,contactId});
        }
        const exampleId=randomUUID(), releaseId=randomUUID();
        const frozen={id:exampleId,source_id:sources[0].id,kind:'brand_style',intent:'support',
            response_pattern:'I can help. What should we check?',rationale:'One focused question.',facts_required:['verified status']};
        await sql(`INSERT INTO learning_examples(id,source_id,agent_id,kind,intent,episode,content_hash,response_pattern,rationale,facts_required,status)
            VALUES($1::uuid,$2::uuid,$3::uuid,'brand_style','support','[]'::jsonb,$4,$5,$6,$7::jsonb,'approved')`,
            [exampleId,sources[0].id,agentId,learningHash(exampleId),frozen.response_pattern,frozen.rationale,JSON.stringify(frozen.facts_required)]);
        const snapshot={examples:[frozen],heldout:[{source_id:sources[1].id}]}, releaseHash=learningSnapshotHash(snapshot);
        await sql(`INSERT INTO learning_releases(id,agent_id,status,example_ids,snapshot,snapshot_hash,created_by)
            VALUES($1::uuid,$2::uuid,'published',$3::uuid[],$4::jsonb,$5,'fixture')`,
            [releaseId,agentId,[exampleId],JSON.stringify(snapshot),releaseHash]);
        const selected:RuntimeLearningExample[]=[{id:exampleId,releaseId,releaseHash,situation:frozen.intent,
            responsePattern:frozen.response_pattern,rationale:frozen.rationale,factsRequired:frozen.facts_required,authority:'style_only'}];
        return {sources,exampleId,releaseId,selected,footprint:createRuntimeLearningFootprint(tenantId,agentId,selected)};
    }
    const check = (footprint: ReturnType<typeof createRuntimeLearningFootprint>, mode:'readonly'|'admission'='readonly') =>
        prisma.transactionInTenantSchema(schema,query=>assertRuntimeLearningFootprint(query,schema,expected,footprint,{mode}));

    it('round-trips a content-free footprint and retains the existing lock-free read path',async()=>{
        const f=await fixture(), statements:string[]=[];
        const restored=JSON.parse(JSON.stringify(f.footprint));
        await prisma.transactionInTenantSchema(schema,query=>assertRuntimeLearningFootprint(
            async <R>(text:string,params?:any[])=>{statements.push(text);return query<R>(text,params);},schema,expected,restored,{mode:'readonly'}));
        expect(JSON.stringify(restored)).not.toContain(f.selected[0].responsePattern);
        expect(statements.some(statement=>/FOR SHARE|LOCK TABLE|pg_advisory/.test(statement))).toBe(false);
        await check(restored,'admission');
    });
    it('validates tenant/schema binding for explicit empty selection without granting business authority',async()=>{
        const empty=createRuntimeLearningFootprint(tenantId,agentId,[]);
        await check(empty); await check(empty,'admission');
        await expect(prisma.transactionInTenantSchema(schema,query=>assertRuntimeLearningFootprint(
            query,`${schema}_foreign`,expected,empty,{mode:'readonly'}))).rejects.toBeInstanceOf(LLMSourceAuthorityUnavailable);
        const foreign=randomUUID();
        await expect(prisma.transactionInTenantSchema(schema,query=>assertRuntimeLearningFootprint(
            query,schema,{tenantId:foreign,agentId},{...empty,tenantId:foreign},{mode:'readonly'}))).rejects.toBeInstanceOf(LLMSourceAuthorityUnavailable);
    });
    it.each(['projection','release_hash','snapshot','foreign_agent','foreign_source'] as const)('rejects changed %s',async change=>{
        const f=await fixture();
        if(change==='projection')f.selected[0].rationale='Different reason';
        if(change==='release_hash')f.selected[0].releaseHash='f'.repeat(64);
        if(change==='snapshot')await sql(`UPDATE learning_releases SET snapshot=jsonb_set(snapshot,'{examples,0,intent}','"different"'::jsonb)`);
        if(change==='foreign_agent')await sql('UPDATE learning_releases SET agent_id=$1::uuid',[randomUUID()]);
        if(change==='foreign_source')await sql('UPDATE learning_sources SET agent_id=$1::uuid',[randomUUID()]);
        await expect(check(createRuntimeLearningFootprint(tenantId,agentId,f.selected))).rejects.toBeInstanceOf(LLMSourceAuthorityUnavailable);
    });
    it.each(['train','holdout'] as const)('rejects original Inbox edits and erasure of %s sources',async split=>{
        const f=await fixture(), source=f.sources[split==='train'?0:1];
        await sql('INSERT INTO customer_memory_erasure VALUES($1::uuid)',[source.contactId]);
        await expect(check(f.footprint)).rejects.toBeInstanceOf(LLMSourceAuthorityUnavailable);
        await sql('DELETE FROM customer_memory_erasure');
        await sql("UPDATE messages SET content_text='Changed original' WHERE conversation_id=$1::uuid AND direction='outbound'",[source.conversationId]);
        await expect(check(f.footprint)).rejects.toThrow();
    });

    async function waitForBlockedQuery(pattern:string) {
        const deadline=Date.now()+5000;
        while(Date.now()<deadline){
            const rows=await client.$queryRawUnsafe(`SELECT EXISTS(
                SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()
                AND query LIKE $1 AND cardinality(pg_blocking_pids(pid))>0) AS blocked`,pattern) as Array<{blocked:boolean}>;
            if(rows[0].blocked)return;
            await new Promise(resolve=>setTimeout(resolve,20));
        }
        throw new Error('expected_database_lock_not_observed');
    }
    it.each(['rollback','example_retirement','heldout_edit','source_withdrawal'] as const)(
        'holds admission authority until COMMIT against real %s',async action=>{
            const f=await fixture();
            let entered!:()=>void, finish!:()=>void, recheck!:()=>Promise<void>;
            const ready=new Promise<void>(resolve=>{entered=resolve;});
            const release=new Promise<void>(resolve=>{finish=resolve;});
            const holding=prisma.transactionInTenantSchema(schema,async query=>{
                await assertRuntimeLearningFootprint(query,schema,expected,f.footprint,{mode:'admission'});
                recheck=()=>assertRuntimeLearningFootprint(query,schema,expected,f.footprint,{mode:'admission'});
                entered(); await release;
            },{timeout:15000});
            // Surface a fixture/guard failure instead of waiting on an unfulfilled gate.
            await Promise.race([ready,holding.then(()=>{throw new Error('admission_ended_before_gate');})]);
            const mutation=action==='rollback'?learning.rollback(tenantId,agentId,f.releaseId)
                :action==='source_withdrawal'?learning.withdrawSource(tenantId,agentId,f.sources[1].id)
                :action==='example_retirement'?sql("UPDATE learning_examples SET status='retired' WHERE id=$1::uuid",[f.exampleId])
                :sql("UPDATE messages SET content_text='Edit heldout after admission' WHERE conversation_id=$1::uuid",[f.sources[1].conversationId]);
            let done=false; const settled=mutation.finally(()=>{done=true;});
            try{
                await waitForBlockedQuery(action==='rollback'?'%UPDATE learning_releases%'
                    :action==='source_withdrawal'?'%pg_advisory_xact_lock(%'
                    :action==='example_retirement'?'%UPDATE learning_examples%':'%UPDATE messages%');
                expect(done).toBe(false);
                // Includes privacy X already queued: a repeat on THIS query is
                // reentrant and must not acquire another connection's shared lock.
                await recheck();
            }finally{finish();await holding;await settled;}
            await expect(check(f.footprint)).rejects.toThrow();
        });
    it('retains readonly wrapper rechecks, usage evidence and ordinary provider errors',async()=>{
        const f=await fixture(), usage={promptTokens:4,completionTokens:3,totalTokens:7};
        const authority=learning.runtimeSourceAuthority(tenantId,agentId,f.selected);
        // Readonly provider callbacks do not hold release or Inbox row locks.
        let failure:unknown;
        try{await authority(async()=>{
            await learning.rollback(tenantId,agentId,f.releaseId);
            return {content:'Must be discarded',finishReason:'stop',usage};
        });}catch(error){failure=error;}
        expect(failure).toBeInstanceOf(LLMSourceAuthorityUnavailable);
        expect((failure as LLMSourceAuthorityUnavailable).usage).toEqual(usage);
        const provider=jest.fn(async()=>({content:'No',finishReason:'stop' as const}));
        await expect(authority(provider)).rejects.toBeInstanceOf(LLMSourceAuthorityUnavailable);
        expect(provider).not.toHaveBeenCalled();
        await sql("UPDATE learning_releases SET status='published'");
        const original=new Error('provider unavailable');
        await expect(authority(async()=>{throw original;})).rejects.toBe(original);
    });
    it('allows candidate projections only in the existing readonly preview wrapper',async()=>{
        const f=await fixture(); await sql("UPDATE learning_releases SET status='candidate'");
        await expect(check(f.footprint,'admission')).rejects.toBeInstanceOf(LLMSourceAuthorityUnavailable);
        const provider=jest.fn(async()=>({content:'Preview',finishReason:'stop' as const}));
        await expect(learning.runtimeSourceAuthority(tenantId,agentId,f.selected)(provider)).rejects.toBeInstanceOf(LLMSourceAuthorityUnavailable);
        expect((await learning.runtimeSourceAuthority(tenantId,agentId,f.selected,AGENT_TEST_EXECUTION_CONTEXT)(provider)).content).toBe('Preview');
        expect(provider).toHaveBeenCalledTimes(1);
    });
});
