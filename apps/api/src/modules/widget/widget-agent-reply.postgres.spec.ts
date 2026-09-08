import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WidgetMessageStore } from './widget-message-store.service';
import { WidgetAgentReplyStore, type WidgetAgentReplyInput } from './widget-agent-reply.store';
import { operationalConfigurationHash } from '../persona/agent-configuration-revision';
import { revisionHash } from '../evaluation-revision/evaluation-revision';
import { createRuntimeLearningFootprint } from '../learning/learning-runtime-footprint';
import { learningSnapshotHash, type RuntimeLearningExample } from '../learning/learning-contracts';
import { learningInboxEvidence, readLearningInboxSource } from '../learning/learning-inbox-source';
import { redactWidgetAgentReplies } from './widget-agent-reply-retention';
import { HANDOFF_RECEIPT_DDL, recordHandoffReceipt } from '../handoff/handoff-receipt';
import { handoffNoticeText, type HandoffNoticeKind, type HandoffNoticeLanguage } from '../handoff/handoff-notice';

const databaseUrl=process.env.PARALLLY_ISOLATION_TEST_URL;
(databaseUrl?describe:describe.skip)('normal Web Chat reply admission with Prisma and PostgreSQL',()=>{
    const tenantId=randomUUID(),agentId=randomUUID(),schema=`tenant_widget_reply_${randomUUID().replace(/-/g,'')}`;
    const widgetId=`wgt_${randomUUID()}`,widgetConfigId=randomUUID();
    let client:PrismaClient,prisma:PrismaService,messages:WidgetMessageStore,store:WidgetAgentReplyStore;
    let second:PrismaClient,racer:PrismaService;
    let input:WidgetAgentReplyInput;
    const relay={publish:jest.fn()};
    const sql=(statement:string,params:any[]=[])=>prisma.executeInTenantSchema<any[]>(schema,statement,params);
    const config={get:()=> 'synthetic-widget-jwt-secret-32-characters',getOrThrow:()=> 'synthetic-widget-jwt-secret-32-characters'};
    beforeAll(async()=>{
        const url=new URL(databaseUrl!);
        if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!=='/parallly_eval_isolation')throw new Error('disposable_database_required');
        client=new PrismaClient({datasourceUrl:databaseUrl});
        await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
        await client.$executeRawUnsafe('INSERT INTO public.tenants(id,schema_name,is_active) VALUES($1::uuid,$2,true)',tenantId,schema);
        prisma=Object.create(PrismaService.prototype);prisma.$transaction=client.$transaction.bind(client);
        second=new PrismaClient({datasourceUrl:databaseUrl});
        racer=Object.create(PrismaService.prototype);racer.$transaction=second.$transaction.bind(second);
        const ddl=readFileSync(join(__dirname,'../../../prisma/tenant-schema.sql'),'utf8');
        const base=ddl.slice(ddl.indexOf('-- ---- Contacts ----'),ddl.indexOf('-- ---- Central AI Tool Authority')).replaceAll('{{SCHEMA_NAME}}',schema);
        for(const statement of (prisma as any).splitSqlStatements(base))await client.$executeRawUnsafe(statement);
        await sql('ALTER TABLE conversations ADD COLUMN qa_revision BIGINT NOT NULL DEFAULT 0');
        const fn=ddl.indexOf('CREATE OR REPLACE FUNCTION "{{SCHEMA_NAME}}".qa_message_revision()');
        const end=ddl.indexOf('CREATE OR REPLACE TRIGGER qa_conversation_revision',fn);
        const trigger=ddl.indexOf('CREATE OR REPLACE TRIGGER qa_message_revision',end);
        await sql(ddl.slice(fn,end).replaceAll('{{SCHEMA_NAME}}',schema));
        await sql(ddl.slice(trigger,ddl.indexOf(';',trigger)+1).replaceAll('{{SCHEMA_NAME}}',schema));
        await sql('CREATE TABLE contact_identities(contact_id UUID,customer_profile_id UUID)');
        await sql('CREATE TABLE customer_memory_erasure(contact_id UUID PRIMARY KEY)');
        await sql(`CREATE TABLE agent_personas(id UUID PRIMARY KEY,name TEXT,config_json JSONB,channels TEXT[],channel_bindings TEXT[],
            schedule_mode TEXT,is_active BOOLEAN,is_default BOOLEAN,version INTEGER)`);
        await sql('CREATE TABLE persona_config(config_json JSONB,is_active BOOLEAN,version INTEGER)');
        await sql(`CREATE TABLE learning_sources(id UUID PRIMARY KEY,agent_id UUID,source_kind TEXT,status TEXT,
            source_contact_id UUID,source_conversation_id UUID,channel TEXT,transcript JSONB,source_evidence JSONB)`);
        await sql('CREATE TABLE learning_examples(id UUID PRIMARY KEY,source_id UUID,agent_id UUID,status TEXT)');
        await sql('CREATE TABLE learning_releases(id UUID PRIMARY KEY,agent_id UUID,status TEXT,snapshot JSONB,snapshot_hash TEXT,example_ids UUID[])');
        const publicDDL=readFileSync(join(__dirname,'widget.service.ts'),'utf8');
        for(const table of ['widget_configs','widget_sessions']){
            const start=publicDDL.indexOf(`CREATE TABLE IF NOT EXISTS public.${table}`);
            await client.$executeRawUnsafe(publicDDL.slice(start,publicDDL.indexOf('`',start)));
        }
        await client.$executeRawUnsafe(`INSERT INTO public.widget_configs(id,tenant_id,widget_id,allowed_domains,locale)
            VALUES($1::uuid,$2::uuid,$3,ARRAY['example.test'],'en')`,widgetConfigId,tenantId,widgetId);
        for(const statement of HANDOFF_RECEIPT_DDL)await sql(statement);
        messages=new WidgetMessageStore(prisma,{} as any,relay as any,{} as any,config as any);
        // Only entitlement/plan lookup is stubbed. Admission tenant, routing,
        // session/contact, source, inbound and receipt checks use real SQL.
        jest.spyOn(messages,'assertAvailable').mockResolvedValue(schema);
        store=new WidgetAgentReplyStore(prisma,messages);
    });
    beforeEach(async()=>{
        jest.restoreAllMocks();relay.publish.mockClear();
        jest.spyOn(messages,'assertAvailable').mockResolvedValue(schema);
        await sql('DELETE FROM agent_personas');await sql('DELETE FROM persona_config');
        await sql(`INSERT INTO agent_personas VALUES($1::uuid,'Alex','{"persona":{"name":"Alex"}}',ARRAY['web_widget'],
            '{}'::text[],'24_7',true,true,1)`,[agentId]);
        input=await freshInput();
    });
    afterAll(async()=>{
        if(!client)return;
        try{
            if(!/^tenant_widget_reply_[a-f\d]{32}$/.test(schema))throw new Error('invalid_cleanup_scope');
            await client.$executeRawUnsafe('DELETE FROM public.widget_sessions WHERE tenant_id=$1::uuid',tenantId);
            await client.$executeRawUnsafe('DELETE FROM public.widget_configs WHERE tenant_id=$1::uuid',tenantId);
            await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
            await client.$executeRawUnsafe('DELETE FROM public.tenants WHERE id=$1::uuid AND schema_name=$2',tenantId,schema);
        }finally{await client.$disconnect();await second?.$disconnect();}
    });
    /** Hold a real second transaction open, then release it, so the admission
     * has to wait on the same locks it takes in production. */
    function racing(statements:[string,any[]][]){
        let started:()=>void,release:()=>void;
        const ready=new Promise<void>(resolve=>{started=resolve;});
        const gate=new Promise<void>(resolve=>{release=resolve;});
        const done=racer.transactionInTenantSchema(schema,async query=>{
            for(const [statement,params] of statements)await query(statement,params);
            started();await gate;
        });
        return {ready,done,release:()=>release()};
    }
    /** Let the admission reach the lock the racing transaction already holds. */
    const settle=()=>new Promise(resolve=>setTimeout(resolve,150));
    async function freshInput():Promise<WidgetAgentReplyInput>{
        const conversationId=randomUUID(),contactId=randomUUID(),sessionId=randomUUID(),inboundMessageId=randomUUID();
        await sql("INSERT INTO contacts(id,external_id,channel_type) VALUES($1::uuid,$2,'web_widget')",[contactId,`widget_${sessionId}`]);
        await sql(`INSERT INTO conversations(id,contact_id,channel_type,channel_account_id,metadata)
            VALUES($1::uuid,$2::uuid,'web_widget',$3,$4::jsonb)`,[conversationId,contactId,widgetId,JSON.stringify({widgetSessionId:sessionId})]);
        await client.$executeRawUnsafe(`INSERT INTO public.widget_sessions(id,widget_config_id,tenant_id,visitor_id,token,contact_id,conversation_id,last_seen_at)
            VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,$6::uuid,$7::uuid,NOW())`,sessionId,widgetConfigId,tenantId,randomUUID(),randomUUID(),contactId,conversationId);
        await sql(`INSERT INTO messages(id,conversation_id,direction,content_type,content_text)
            VALUES($1::uuid,$2::uuid,'inbound','text','Help me')`,[inboundMessageId,conversationId]);
        const [agent]=await sql('SELECT * FROM agent_personas WHERE id=$1::uuid',[agentId]);
        return {tenantId,schemaName:schema,conversationId,contactId,inboundMessageId,channelAccountId:widgetId,text:'A final answer',
            operationalScope:{tenantId,schemaName:schema,kind:'agent',agentId,version:1,operationalHash:operationalConfigurationHash(agent)},
            learningFootprints:[createRuntimeLearningFootprint(tenantId,agentId,[])]};
    }
    async function learningGroup(target=input,sourceAgent=agentId,inbox=false){
        const sourceIds=[randomUUID(),randomUUID()],exampleId=randomUUID(),releaseId=randomUUID();
        let evidence:any=null,transcript:any[]=[];
        if(inbox){
            await sql("INSERT INTO messages(conversation_id,direction,content_text) VALUES($1::uuid,'outbound','Earlier reviewed answer')",[target.conversationId]);
            const source=await readLearningInboxSource((text,params)=>prisma.executeInTenantSchema(schema,text,params),target.conversationId);
            transcript=source.messages;evidence=learningInboxEvidence(sourceAgent,source,transcript);
        }
        for(const id of sourceIds)await sql(`INSERT INTO learning_sources VALUES($1::uuid,$2::uuid,$3,'active',$4::uuid,$5::uuid,
            'web_widget',$6::jsonb,$7::jsonb)`,[id,sourceAgent,inbox?'inbox':'file',inbox?target.contactId:null,
                inbox?target.conversationId:null,JSON.stringify(transcript),JSON.stringify(evidence)]);
        await sql("INSERT INTO learning_examples VALUES($1::uuid,$2::uuid,$3::uuid,'approved')",[exampleId,sourceIds[0],sourceAgent]);
        const frozen={id:exampleId,source_id:sourceIds[0],kind:'brand_style',intent:'general',response_pattern:'Be helpful.',rationale:'Reviewed.',facts_required:[]};
        const snapshot={examples:[frozen],heldout:[{source_id:sourceIds[1]}]},hash=learningSnapshotHash(snapshot);
        await sql("INSERT INTO learning_releases VALUES($1::uuid,$2::uuid,'published',$3::jsonb,$4,$5::uuid[])",[releaseId,sourceAgent,JSON.stringify(snapshot),hash,[exampleId]]);
        const example:RuntimeLearningExample={id:exampleId,releaseId,releaseHash:hash,situation:frozen.intent,responsePattern:frozen.response_pattern,
            rationale:frozen.rationale,factsRequired:[],authority:'style_only'};
        return {sourceIds,releaseId,footprint:createRuntimeLearningFootprint(tenantId,sourceAgent,[example])};
    }
    const count=async()=>Number((await sql('SELECT COUNT(*) AS count FROM widget_agent_replies WHERE inbound_message_id=$1::uuid',[input.inboundMessageId]))[0].count);

    it('atomically stores one final message and private receipt, then returns the same accepted reference after publication',async()=>{
        expect(await store.lookup(tenantId,input)).toBeNull();
        const first=await store.commit(input);
        expect(first.status).toBe('stored');expect(first.messages).toHaveLength(1);
        const [message]=await sql('SELECT * FROM messages WHERE id=$1::uuid',[first.messages[0].messageId]);
        expect(message.content_text).toBe(input.text);expect(message.status).toBe('pending');
        await sql('UPDATE agent_personas SET version=2,is_active=false');
        expect(await store.lookup(tenantId,input)).toEqual(first);expect(await store.commit(input)).toEqual(first);
        expect(await count()).toBe(1);expect(relay.publish).toHaveBeenCalled();
    });
    it.each(['version','config','inactive','routing','draft'] as const)('blocks new local admission after %s changes',async change=>{
        if(change==='version')await sql('UPDATE agent_personas SET version=2');
        if(change==='config')await sql(`UPDATE agent_personas SET config_json='{"persona":{"name":"Updated"}}'`);
        if(change==='inactive')await sql('UPDATE agent_personas SET is_active=false');
        if(change==='routing')await sql(`INSERT INTO agent_personas VALUES($1::uuid,'Other','{"persona":{"name":"Other"}}','{}',
            ARRAY[$2],'24_7',true,false,1)`,[randomUUID(),`web_widget:${widgetId}`]);
        if(change==='draft'){
            await sql(`UPDATE agent_personas SET config_json='{"behavior":{"draftMode":true}}'`);
            const [agent]=await sql('SELECT * FROM agent_personas');
            (input.operationalScope as any).operationalHash=operationalConfigurationHash(agent);
        }
        await expect(store.commit(input)).rejects.toThrow();expect(await count()).toBe(0);expect(relay.publish).not.toHaveBeenCalled();
    });
    it.each(['missing_scope','foreign_tenant','missing_group','foreign_inbound','foreign_contact','generic_alias'] as const)('rejects %s before writing',async change=>{
        if(change==='missing_scope')(input as any).operationalScope=undefined;
        if(change==='foreign_tenant')(input.operationalScope as any).tenantId=randomUUID();
        if(change==='missing_group')input.learningFootprints=[];
        if(change==='foreign_inbound')input.inboundMessageId=(await freshInput()).inboundMessageId;
        if(change==='foreign_contact')input.contactId=randomUUID();
        if(change==='generic_alias')input.channelAccountId='widget';
        await expect(store.commit(input)).rejects.toThrow();expect(await count()).toBe(0);
    });
    it('guards and indexes inherited groups from another agent including every heldout source',async()=>{
        const current=await learningGroup(),inherited=await learningGroup(input,randomUUID());
        input.learningFootprints=[current.footprint,inherited.footprint];
        const result=await store.commit(input);
        const refs=await sql('SELECT source_id FROM widget_agent_reply_sources WHERE reply_id=(SELECT id FROM widget_agent_replies WHERE inbound_message_id=$1::uuid)',[input.inboundMessageId]);
        expect(refs.map(row=>row.source_id).sort()).toEqual([...current.sourceIds,...inherited.sourceIds].sort());
        const history=await store.historyFootprints(tenantId,schema,input.conversationId,[result.messages[0].messageId]);
        expect(history.trustedMessageIds).toEqual([result.messages[0].messageId]);expect(history.footprints).toHaveLength(2);
    });
    it('denies a historical source withdrawn before new admission while preserving the accepted original receipt',async()=>{
        const inherited=await learningGroup(input,randomUUID());input.learningFootprints.push(inherited.footprint);
        const original=await store.commit(input);
        await sql("UPDATE learning_sources SET status='withdrawn' WHERE id=$1::uuid",[inherited.sourceIds[1]]);
        const next={...input,inboundMessageId:randomUUID()};
        await sql("INSERT INTO messages(id,conversation_id,direction,content_text) VALUES($1::uuid,$2::uuid,'inbound','Next')",[next.inboundMessageId,input.conversationId]);
        await expect(store.commit(next)).rejects.toThrow();expect(await store.lookup(tenantId,input)).toEqual(original);
    });
    it('uses a target conversation writer lock before validating that same conversation as a learning source',async()=>{
        input.learningFootprints=[(await learningGroup(input,agentId,true)).footprint];
        const result=await store.commit(input);
        expect(result.status).toBe('stored');expect(await count()).toBe(1);
        expect(await store.commit(input)).toEqual(result);
    });
    it('deduplicates simultaneous processes using database admission, without relying on a Redis mutex',async()=>{
        const other=new WidgetAgentReplyStore(prisma,messages);
        const results=await Promise.all([store.commit(input),other.commit(input)]);
        expect(results[0]).toEqual(results[1]);expect(await count()).toBe(1);
    });
    it('rolls back message, source index and receipt together when SQL fails',async()=>{
        input.learningFootprints=[(await learningGroup()).footprint];
        const persist=messages.persistWithQuery.bind(messages);
        jest.spyOn(messages,'persistWithQuery').mockImplementationOnce(async(query,...args)=>{
            await persist(query,...args);await query('SELECT 1/0');throw new Error('unreachable');
        });
        await expect(store.commit(input)).rejects.toThrow();expect(await count()).toBe(0);
        expect(await sql("SELECT id FROM messages WHERE conversation_id=$1::uuid AND direction='outbound'",[input.conversationId])).toEqual([]);
        expect(relay.publish).not.toHaveBeenCalled();expect((await store.commit(input)).status).toBe('stored');
    });
    it('recovers a lost COMMIT acknowledgement by receipt lookup, without another write or current-version guard',async()=>{
        await store.lookup(tenantId,input);
        const transact=prisma.transactionInTenantSchema.bind(prisma);
        jest.spyOn(prisma,'transactionInTenantSchema').mockImplementationOnce(async(target,work,options)=>{
            await transact(target,work,options);throw new Error('synthetic_commit_ack_lost');
        });
        await expect(store.commit(input)).rejects.toThrow('synthetic_commit_ack_lost');
        await sql('UPDATE agent_personas SET version=2');
        expect((await store.lookup(tenantId,input))?.status).toBe('stored');expect(await count()).toBe(1);
    });
    it('keeps redacted inbound identity terminal without reviving content or requiring the old source',async()=>{
        const group=await learningGroup();input.learningFootprints=[group.footprint];
        const result=await store.commit(input);
        await prisma.transactionInTenantSchema(schema,query=>redactWidgetAgentReplies(query,schema,{sourceIds:[group.sourceIds[1]]}));
        expect(await store.lookup(tenantId,input)).toEqual({status:'redacted',messages:[]});
        expect(await store.commit(input)).toEqual({status:'redacted',messages:[]});
        expect((await sql('SELECT content_text,status FROM messages WHERE id=$1::uuid',[result.messages[0].messageId]))[0]).toEqual({content_text:null,status:'redacted'});
        expect(await count()).toBe(1);
    });
    it('accepts a genuine legacy persona with an explicit empty source list',async()=>{
        await sql('DELETE FROM agent_personas');const body={persona:{name:'Legacy'}};
        await sql("INSERT INTO persona_config VALUES($1::jsonb,true,1)",[JSON.stringify(body)]);
        input.operationalScope={tenantId,schemaName:schema,kind:'legacy',legacyConfigHash:revisionHash(body)};input.learningFootprints=[];
        expect((await store.commit(input)).status).toBe('stored');
    });

    describe('a failure around the commit boundary',()=>{
        it('rolls the message, receipt and source index back together',async()=>{
            const group=await learningGroup();input.learningFootprints=[group.footprint];
            const sourceRows=async()=>(await sql('SELECT reply_id FROM widget_agent_reply_sources')).length;
            const before=await sourceRows();
            const persist=messages.persistWithQuery.bind(messages);
            let inserted='';
            jest.spyOn(messages,'persistWithQuery').mockImplementation(async(...args:any[])=>{
                const message=await (persist as any)(...args);inserted=message.id;
                throw new Error('injected failure after the message insert');
            });
            await expect(store.commit(input)).rejects.toThrow('injected failure after the message insert');
            expect(inserted).not.toBe('');
            expect(await sql('SELECT id FROM messages WHERE id=$1::uuid',[inserted])).toHaveLength(0);
            expect(await count()).toBe(0);
            expect(await sourceRows()).toBe(before);
        });

        it('recovers a commit the caller saw fail, without storing the reply twice',async()=>{
            // Publication happens after COMMIT. Losing it looks to the caller
            // exactly like a lost COMMIT acknowledgement, and the retry must find
            // the accepted receipt rather than admit a second message.
            jest.spyOn(messages,'publish').mockImplementationOnce(()=>{throw new Error('relay unavailable');});
            await expect(store.commit(input)).rejects.toThrow('relay unavailable');
            expect(await count()).toBe(1);
            const recovered=await store.commit(input);
            expect(recovered.status).toBe('stored');
            expect(await count()).toBe(1);
            expect(await sql('SELECT id FROM messages WHERE conversation_id=$1::uuid AND direction=$2',
                [input.conversationId,'outbound'])).toHaveLength(1);
        });
    });

    describe('changes that commit while the admission is already waiting',()=>{
        it('refuses a version published during the admission',async()=>{
            const blocker=racing([['UPDATE agent_personas SET version=2 WHERE id=$1::uuid',[agentId]]]);
            try{
                await blocker.ready;
                const admission=store.commit(input);
                await settle();blocker.release();await blocker.done;
                await expect(admission).rejects.toThrow('agent_operational_revision_changed');
                expect(await count()).toBe(0);
            }finally{blocker.release();await blocker.done;}
        });

        it('refuses a connection whose serving agent changed during the admission',async()=>{
            const blocker=racing([[`INSERT INTO agent_personas VALUES($1::uuid,'Other','{"persona":{"name":"Other"}}','{}',
                ARRAY[$2],'24_7',true,false,1)`,[randomUUID(),`web_widget:${widgetId}`]]]);
            try{
                await blocker.ready;
                const admission=store.commit(input);
                await settle();blocker.release();await blocker.done;
                await expect(admission).rejects.toThrow('agent_operational_revision_changed');
                expect(await count()).toBe(0);
            }finally{blocker.release();await blocker.done;}
        });

        it('refuses a holdout source retired during the admission, behind the privacy fence',async()=>{
            const group=await learningGroup();input.learningFootprints=[group.footprint];
            const blocker=racing([
                ['SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text',[`agent-privacy:${schema}`]],
                ["UPDATE learning_sources SET status='retired' WHERE id=$1::uuid",[group.sourceIds[1]]],
            ]);
            try{
                await blocker.ready;
                // The admission takes the SHARED privacy lock first, so it cannot
                // cross an erasure already queued ahead of it on the same fence.
                const admission=store.commit(input);
                await settle();blocker.release();await blocker.done;
                await expect(admission).rejects.toThrow();
                expect(await count()).toBe(0);
            }finally{blocker.release();await blocker.done;}
        });

        it('still admits when the racing transaction changed nothing this reply depends on',async()=>{
            const other=await freshInput();
            const blocker=racing([['UPDATE conversations SET summary=$2 WHERE id=$1::uuid',[other.conversationId,'unrelated']]]);
            try{
                await blocker.ready;
                const admission=store.commit(input);
                await settle();blocker.release();await blocker.done;
                expect((await admission).status).toBe('stored');
                expect(await count()).toBe(1);
            }finally{blocker.release();await blocker.done;}
        });

        it('gives up bounded rather than queueing behind an edit of its own conversation',async()=>{
            // NOWAIT is deliberate: waiting here inverts with the message edit
            // path (message row -> revision trigger -> conversation). The turn
            // must fail whole and admit nothing, never half-store and never hang.
            const blocker=racing([['UPDATE conversations SET summary=$2 WHERE id=$1::uuid',[input.conversationId,'edited']]]);
            try{
                await blocker.ready;
                await expect(store.commit(input)).rejects.toMatchObject({meta:{code:'55P03'}});
                expect(await count()).toBe(0);
            }finally{blocker.release();await blocker.done;}
            // The refusal poisons nothing: the same reply is admitted afterwards.
            expect((await store.commit(input)).status).toBe('stored');
            expect(await count()).toBe(1);
        });
    });

    describe('what the next turn may read back',()=>{
        const history=(target=input,ids:string[]=[])=>store.historyFootprints(tenantId,schema,target.conversationId,ids);

        it('inherits the provenance of an earlier reply and trusts only that message',async()=>{
            const group=await learningGroup();input.learningFootprints=[group.footprint];
            const stored=await store.commit(input);
            const messageId=stored.messages[0].messageId;
            await expect(history(input,[messageId])).resolves.toEqual({
                footprints:[group.footprint],trustedMessageIds:[messageId]});
        });

        it('treats an outbound message with no receipt as untracked, never as proof of no learning',async()=>{
            const [row]=await sql(`INSERT INTO messages(conversation_id,direction,content_type,content_text)
                VALUES($1::uuid,'outbound','text','Legacy answer with no receipt') RETURNING id`,[input.conversationId]);
            await expect(history(input,[row.id])).resolves.toEqual({footprints:[],trustedMessageIds:[]});
        });

        it('blocks the earlier text when erasure lands between reading it and reading its provenance',async()=>{
            const group=await learningGroup();input.learningFootprints=[group.footprint];
            const stored=await store.commit(input);
            const messageId=stored.messages[0].messageId;
            // The turn already selected this text. Erasure commits before the
            // provenance read, so the read must stop the turn rather than report
            // an absent receipt, which would silently launder the same words.
            await prisma.transactionInTenantSchema(schema,query=>redactWidgetAgentReplies(query,schema,{contactIds:[input.contactId]}));
            await expect(history(input,[messageId])).rejects.toThrow();
        });

        it('refuses a message that belongs to another conversation',async()=>{
            const other=await freshInput();other.learningFootprints=input.learningFootprints;
            const stored=await store.commit(other);
            await expect(history(input,[stored.messages[0].messageId])).rejects.toThrow();
        });
    });

    describe('a turn that transferred the conversation itself',()=>{
        /** The atomic transition: the receipt observes the pre-transfer status and
         * commits with the status change, exactly as HandoffService performs it. */
        const transfer=(target=input,noticeKind:HandoffNoticeKind='queue_head',noticeLanguage:HandoffNoticeLanguage='es')=>
            prisma.transactionInTenantSchema(schema,async query=>{
                const receipt=await recordHandoffReceipt(query,schema,{conversationId:target.conversationId,
                    contactId:target.contactId,inboundMessageId:target.inboundMessageId,toStatus:'waiting_human',
                    reason:'explicit_request',noticeKind,noticeLanguage});
                await query("UPDATE conversations SET status='waiting_human' WHERE id=$1::uuid",[target.conversationId]);
                return receipt;
            });
        const notice=(target=input)=>({tenantId,schemaName:schema,conversationId:target.conversationId,
            contactId:target.contactId,inboundMessageId:target.inboundMessageId,channelAccountId:target.channelAccountId,
            operationalScope:target.operationalScope,learningFootprints:target.learningFootprints});
        const storedText=async(messageId:string)=>(await sql('SELECT content_text FROM messages WHERE id=$1::uuid',[messageId]))[0].content_text;

        it('still refuses a plain model reply once a person owns the conversation',async()=>{
            await transfer();
            await expect(store.commit(input)).rejects.toThrow('widget_agent_reply_conversation_unavailable');
            expect(await count()).toBe(0);
        });

        it('delivers the receipt notice once and recovers it without transferring again',async()=>{
            const receipt=await transfer(input,'queue_head','pt');
            const first=await store.commitHandoffNotice(notice());
            expect(first?.status).toBe('stored');
            expect(await storedText(first!.messages[0].messageId)).toBe(handoffNoticeText('queue_head','pt'));
            // The words come from the receipt, so a replay is the same accepted
            // message and never a second transfer or a second admission.
            expect(await store.commitHandoffNotice(notice())).toEqual(first);
            expect(await store.lookup(tenantId,input)).toEqual(first);
            expect(await count()).toBe(1);
            expect(Number((await sql('SELECT COUNT(*) AS count FROM agent_handoff_receipts WHERE id=$1::uuid',[receipt.id]))[0].count)).toBe(1);
        });

        it('keeps the answer the turn produced before the transfer, then the notice',async()=>{
            await transfer(input,'transferring','es');
            const stored=await store.commitHandoffNotice({...notice(),precedingText:'Registré tu siniestro con el número 4821.'});
            expect(await storedText(stored!.messages[0].messageId))
                .toBe(`Registré tu siniestro con el número 4821.\n\n${handoffNoticeText('transferring','es')}`);
        });

        it('applies the same authority and provenance rules to the words of the model',async()=>{
            await transfer(input,'transferring','es');
            await sql('UPDATE agent_personas SET version=2');
            await expect(store.commitHandoffNotice({...notice(),precedingText:'An answer'}))
                .rejects.toThrow('agent_operational_revision_changed');
            // Without model words the deterministic notice is still owed and needs
            // no agent revision: the transfer already happened.
            expect((await store.commitHandoffNotice(notice()))?.status).toBe('stored');
        });

        it('records the sources of the preserved answer so erasure reaches it',async()=>{
            const group=await learningGroup();
            await transfer(input,'transferring','es');
            const stored=await store.commitHandoffNotice({...notice(),
                learningFootprints:[group.footprint],precedingText:'An answer derived from a reviewed example'});
            await prisma.transactionInTenantSchema(schema,query=>redactWidgetAgentReplies(query,schema,{sourceIds:[group.sourceIds[1]]}));
            expect(await store.lookup(tenantId,input)).toEqual({status:'redacted',messages:[]});
            expect(await storedText(stored!.messages[0].messageId)).toBeNull();
        });

        it('refuses without a receipt, and with a receipt for another turn',async()=>{
            await sql("UPDATE conversations SET status='waiting_human' WHERE id=$1::uuid",[input.conversationId]);
            await expect(store.commitHandoffNotice(notice())).rejects.toThrow('widget_agent_reply_handoff_receipt_required');
            const other=await freshInput();
            await transfer(other);
            await expect(store.commitHandoffNotice(notice())).rejects.toThrow('widget_agent_reply_handoff_receipt_required');
            await expect(store.commitHandoffNotice({...notice(other),inboundMessageId:input.inboundMessageId}))
                .rejects.toThrow('widget_agent_reply_handoff_receipt_required');
            expect(await count()).toBe(0);
        });

        it('refuses a notice for a conversation somebody handed back inside the turn',async()=>{
            await transfer();
            await sql("UPDATE conversations SET status='active' WHERE id=$1::uuid",[input.conversationId]);
            await expect(store.commitHandoffNotice(notice())).rejects.toThrow('widget_agent_reply_handoff_no_longer_active');
            expect(await count()).toBe(0);
        });

        it('stays silent when the receipt asks for no sentence and the turn produced none',async()=>{
            await transfer(input,'none','es');
            expect(await store.commitHandoffNotice(notice())).toBeNull();
            expect(await count()).toBe(0);
            expect(relay.publish).not.toHaveBeenCalled();
        });
    });
});
