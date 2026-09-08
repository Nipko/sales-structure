import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SimulationService } from './simulation.service';
import { assertSimulationReplayRun, registerSimulationReplayNamespace, withSimulationReplayRun } from './simulation-replay-authority';
import { eraseSimulationContactReplays } from './simulation-replay-retention';
import { LearningService } from '../learning/learning.service';
import { learningSnapshotHash, type RuntimeLearningExample } from '../learning/learning-contracts';
import { learningInboxEvidence, readLearningInboxSource } from '../learning/learning-inbox-source';
import { LLMSourceAuthorityUnavailable } from '../ai/interfaces/llm-source-authority';

const connection=process.env.PARALLLY_ISOLATION_TEST_URL;
(connection?describe:describe.skip)('historical Simulation source authority on real PostgreSQL and Prisma',()=>{
    const schema=`tenant_replay_${randomUUID().replace(/-/g,'')}`,tenantId=randomUUID(),agentId=randomUUID();
    let db:PrismaClient,prisma:PrismaService,service:SimulationService,agentTest:any,queue:any,quality:any;
    let contactId:string,conversationId:string,messageId:string;
    const tx=<T>(work:(query:any)=>Promise<T>)=>prisma.transactionInTenantSchema(schema,work);
    const sql=(statement:string,params:any[]=[])=>prisma.executeInTenantSchema<any[]>(schema,statement,params);
    const judge={overall:8,resolved:true,tone:8,accuracy:8,empathy:8,resolution:8,flags:[]};
    const fence=async(query:any,shared=false)=>query(`SELECT pg_advisory_xact_lock${shared?'_shared':''}(hashtextextended($1,0))::text`,[`agent-privacy:${schema}`]);
    const start=(extra:any={})=>service.startRun(tenantId,{agentId,channelType:'web_widget',scenarioSource:'replay',count:1,createdBy:'reviewer@example.test',...extra});
    beforeAll(async()=>{
        const url=new URL(connection!);
        if(!['127.0.0.1','localhost'].includes(url.hostname)||!url.pathname.startsWith('/parallly_eval_isolation'))throw new Error('disposable_database_required');
        db=new PrismaClient({datasources:{db:{url:connection}}});await db.$connect();
        prisma=Object.create(PrismaService.prototype);
        (prisma as any).$transaction=db.$transaction.bind(db);
        (prisma as any).getTenantSchemaName=async()=>schema;
        await db.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
        await sql('CREATE TABLE contacts(id uuid PRIMARY KEY,name text,phone text,email text)');
        await sql('CREATE TABLE contact_identities(contact_id uuid,customer_profile_id uuid)');
        await sql(`CREATE TABLE conversations(id uuid PRIMARY KEY,contact_id uuid REFERENCES contacts(id),agent_id uuid,
            channel_type text,qa_revision bigint NOT NULL DEFAULT 1,created_at timestamptz DEFAULT NOW())`);
        await sql(`CREATE TABLE messages(id uuid PRIMARY KEY,conversation_id uuid REFERENCES conversations(id),
            direction text,content_text text,created_at timestamptz DEFAULT NOW())`);
        await sql('CREATE TABLE customer_memory_erasure(contact_id uuid PRIMARY KEY,erased_at timestamptz DEFAULT NOW())');
        await sql(`CREATE TABLE learning_sources(id uuid PRIMARY KEY,agent_id uuid,source_kind text,status text,
            source_contact_id uuid,source_conversation_id uuid,channel text,transcript jsonb,source_evidence jsonb)`);
        await sql('CREATE TABLE learning_examples(id uuid PRIMARY KEY,source_id uuid,status text)');
        await sql(`CREATE TABLE learning_releases(id uuid PRIMARY KEY,agent_id uuid,status text,snapshot jsonb,
            snapshot_hash text,example_ids uuid[])`);
        await sql(`CREATE FUNCTION revise_replay_source() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
            UPDATE conversations SET qa_revision=qa_revision+1 WHERE id=COALESCE(NEW.conversation_id,OLD.conversation_id);
            RETURN NULL; END $$`);
        await sql('CREATE TRIGGER revise_replay AFTER INSERT OR UPDATE OR DELETE ON messages FOR EACH ROW EXECUTE FUNCTION revise_replay_source()');
        const redis={get:async()=>null,set:async()=>undefined};
        agentTest={captureSnapshot:jest.fn(async()=>({version:1,config:{language:'fr'},configHash:'config',manifest:{revision:'full',strategy:'guarded_live_dependencies',limitations:[]}})),
            assertSnapshotCurrent:jest.fn(),test:jest.fn(async(_t:any,_a:any,_input:any,opts:any)=>{
                await opts.beforeModelExecution?.();return {reply:'Bonjour',debug:{toolCalls:[]}};
            })};
        quality={judgeTranscript:jest.fn(async()=>judge)};queue={add:jest.fn(async()=>({}))};
        service=new SimulationService(prisma,redis as any,{} as any,{getAgent:async()=>({id:agentId})} as any,
            quality,agentTest,queue,{emit:jest.fn()} as any);
        await service.ensureTables(schema);
        // Bootstrap once; all source-use guards themselves must be read-only.
        jest.spyOn(service,'ensureTables').mockResolvedValue();
    },30000);
    beforeEach(async()=>{
        await sql('TRUNCATE simulation_runs,messages,conversations,contacts,contact_identities,customer_memory_erasure,learning_sources,learning_examples,learning_releases CASCADE');
        contactId=randomUUID();conversationId=randomUUID();messageId=randomUUID();
        await sql('INSERT INTO contacts(id) VALUES($1::uuid)',[contactId]);
        await sql(`INSERT INTO conversations(id,contact_id,agent_id,channel_type) VALUES($1::uuid,$2::uuid,$3::uuid,'web_widget')`,[conversationId,contactId,agentId]);
        await sql(`INSERT INTO messages(id,conversation_id,direction,content_text) VALUES($1::uuid,$2::uuid,'inbound','Mon texte privé')`,[messageId,conversationId]);
        agentTest.test.mockClear();quality.judgeTranscript.mockClear();queue.add.mockClear();
    });
    afterAll(async()=>{
        if(!db)return;
        if(!/^tenant_replay_[a-f\d]{32}$/.test(schema))throw new Error('invalid_cleanup_scope');
        await db.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);await db.$disconnect();
    });
    /** A real active source and published style release; no Learning method is mocked. */
    const learningAuthority=async(kind:'file'|'inbox'='file')=>{
        const sourceId=randomUUID(),exampleId=randomUUID(),releaseId=randomUUID();
        let sourceContact:string|null=null,sourceConversation:string|null=null,evidence:any=null,transcript:any[]=[];
        let editableMessageId:string|undefined;
        if(kind==='inbox'){
            sourceContact=randomUUID();sourceConversation=randomUUID();editableMessageId=randomUUID();
            await sql('INSERT INTO contacts(id) VALUES($1::uuid)',[sourceContact]);
            await sql("INSERT INTO conversations(id,contact_id,agent_id,channel_type) VALUES($1::uuid,$2::uuid,$3::uuid,'web_widget')",[sourceConversation,sourceContact,agentId]);
            await sql("INSERT INTO messages(id,conversation_id,direction,content_text) VALUES($1::uuid,$2::uuid,'inbound','Synthetic style source')",[editableMessageId,sourceConversation]);
            await sql("INSERT INTO messages(id,conversation_id,direction,content_text) VALUES($1::uuid,$2::uuid,'outbound','Synthetic style response')",[randomUUID(),sourceConversation]);
            const current=await readLearningInboxSource(<T>(statement:string,params:any[]=[])=>prisma.executeInTenantSchema<T>(schema,statement,params),sourceConversation);
            transcript=current.messages;evidence=learningInboxEvidence(agentId,current,transcript);
        }
        await sql(`INSERT INTO learning_sources(id,agent_id,source_kind,status,source_contact_id,source_conversation_id,channel,transcript,source_evidence)
            VALUES($1::uuid,$2::uuid,$3,'active',$4::uuid,$5::uuid,'web_widget',$6::jsonb,$7::jsonb)`,
            [sourceId,agentId,kind,sourceContact,sourceConversation,JSON.stringify(transcript),JSON.stringify(evidence)]);
        await sql("INSERT INTO learning_examples(id,source_id,status) VALUES($1::uuid,$2::uuid,'approved')",[exampleId,sourceId]);
        const frozen={id:exampleId,source_id:sourceId,kind:'brand_style',intent:'general',response_pattern:'A concise, courteous answer',rationale:'Reviewed style',facts_required:[]};
        const snapshot={examples:[frozen],heldout:[]},hash=learningSnapshotHash(snapshot);
        await sql(`INSERT INTO learning_releases(id,agent_id,status,snapshot,snapshot_hash,example_ids)
            VALUES($1::uuid,$2::uuid,'published',$3::jsonb,$4,$5::uuid[])`,[releaseId,agentId,JSON.stringify(snapshot),hash,[exampleId]]);
        const example:RuntimeLearningExample={id:exampleId,releaseId,releaseHash:hash,situation:frozen.intent,
            responsePattern:frozen.response_pattern,rationale:frozen.rationale,factsRequired:[],authority:'style_only'};
        const learning=new LearningService(prisma,{} as any,{} as any);
        return {invoke:learning.runtimeDataSourceAuthority(tenantId,agentId,[example],{mode:'evaluation',persistence:'disabled'}),editableMessageId};
    };
    it('captures actor, exact source IDs, revision, actual channel/language at start; jobs contain only IDs',async()=>{
        const other=randomUUID();await sql(`INSERT INTO conversations(id,contact_id,agent_id,channel_type,created_at)
            VALUES($1::uuid,$2::uuid,$3::uuid,'telegram',NOW()+interval '1 day')`,[other,contactId,agentId]);
        await sql(`INSERT INTO messages VALUES($1::uuid,$2::uuid,'inbound','Autre canal',NOW())`,[randomUUID(),other]);
        const {runId}=await start();const [run]=await sql('SELECT * FROM simulation_runs WHERE id=$1::uuid',[runId]);
        expect(run.replay_authority).toHaveLength(1);
        expect(run.replay_authority[0]).toMatchObject({version:1,scope:'simulation_replay',originRunId:runId,
            conversationId,contactId,agentId,channelType:'web_widget',language:'fr',messageIds:[messageId],authorizedBy:'reviewer@example.test'});
        expect(run.scenario_definitions[0]).toMatchObject({language:'fr',openingMessage:'Mon texte privé'});
        expect(queue.add.mock.calls[0][1]).toEqual({tenantId,runId});
    });
    it('never treats commercial consent or missing actor/erased source as replay authority',async()=>{
        await expect(start({createdBy:''})).rejects.toThrow('simulation_replay_source_unavailable');
        await sql('INSERT INTO customer_memory_erasure(contact_id) VALUES($1::uuid)',[contactId]);
        await expect(start()).rejects.toThrow('simulation_replay_source_unavailable');
        expect(queue.add).not.toHaveBeenCalled();expect(await sql('SELECT id FROM simulation_runs')).toHaveLength(0);
    });
    it('rejects a changed source at the next model/tool gate and clears all baseline copies',async()=>{
        const {runId}=await start();await sql(`UPDATE simulation_runs SET status='completed',results=scenario_definitions WHERE id=$1::uuid`,[runId]);
        const child=await start({baselineRunId:runId});
        const external=jest.fn();
        await expect(withSimulationReplayRun(prisma,schema,child.runId,async(query,run)=>{
            await sql('UPDATE messages SET content_text=$2 WHERE id=$1::uuid',[messageId,'Texte corrigé']);
            // The next use fails before its provider is invoked.
            await assertSimulationReplayRun(query,run); return external();
        })).rejects.toThrow('simulation_replay_source_unavailable');
        expect(external).not.toHaveBeenCalled();
        const runs=await sql('SELECT status,results,replay_authority FROM simulation_runs');
        expect(runs.every(r=>r.status==='retired'&&r.results.length===0&&r.replay_authority===null)).toBe(true);
    },10000);
    it('a concurrent source edit during external use rejects the result before it can be checkpointed',async()=>{
        const {runId}=await start();const work=jest.fn(async()=>{
            await sql('UPDATE messages SET content_text=$2 WHERE id=$1::uuid',[messageId,'changed during model']);return 'derived private reply';
        });
        await expect(withSimulationReplayRun(prisma,schema,runId,work)).rejects.toThrow('simulation_replay_source_unavailable');
        const run=await service.getRun(tenantId,runId);expect(run.status).toBe('retired');expect(JSON.stringify(run)).not.toContain('privé');
    });
    it('holds erasure outside bounded provider use, then erases copies and refuses any late checkpoint',async()=>{
        const {runId}=await start();await sql(`UPDATE simulation_runs SET status='completed',results=scenario_definitions WHERE id=$1::uuid`,[runId]);
        const child=await start({baselineRunId:runId});
        let release!:()=>void,entered!:()=>void;
        const gate=new Promise<void>(r=>release=r),started=new Promise<void>(r=>entered=r);
        const provider=withSimulationReplayRun(prisma,schema,runId,async()=>{entered();await gate;return 'derived';});
        await started;
        const probe=await tx(async q=>q('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS acquired',[`agent-privacy:${schema}`]));
        expect((probe as any)[0].acquired).toBe(false);
        const erase=tx(async q=>{await fence(q);await q('INSERT INTO customer_memory_erasure(contact_id) VALUES($1::uuid)',[contactId]);return eraseSimulationContactReplays(q,[contactId]);});
        release();await provider;expect(await erase).toBe(2);
        const persist=jest.fn();await expect(withSimulationReplayRun(prisma,schema,child.runId,persist,{commit:true})).rejects.toThrow('simulation_replay_source_unavailable');
        expect(persist).not.toHaveBeenCalled();
        await expect(start({baselineRunId:runId})).rejects.toThrow('simulation_replay_source_unavailable');
        const rows=await sql('SELECT * FROM simulation_runs');expect(JSON.stringify(rows)).not.toContain('Mon texte privé');
    });
    it('refuses baseline scope changes and retired permission even when copied text still exists in worker memory',async()=>{
        const {runId}=await start();await sql(`UPDATE simulation_runs SET status='completed',results=scenario_definitions WHERE id=$1::uuid`,[runId]);
        await expect(start({baselineRunId:runId,channelType:'telegram'})).rejects.toThrow('simulation_replay_source_unavailable');
        const copy=await (service as any).loadScenariosFromRun(schema,runId);
        await service.retireRun(tenantId,runId);
        const before=agentTest.test.mock.calls.length;
        await expect((service as any).runScenario(tenantId,agentId,'web_widget',copy[0],{},undefined,{schemaName:schema,runId})).rejects.toThrow('simulation_replay_source_unavailable');
        expect(agentTest.test).toHaveBeenCalledTimes(before);
    });
    it('validates retries before reusing successful results and never exposes stale text in summaries/get',async()=>{
        const {runId}=await start();const [run]=await sql('SELECT * FROM simulation_runs WHERE id=$1::uuid',[runId]);
        const def=run.scenario_definitions[0];const {revisionHash}=require('../evaluation-revision/evaluation-revision');
        const completed={...def,scenarioHash:revisionHash(def),transcript:[],judge,turns:1,latencyMs:1};
        await sql('UPDATE messages SET content_text=$2 WHERE id=$1::uuid',[messageId,'changed']);
        await expect((service as any).runScenariosConcurrently(tenantId,agentId,'web_widget',[def],undefined,undefined,[completed],undefined,{schemaName:schema,runId})).rejects.toThrow('simulation_replay_source_unavailable');
        expect(agentTest.test).not.toHaveBeenCalled();
        expect(JSON.stringify(await service.listRuns(tenantId))).not.toContain('Mon texte privé');
    });
    it('rejects tampered replay definitions and message insertion with identical text through hash/IDs',async()=>{
        const {runId}=await start();const [run]=await sql('SELECT * FROM simulation_runs WHERE id=$1::uuid',[runId]);
        run.scenario_definitions[0].openingMessage='tampered';
        await sql('UPDATE simulation_runs SET scenario_definitions=$2::jsonb WHERE id=$1::uuid',[runId,JSON.stringify(run.scenario_definitions)]);
        await expect(withSimulationReplayRun(prisma,schema,runId,async()=>{})).rejects.toThrow('simulation_replay_source_unavailable');
        const next=await start();
        await sql(`INSERT INTO messages VALUES($1::uuid,$2::uuid,'inbound','Mon texte privé',NOW())`,[randomUUID(),conversationId]);
        await expect(withSimulationReplayRun(prisma,schema,next.runId,async()=>{})).rejects.toThrow('simulation_replay_source_unavailable');
    });
    it('runs actual service turns and judge through source guards, then stops before a second provider after an edit',async()=>{
        const {runId}=await start();const [run]=await sql('SELECT * FROM simulation_runs WHERE id=$1::uuid',[runId]);
        const session={recordInbound:jest.fn(async()=>randomUUID()),assertLease:jest.fn()};
        await (service as any).runScenario(tenantId,agentId,'web_widget',run.scenario_definitions[0],{},session,{schemaName:schema,runId});
        expect(agentTest.test).toHaveBeenCalledTimes(1);expect(quality.judgeTranscript).toHaveBeenCalledTimes(1);
        agentTest.test.mockImplementationOnce(async(_t:any,_a:any,_i:any,opts:any)=>{
            await sql('UPDATE messages SET content_text=$2 WHERE id=$1::uuid',[messageId,'updated before model']);
            await opts.beforeModelExecution();throw new Error('provider_must_not_run');
        });
        await expect((service as any).runScenario(tenantId,agentId,'web_widget',run.scenario_definitions[0],{},session,{schemaName:schema,runId})).rejects.toThrow('simulation_replay_source_unavailable');
        expect(quality.judgeTranscript).toHaveBeenCalledTimes(1);
    });
    it('executes and checkpoints a complete replay batch through the service without granting learning publication',async()=>{
        const {runId}=await start();
        (service as any).evals={withSandboxSession:async(_tenant:any,work:any)=>work({reset:async()=>{},
            recordInbound:async()=>randomUUID(),assertLease:async()=>{}})};
        await service.executeRun(tenantId,runId);
        const run=await service.getRun(tenantId,runId);
        expect(run).toMatchObject({status:'completed',avgScore:8});expect(run.results).toHaveLength(1);
        expect(run.results[0].transcript).toHaveLength(2);
        expect((await sql('SELECT replay_authority FROM simulation_runs WHERE id=$1::uuid',[runId]))[0].replay_authority[0].scope).toBe('simulation_replay');
    });
    it('a source edit during the judge retires the actual worker run and its catch never resurrects partial text',async()=>{
        const {runId}=await start();
        quality.judgeTranscript.mockImplementationOnce(async()=>{await sql('DELETE FROM messages WHERE id=$1::uuid',[messageId]);return judge;});
        await expect(service.executeRun(tenantId,runId)).rejects.toThrow('simulation_replay_source_unavailable');
        await service.executeRun(tenantId,runId); // BullMQ retry is terminal after retirement.
        const [run]=await sql('SELECT * FROM simulation_runs WHERE id=$1::uuid',[runId]);
        expect(run.status).toBe('retired');expect(run.results).toEqual([]);
        expect(JSON.stringify(run)).not.toContain('Mon texte privé');
    });
    it('retires historical unproven lineage and synthetic baseline descendants before returning any old text',async()=>{
        const origin=randomUUID(),child=randomUUID();
        await sql(`INSERT INTO simulation_runs(id,scenario_source,results) VALUES($1::uuid,'replay',$2::jsonb)`,
            [origin,JSON.stringify([{key:`replay:${conversationId}`,source:'replay',openingMessage:'Legacy secret'}])]);
        await sql(`INSERT INTO simulation_runs(id,scenario_source,baseline_run_id,summary) VALUES($1::uuid,'synthetic',$2::uuid,'{"title":"Legacy secret"}')`,[child,origin]);
        await SimulationService.prototype.ensureTables.call(service,schema);
        const rows=await sql('SELECT status,results,summary FROM simulation_runs');
        expect(rows).toHaveLength(2);expect(rows.every(row=>row.status==='retired')).toBe(true);
        expect(JSON.stringify(rows)).not.toContain('Legacy secret');
        await expect((service as any).loadScenariosFromRun(schema,origin)).rejects.toThrow('simulation_replay_source_unavailable');
    });
    it('erases legacy copies even before the new authority columns have been migrated',async()=>{
        await sql('ALTER TABLE simulation_runs DROP COLUMN replay_authority');
        await sql('ALTER TABLE simulation_runs DROP COLUMN retired_at');
        const origin=randomUUID(),child=randomUUID();
        await sql(`INSERT INTO simulation_runs(id,scenario_source,results) VALUES($1::uuid,'replay','[{"source":"replay","openingMessage":"Legacy secret"}]')`,[origin]);
        await sql(`INSERT INTO simulation_runs(id,scenario_source,baseline_run_id,summary) VALUES($1::uuid,'synthetic',$2::uuid,'{"title":"Legacy secret"}')`,[child,origin]);
        expect(await tx(async query=>{await fence(query);return eraseSimulationContactReplays(query,[contactId]);})).toBe(2);
        expect(await sql('SELECT id FROM simulation_runs')).toHaveLength(0);
        await SimulationService.prototype.ensureTables.call(service,schema);
        // This test changes column order to emulate an older deployment; reconnect its prepared-statement cache.
        await db.$disconnect();await db.$connect();
    });
    it('commits namespace lineage before copying text and erases it after a simulated worker crash',async()=>{
        const {runId}=await start();const key=randomUUID().replace(/-/g,'');
        const namespace=`tenant_eval_${key.slice(0,8)}_${key.slice(8)}`;
        const lease={schemaName:namespace,sourceSchema:schema,tenantId,token:randomUUID(),expiresAt:new Date(Date.now()+60000).toISOString(),tables:['messages']};
        await db.$executeRawUnsafe(`CREATE SCHEMA "${namespace}"`);
        try {
            await db.$executeRawUnsafe(`CREATE TABLE "${namespace}".__eval_namespace(tenant_id uuid,owner_token uuid,source_schema text,expires_at timestamptz)`);
            await db.$executeRawUnsafe(`INSERT INTO "${namespace}".__eval_namespace VALUES($1::uuid,$2::uuid,$3,NOW()+interval '1 minute')`,tenantId,lease.token,schema);
            await db.$executeRawUnsafe(`CREATE TABLE "${namespace}".messages(id uuid,content_text text)`);
            await registerSimulationReplayNamespace(prisma,schema,runId,lease);
            await withSimulationReplayRun(prisma,schema,runId,async()=>{
                // Different connection sees the durable lease before the copied inbound exists.
                expect((await sql('SELECT replay_namespace_leases FROM simulation_runs WHERE id=$1::uuid',[runId]))[0].replay_namespace_leases).toHaveLength(1);
                await db.$executeRawUnsafe(`INSERT INTO "${namespace}".messages VALUES($1::uuid,'Crash-resident private text')`,randomUUID());
            });
            expect(await tx(async query=>{await fence(query);return eraseSimulationContactReplays(query,[contactId]);})).toBe(1);
            expect(await db.$queryRawUnsafe('SELECT 1 FROM pg_namespace WHERE nspname=$1',namespace)).toEqual([]);
        } finally {
            if(!/^tenant_eval_[a-f\d]{8}_[a-f\d]{24}$/.test(namespace))throw new Error('invalid_cleanup_scope');
            await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${namespace}" CASCADE`);
        }
    });
    it('rejects a lease from another source before persisting any namespace authority',async()=>{
        const {runId}=await start();const key=randomUUID().replace(/-/g,'');
        await expect(registerSimulationReplayNamespace(prisma,schema,runId,{schemaName:`tenant_eval_${key.slice(0,8)}_${key.slice(8)}`,
            sourceSchema:'tenant_other',tenantId,token:randomUUID(),expiresAt:new Date().toISOString(),tables:[]})).rejects.toThrow('simulation_replay_source_unavailable');
        expect((await sql('SELECT replay_namespace_leases FROM simulation_runs WHERE id=$1::uuid',[runId]))[0].replay_namespace_leases).toBeNull();
    });
    it('lets queued erasure finish between registration and source use without a nested shared-lock deadlock',async()=>{
        const {runId}=await start();const [run]=await sql('SELECT * FROM simulation_runs WHERE id=$1::uuid',[runId]);
        const key=randomUUID().replace(/-/g,''),namespace=`tenant_eval_${key.slice(0,8)}_${key.slice(8)}`;
        const lease={schemaName:namespace,sourceSchema:schema,tenantId,token:randomUUID(),expiresAt:new Date(Date.now()+60000).toISOString(),tables:['messages']};
        await db.$executeRawUnsafe(`CREATE SCHEMA "${namespace}"`);
        const native=prisma.transactionInTenantSchema.bind(prisma);
        let intercept=true,erasure:Promise<unknown>|undefined;
        try {
            await db.$executeRawUnsafe(`CREATE TABLE "${namespace}".__eval_namespace(tenant_id uuid,owner_token uuid,source_schema text,expires_at timestamptz)`);
            await db.$executeRawUnsafe(`INSERT INTO "${namespace}".__eval_namespace VALUES($1::uuid,$2::uuid,$3,NOW()+interval '1 minute')`,tenantId,lease.token,schema);
            await db.$executeRawUnsafe(`CREATE TABLE "${namespace}".messages(id uuid,content_text text)`);
            prisma.transactionInTenantSchema=((name:string,work:any,options:any)=>native(name,async(query:any)=>work(async(statement:string,params:any[])=>{
                const rows=await query(statement,params);
                if(intercept && statement==='SELECT * FROM simulation_runs WHERE id=$1::uuid') {
                    intercept=false;
                    let started!:(pid:number)=>void;const ready=new Promise<number>(r=>started=r);
                    erasure=native(schema,async q=>{
                        const [{pid}]=await q<any[]>('SELECT pg_backend_pid() AS pid');started(pid);
                        await fence(q);return eraseSimulationContactReplays(q,[contactId]);
                    });
                    const pid=await ready;let blocked=false;
                    for(let n=0;n<100;n++){
                        const [{waiting}]=await db.$queryRawUnsafe<any[]>('SELECT cardinality(pg_blocking_pids($1::int))>0 AS waiting',pid);
                        if(waiting){blocked=true;break;}
                        await new Promise(r=>setTimeout(r,10));
                    }
                    expect(blocked).toBe(true);
                }
                return rows;
            }),options)) as any;
            const session={sandboxNamespace:lease,recordInbound:jest.fn(async()=>randomUUID()),assertLease:jest.fn()};
            await expect((service as any).runScenario(tenantId,agentId,'web_widget',run.scenario_definitions[0],{},session,{schemaName:schema,runId}))
                .rejects.toThrow('simulation_replay_source_unavailable');
            expect(await erasure).toBe(1);expect(session.recordInbound).not.toHaveBeenCalled();
            expect(agentTest.test).not.toHaveBeenCalled();expect(quality.judgeTranscript).not.toHaveBeenCalled();
            expect(await db.$queryRawUnsafe('SELECT 1 FROM pg_namespace WHERE nspname=$1',namespace)).toEqual([]);
        } finally {
            prisma.transactionInTenantSchema=native;
            if(erasure)await erasure.catch(()=>undefined);
            if(!/^tenant_eval_[a-f\d]{8}_[a-f\d]{24}$/.test(namespace))throw new Error('invalid_cleanup_scope');
            await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${namespace}" CASCADE`);
        }
    },15000);
    it('reuses the Replay transaction for real Learning checks while erasure is queued',async()=>{
        const {runId}=await start(),learning=await learningAuthority();
        const native=prisma.transactionInTenantSchema.bind(prisma);
        let sourceTransactions=0,outerPid=0,erasureFinished=false,erasure:Promise<number>|undefined;
        const learningPids:number[]=[];
        prisma.transactionInTenantSchema=((name:string,work:any,options:any)=>{
            sourceTransactions++;
            return native(name,async(query:any)=>{
                // The old nested-transaction implementation fails in a bounded
                // interval, instead of leaving this regression hung for 120s.
                await query("SET LOCAL lock_timeout='300ms'");
                return work(async(statement:string,params:any[])=>{
                    if(statement.startsWith('SELECT * FROM learning_releases')){
                        learningPids.push((await query('SELECT pg_backend_pid() AS pid'))[0].pid);
                    }
                    return query(statement,params);
                });
            },options);
        }) as any;
        const provider=jest.fn(async()=>{
            expect(erasureFinished).toBe(false);
            return {reply:'Synthetic provider response'};
        });
        try{
            const reply=await withSimulationReplayRun(prisma,schema,runId,async query=>{
                outerPid=(await query<any[]>('SELECT pg_backend_pid() AS pid'))[0].pid;
                let queued!:(pid:number)=>void;
                const started=new Promise<number>(resolve=>{queued=resolve;});
                // Independent Compliance-equivalent transaction; intentionally
                // bypass the observed source-use transaction wrapper.
                erasure=native(schema,async q=>{
                    const [{pid}]=await q<any[]>('SELECT pg_backend_pid() AS pid');queued(pid);
                    await fence(q);
                    await q('INSERT INTO customer_memory_erasure(contact_id) VALUES($1::uuid)',[contactId]);
                    return eraseSimulationContactReplays(q,[contactId]);
                }).then(count=>{erasureFinished=true;return count;});
                const erasurePid=await started;
                let blockers:number[]=[];
                for(let n=0;n<100;n++){
                    const [row]=await db.$queryRawUnsafe<any[]>('SELECT pg_blocking_pids($1::int) AS blockers',erasurePid);
                    blockers=row.blockers;
                    if(blockers.includes(outerPid))break;
                    await new Promise(resolve=>setTimeout(resolve,10));
                }
                expect(blockers).toContain(outerPid);
                const result=await learning.invoke(provider);
                expect(erasureFinished).toBe(false);
                expect(sourceTransactions).toBe(1);
                expect(learningPids).toEqual([outerPid,outerPid]);
                return result;
            });
            expect(reply).toEqual({reply:'Synthetic provider response'});
            expect(provider).toHaveBeenCalledTimes(1);
            expect(await erasure).toBe(1);expect(erasureFinished).toBe(true);
            // Read directly after restoring the wrapper, so diagnostics count
            // only the Replay/Learning source-use transaction above.
        }finally{
            prisma.transactionInTenantSchema=native;
            if(erasure)await erasure.catch(()=>undefined);
        }
        expect((await sql('SELECT status FROM simulation_runs WHERE id=$1::uuid',[runId]))[0].status).toBe('retired');
    },15000);
    it('still revalidates the independent Learning source after provider use inside Replay',async()=>{
        const {runId}=await start(),learning=await learningAuthority('inbox');
        const provider=jest.fn(async()=>{
            // A new/edited inbox message can change the learned source while a
            // provider is in flight. The original Replay source is unchanged.
            await sql('UPDATE messages SET content_text=$2 WHERE id=$1::uuid',[learning.editableMessageId,'Changed synthetic style source']);
            return {reply:'Derived response that must not escape',usage:{promptTokens:5,completionTokens:2,totalTokens:7}};
        });
        await expect(withSimulationReplayRun(prisma,schema,runId,()=>learning.invoke(provider,response=>response.usage)))
            .rejects.toBeInstanceOf(LLMSourceAuthorityUnavailable);
        expect(provider).toHaveBeenCalledTimes(1);
        const current=await withSimulationReplayRun(prisma,schema,runId,async(_query,run)=>run);
        expect(current.status).toBe('pending');expect(current.results).toEqual([]);
        expect(JSON.stringify(current)).not.toContain('Derived response that must not escape');
    });
    it('defers retirement of an invalid nested Replay until the outer source transaction ends',async()=>{
        const {runId}=await start();
        await sql("UPDATE simulation_runs SET status='completed',results=scenario_definitions WHERE id=$1::uuid",[runId]);
        const child=await start({baselineRunId:runId});
        await sql(`UPDATE simulation_runs SET scenario_definitions=jsonb_set(scenario_definitions,'{0,openingMessage}','"Changed definition"')
            WHERE id=$1::uuid`,[child.runId]);
        const native=prisma.transactionInTenantSchema.bind(prisma);
        let insideOuter=false;
        const exclusiveInsideOuter:boolean[]=[];
        prisma.transactionInTenantSchema=((name:string,work:any,options:any)=>native(name,async(query:any)=>{
            await query("SET LOCAL lock_timeout='300ms'");
            return work(async(statement:string,params:any[])=>{
                if(statement.includes('pg_advisory_xact_lock(')&&params?.[0]===`agent-privacy:${schema}`){
                    exclusiveInsideOuter.push(insideOuter);
                }
                return query(statement,params);
            });
        },options)) as any;
        const nestedWork=jest.fn();
        try{
            await expect(withSimulationReplayRun(prisma,schema,runId,async()=>{
                insideOuter=true;
                try{return await withSimulationReplayRun(prisma,schema,child.runId,nestedWork);}
                finally{insideOuter=false;}
            })).rejects.toThrow('simulation_replay_source_unavailable');
            expect(nestedWork).not.toHaveBeenCalled();
            expect(exclusiveInsideOuter).toEqual([false]);
        }finally{prisma.transactionInTenantSchema=native;}
        const rows=await sql('SELECT status,results,replay_authority FROM simulation_runs WHERE id=ANY($1::uuid[])',[[runId,child.runId]]);
        expect(rows).toHaveLength(2);
        expect(rows.every(row=>row.status==='retired'&&row.results.length===0&&row.replay_authority===null)).toBe(true);
    },10000);
});
