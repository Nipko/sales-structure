import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { QualityService } from '../quality.service';
import { QualityRegressionService } from './quality-regression.service';
import { ComplianceService } from '../../compliance/compliance.service';
import { assertReviewedRegressionScenarios, fetchReviewedRegressionScenarios, withReviewedRegressionScenarios } from './quality-regression-runtime';
import { EvalService } from '../../simulation/eval.service';
import { EvalAutorunStateService } from '../../simulation/eval-autorun-state.service';
import { ensureMissionEvidence, MissionTurnRecorder } from '../mission-evidence';
import { missionMetrics } from '../mission-metrics';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { isDisposableDatabaseUrl } from '../../../common/__fixtures__/disposable-database';

const connection=process.env.PARALLLY_ISOLATION_TEST_URL;
const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return{promise,resolve};};
(connection?describe:describe.skip)('reviewed regressions on real PostgreSQL and Prisma',()=>{
    const schema=`tenant_regression_${randomUUID().replace(/-/g,'')}`,tenantId=randomUUID(),agentId=randomUUID(),actorId=randomUUID();
    const contactId=randomUUID(),conversationId=randomUUID(),inboundId=randomUUID();
    let pool:any,client:PrismaClient,prisma:PrismaService,quality:QualityService,service:QualityRegressionService,compliance:ComplianceService,evalService:EvalService;
    const execute=(sql:string,params:any[]=[])=>prisma.executeInTenantSchema<any[]>(schema,sql,params);
    const scope={profileId:'salud/dental',mission:'ask_question',language:'es',channel:'web_widget',difficulty:'standard',provenance:'human_review',contractVersion:2} as const;
    const review={decision:'approved',note:'Synthetic example checked against the source.',checks:{privacy:true,correctness:true,reproduction:true}} as const;
    async function propose(){
        await quality.scoreConversation(tenantId,conversationId);
        const [source]=await execute('SELECT id FROM conversation_quality_scores');
        return service.propose(tenantId,agentId,{kind:'quality_score',evidenceId:source.id},actorId);
    }
    async function approved(){
        const row=await propose();
        const edited=await service.edit(tenantId,agentId,row.id,{expectedRevision:row.revision,scope,
            proposal:{...row.proposal,title:'Explain the opening hours',messages:['¿Cuáles son los horarios?'],criteria:'Use the configured hours; state unknown when unavailable.'}},actorId);
        await service.review(tenantId,agentId,row.id,{...review,expectedRevision:edited.revision},actorId);
        const [scenario]=await prisma.transactionInTenantSchema(schema,query=>fetchReviewedRegressionScenarios(query));
        return {row,scenario};
    }
    beforeAll(async()=>{
        const url=new URL(connection!);
        if(!['127.0.0.1','localhost'].includes(url.hostname)||!isDisposableDatabaseUrl(url))throw new Error('disposable_database_required');
        pool=new(require('pg').Pool)({connectionString:connection});await pool.query(`CREATE SCHEMA "${schema}"`);
        client=new PrismaClient({datasourceUrl:connection});
        prisma=Object.create(PrismaService.prototype);(prisma as any).$transaction=client.$transaction.bind(client);
        prisma.getTenantSchemaName=async()=>schema;
        for(const sql of [
            `CREATE TABLE contacts(id UUID PRIMARY KEY,name TEXT,phone TEXT,email TEXT)`,
            `CREATE TABLE agent_personas(id UUID PRIMARY KEY,version INTEGER,config_json JSONB)`,
            `CREATE TABLE conversations(id UUID PRIMARY KEY,contact_id UUID REFERENCES contacts(id),channel_type TEXT,status TEXT DEFAULT 'resolved',
                agent_persona_id UUID,agent_config_version INTEGER,agent_attribution_conflicted BOOLEAN DEFAULT false,metadata JSONB DEFAULT '{}',created_at TIMESTAMPTZ DEFAULT NOW())`,
            `CREATE TABLE messages(id UUID PRIMARY KEY,conversation_id UUID REFERENCES conversations(id),direction TEXT,content_text TEXT,created_at TIMESTAMPTZ DEFAULT NOW())`,
            `CREATE TABLE contact_identities(contact_id UUID,customer_profile_id UUID)`,
            `CREATE TABLE customer_memory_facts(id UUID,owner_kind TEXT,owner_id UUID,source_contact_id UUID)`,
            `CREATE TABLE customer_memories(contact_id UUID)`,
        ])await execute(sql);
        const judge={execute:jest.fn().mockResolvedValue({content:JSON.stringify({overall:3,resolution:2,tone:5,accuracy:3,empathy:4,flags:['missed_question'],resolved:false,resolutionReason:'Question remains unanswered.'})})};
        quality=new QualityService(prisma,{get:async()=>null,set:async()=>null} as any,judge as any,{add:jest.fn()} as any,{emit:jest.fn()} as any);
        service=new QualityRegressionService(prisma,quality);compliance=new ComplianceService(prisma);
        await service.ensureTables(schema);
        await ensureMissionEvidence(prisma,schema);
        evalService=Object.create(EvalService.prototype);(evalService as any).prisma=prisma;(evalService as any).ensured=new Set();
        await (evalService as any).ensureTable(schema);
        const autorun=new EvalAutorunStateService(prisma);await (autorun as any).schema(tenantId);
    },30000);
    beforeEach(async()=>{
        await execute('TRUNCATE quality_regression_cases,conversation_quality_scores,agent_mission_instances,messages,conversations,contacts,agent_personas,customer_memory_erasure,eval_runs,eval_autorun_requests CASCADE');
        await execute(`INSERT INTO contacts VALUES($1::uuid,'Ada Lovelace','+573001234567','ada@example.org')`,[contactId]);
        await execute(`INSERT INTO agent_personas VALUES($1::uuid,4,'{"mission":{"objective":"Answer questions"}}')`,[agentId]);
        await execute(`INSERT INTO conversations(id,contact_id,channel_type,agent_persona_id,agent_config_version,resolution_type) VALUES($1::uuid,$2::uuid,'web_widget',$3::uuid,4,'ai_resolved')`,[conversationId,contactId,agentId]);
        await execute(`INSERT INTO messages VALUES($1::uuid,$2::uuid,'inbound','Soy Ada Lovelace, ada@example.org, ¿cuáles son los horarios?',NOW()-INTERVAL '1 minute'),
            (gen_random_uuid(),$2::uuid,'outbound','Gracias por escribir.',NOW()),(gen_random_uuid(),$2::uuid,'internal','SECRET STAFF NOTE',NOW())`,[inboundId,conversationId]);
    });
    afterAll(async()=>{
        await client?.$disconnect();if(!pool)return;
        if(!/^tenant_regression_[a-f0-9]{32}$/.test(schema))throw new Error('invalid_cleanup_scope');
        await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await pool.end();
    });
    it('creates a redacted source-bound proposal once, excluding internal notes',async()=>{
        const row=await propose();
        expect(row.state).toBe('proposed');expect(row.evidenceKind).toBe('conversational_opinion');expect(row.sourceConfiguration).toBe('captured');
        expect(JSON.stringify(row)).not.toMatch(/Ada Lovelace|ada@example|SECRET STAFF/);
        expect(row.proposal.coverage).toMatchObject({selectedMessages:2,sourceMessages:2});
        const [source]=await execute('SELECT id FROM conversation_quality_scores');
        await service.propose(tenantId,agentId,{kind:'quality_score',evidenceId:source.id},actorId);
        expect(await execute('SELECT id FROM quality_regression_cases')).toHaveLength(1);
        expect(await execute('SELECT case_id FROM quality_regression_revisions')).toHaveLength(1);
    });
    it('requires complete review and rejects stale edits or a source changed before approval',async()=>{
        const row=await propose();
        await expect(service.review(tenantId,agentId,row.id,{...review,expectedRevision:1,checks:{...review.checks,privacy:false}},actorId)).rejects.toThrow();
        await expect(service.edit(tenantId,agentId,row.id,{expectedRevision:2,scope,proposal:row.proposal},actorId)).rejects.toThrow();
        await execute(`UPDATE messages SET content_text='Corrected customer question' WHERE id=$1::uuid`,[inboundId]);
        await expect(service.review(tenantId,agentId,row.id,{...review,expectedRevision:1},actorId)).rejects.toThrow();
        expect((await execute('SELECT state FROM quality_regression_cases'))[0].state).toBe('proposed');
    });
    it('only loads approved immutable scenarios and rejects forged body, agent or channel',async()=>{
        const {scenario}=await approved();
        await prisma.transactionInTenantSchema(schema,query=>assertReviewedRegressionScenarios(query,[scenario],agentId,'web_widget'));
        for(const changed of [{...scenario,messages:['Forged text']},{...scenario,regressionAgentId:randomUUID()}])
            await expect(prisma.transactionInTenantSchema(schema,query=>assertReviewedRegressionScenarios(query,[changed],agentId,'web_widget'))).rejects.toThrow();
        await expect(prisma.transactionInTenantSchema(schema,query=>assertReviewedRegressionScenarios(query,[scenario],agentId,'whatsapp'))).rejects.toThrow();
        expect(await execute('SELECT id FROM eval_scenarios')).toHaveLength(0);
        await expect(evalService.addScenario(tenantId,scenario)).rejects.toThrow();
        await expect(evalService.deleteScenario(tenantId,scenario.id)).rejects.toThrow();
    });
    it('invalidates approval after public transcript drift, including a later follow-up',async()=>{
        const {scenario}=await approved();
        await execute(`INSERT INTO messages VALUES(gen_random_uuid(),$1::uuid,'inbound','It is still unresolved',NOW())`,[conversationId]);
        const [loaded]=await prisma.transactionInTenantSchema(schema,query=>fetchReviewedRegressionScenarios(query));
        expect(loaded).toMatchObject({seedState:'review_required',regressionBlocked:'source_changed'});
        await expect(prisma.transactionInTenantSchema(schema,query=>assertReviewedRegressionScenarios(query,[scenario],agentId))).rejects.toThrow();
    });
    it('erasure waits for bounded use, deletes cases/history/runs/checkpoints and blocks late resurrection',async()=>{
        const {row,scenario}=await approved();
        const revision=randomUUID();
        await execute(`INSERT INTO eval_runs(agent_id,results,release_evidence,regression_case_ids) VALUES($1::uuid,$2::jsonb,$2::jsonb,$3::uuid[])`,[agentId,JSON.stringify([scenario]),[row.id]]);
        await execute(`INSERT INTO eval_autorun_requests(agent_id,revision,agent_snapshot,scenarios,regression_case_ids) VALUES($1::uuid,$2::uuid,'{}',$3::jsonb,$4::uuid[])`,[agentId,revision,JSON.stringify([scenario]),[row.id]]);
        const entered=deferred(),release=deferred();
        const use=withReviewedRegressionScenarios(prisma,schema,[scenario],agentId,'web_widget',async()=>{entered.resolve();await release.promise;return 'done';});
        await entered.promise;let erased=false;
        const erasing=(compliance as any).eraseCustomerMemory(schema, contactId, tenantId).then(()=>{erased=true;});
        await new Promise(done=>setTimeout(done,50));expect(erased).toBe(false);
        release.resolve();await use;await erasing;
        for(const table of ['quality_regression_cases','quality_regression_revisions','quality_regression_reviews','eval_runs','eval_autorun_requests'])
            expect(await execute(`SELECT * FROM ${table}`)).toHaveLength(0);
        await new EvalAutorunStateService(prisma).update(tenantId,agentId,revision,'completed',undefined,[scenario],[]);
        expect(await execute('SELECT * FROM eval_autorun_requests')).toHaveLength(0);
        await expect(service.review(tenantId,agentId,row.id,{...review,expectedRevision:2},actorId)).rejects.toThrow();
        const runId=randomUUID();
        await expect((evalService as any).persistRun(schema,agentId,{runId,k:1,threshold:7,passed:true,scenarios:[scenario],
            releaseEvidence:{scenarios:[scenario]},status:'completed'},'manual')).rejects.toThrow();
        await (evalService as any).persistRun(schema,agentId,{runId,k:1,threshold:7,passed:false,scenarios:[scenario],releaseEvidence:{scenarios:[scenario]},status:'failed'},'manual');
        expect(await execute('SELECT id FROM eval_runs')).toHaveLength(1);
        const [failure]=await execute('SELECT * FROM eval_runs');
        expect(failure.status).toBe('invalidated');expect(failure.results).toEqual([]);expect(failure.agent_snapshot).toBeNull();expect(failure.release_evidence).toBeNull();
    },30000);
    it('retiring a case clears only its derived runs and rejects late checkpoints',async()=>{
        const {row,scenario}=await approved();const revision=randomUUID();
        await execute(`INSERT INTO eval_runs(agent_id,results,regression_case_ids) VALUES($1::uuid,$2::jsonb,$3::uuid[]),($1::uuid,'[]','{}')`,[agentId,JSON.stringify([scenario]),[row.id]]);
        await execute(`INSERT INTO eval_autorun_requests(agent_id,revision,agent_snapshot) VALUES($1::uuid,$2::uuid,'{}')`,[agentId,revision]);
        await service.review(tenantId,agentId,row.id,{...review,decision:'retired',expectedRevision:2},actorId);
        expect(await execute('SELECT * FROM eval_runs')).toHaveLength(1);
        const state=new EvalAutorunStateService(prisma);
        await state.update(tenantId,agentId,revision,'completed',undefined,[scenario],[]);
        await state.update(tenantId,agentId,revision,'failed','retry from old worker');
        expect((await execute('SELECT * FROM eval_autorun_requests'))[0]).toMatchObject({status:'invalidated',agent_snapshot:{},results:[],scenarios:null});
    });
    it.each(['es','en','pt','fr'])('uses all inbound turns as denominator and keeps command/workflow completion separate from outcome (%s)',async language=>{
        const recorder=(messageId:string)=>new MissionTurnRecorder(prisma,schema,{conversationId,messageId,agentId,agentVersion:4,
            configHash:'a'.repeat(64),language,channel:'web_widget',executionMode:'live',profileId:'salud/dental'});
        await recorder(inboundId).observe({kind:'booking',handled:true,state:'ask_date'});
        const second=randomUUID(),unobserved=randomUUID();
        await execute(`INSERT INTO messages VALUES($1::uuid,$3::uuid,'inbound','Next booking turn',NOW()),($2::uuid,$3::uuid,'inbound','No reply yet',NOW())`,[second,unobserved,conversationId]);
        const closing=recorder(second);
        await closing.observe({kind:'booking',handled:true,state:'booked'});
        await closing.observe({kind:'tool',tool:'create_appointment',toolStatus:'succeeded'});
        await closing.observe({kind:'final'});
        const metrics=await missionMetrics(prisma,schema,agentId,new Date(Date.now()-86400000).toISOString(),new Date(Date.now()+86400000).toISOString());
        expect(metrics).toMatchObject({eligible_turns:3,observed_turns:2,unobserved_turns:1,operationalSuccessRate:null});
        expect(metrics.groups.find((row:any)=>row.mission==='unknown')).toMatchObject({eligible_turns:1,language:'unknown',difficulty:'unknown',outcome_unknown_turns:1});
        expect(metrics.groups.some((row:any)=>row.mission==='book_appointment'&&row.language===language&&row.difficulty==='multi_step')).toBe(true);
        expect(metrics.groups.reduce((sum:number,row:any)=>sum+row.verified_success_turns,0)).toBe(0);
        expect(metrics.instances.workflow_completed).toBe(1);
        expect((await execute(`SELECT * FROM agent_mission_instances WHERE engine='booking'`))).toHaveLength(1);
        expect(JSON.stringify(await execute('SELECT * FROM agent_mission_steps'))).not.toMatch(/Ada Lovelace|ada@example|Next booking/);
    });
    it('keeps multiple observed missions in one turn, invalidates edited source and erases all observation lineage',async()=>{
        const recorder=new MissionTurnRecorder(prisma,schema,{conversationId,messageId:inboundId,agentId,agentVersion:4,
            configHash:'a'.repeat(64),language:'es',channel:'web_widget',executionMode:'live',profileId:'salud/dental'});
        await recorder.observe({kind:'booking',handled:true,state:'ask_date'});
        await recorder.observe({kind:'intent',intent:'general_question'});
        let metrics=await missionMetrics(prisma,schema,agentId,new Date(Date.now()-86400000).toISOString(),new Date(Date.now()+86400000).toISOString());
        expect(metrics.eligible_turns).toBe(1);expect(metrics.groups.map((row:any)=>row.mission).sort()).toEqual(['ask_question','book_appointment']);
        await execute(`UPDATE messages SET content_text='A corrected request' WHERE id=$1::uuid`,[inboundId]);
        metrics=await missionMetrics(prisma,schema,agentId,new Date(Date.now()-86400000).toISOString(),new Date(Date.now()+86400000).toISOString());
        expect(metrics.unobserved_turns).toBe(1);
        await (compliance as any).eraseCustomerMemory(schema, contactId, tenantId);
        await recorder.observe({kind:'final'});
        for(const table of ['agent_mission_turns','agent_mission_steps','agent_mission_instances'])expect(await execute(`SELECT * FROM ${table}`)).toHaveLength(0);
    });
    it('serializes conflicting human approvals for the same exact revision',async()=>{
        const row=await propose();
        const edited=await service.edit(tenantId,agentId,row.id,{expectedRevision:1,scope,proposal:{...row.proposal,title:'Question',criteria:'Answer from the configured information.'}},actorId);
        const results=await Promise.allSettled([service.review(tenantId,agentId,row.id,{...review,expectedRevision:edited.revision},actorId),
            service.review(tenantId,agentId,row.id,{...review,expectedRevision:edited.revision},randomUUID())]);
        expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);
        expect(await execute('SELECT id FROM quality_regression_reviews')).toHaveLength(1);
    });
    it('uses ledger failure evidence and detects sub-millisecond ledger changes without a conversation revision change',async()=>{
        await execute(`CREATE TABLE tool_execution_ledger(id UUID PRIMARY KEY,conversation_id UUID,contact_id UUID,tool_name TEXT,status TEXT,
            updated_at TIMESTAMPTZ DEFAULT NOW(),created_at TIMESTAMPTZ DEFAULT NOW(),args_hash TEXT,request_source_message_id UUID,
            confirmation_source_message_id UUID,confirmed_by_message_id UUID)`);
        try{
            const id=randomUUID();
            await execute(`INSERT INTO tool_execution_ledger(id,conversation_id,contact_id,tool_name,status,args_hash,request_source_message_id)
                VALUES($1::uuid,$2::uuid,$3::uuid,'create_appointment','succeeded',$4,$5::uuid)`,[id,conversationId,contactId,'a'.repeat(64),inboundId]);
            await expect(service.propose(tenantId,agentId,{kind:'tool_ledger',evidenceId:id},actorId)).rejects.toThrow();
            await execute(`UPDATE tool_execution_ledger SET status='failed' WHERE id=$1::uuid`,[id]);
            const row=await service.propose(tenantId,agentId,{kind:'tool_ledger',evidenceId:id},actorId);
            expect(row).toMatchObject({evidenceKind:'canonical_tool_failure',sourceConfiguration:'unavailable'});
            const [before]=await execute('SELECT qa_revision FROM conversations');
            await execute(`UPDATE tool_execution_ledger SET updated_at=updated_at+INTERVAL '1 microsecond' WHERE id=$1::uuid`,[id]);
            expect((await execute('SELECT qa_revision FROM conversations'))[0].qa_revision).toBe(before.qa_revision);
            await expect(service.edit(tenantId,agentId,row.id,{expectedRevision:1,scope,proposal:{...row.proposal,title:'Test',criteria:'Check the failure.'}},actorId)).rejects.toThrow();
        }finally{await execute('DROP TABLE tool_execution_ledger');}
    });
    it('bootstraps the canonical template block with a real Prisma client and fully qualified tenant tables',async()=>{
        const target=`${schema}_template`;
        await pool.query(`CREATE SCHEMA "${target}"`);
        try{
            for(const sql of [
                `CREATE TABLE "${target}".contacts(id UUID PRIMARY KEY)`,
                `CREATE TABLE "${target}".agent_personas(id UUID PRIMARY KEY)`,
                `CREATE TABLE "${target}".conversations(id UUID PRIMARY KEY)`,
                `CREATE TABLE "${target}".messages(id UUID PRIMARY KEY)`,
                `CREATE TABLE "${target}".eval_autorun_requests(agent_id UUID PRIMARY KEY)`,
            ])await client.$executeRawUnsafe(sql);
            const source=readFileSync(resolve(__dirname,'../../../../prisma/tenant-schema.sql'),'utf8');
            const start=source.indexOf('-- BEGIN QUALITY REGRESSION AND MISSION EVIDENCE'),end=source.indexOf('-- END QUALITY REGRESSION AND MISSION EVIDENCE',start);
            expect(start).toBeGreaterThan(0);expect(end).toBeGreaterThan(start);
            const statements=(prisma as any).splitSqlStatements(source.slice(start,end).replaceAll('{{SCHEMA_NAME}}',target));
            for(const statement of statements)await client.$executeRawUnsafe(statement);
            const tables=await client.$queryRawUnsafe(`SELECT table_name FROM information_schema.tables WHERE table_schema=$1`,target) as any[];
            expect(tables.map(row=>row.table_name)).toEqual(expect.arrayContaining(['quality_regression_cases','quality_regression_reviews','agent_mission_instances','eval_runs']));
        }finally{
            if(!/^tenant_regression_[a-f0-9]{32}_template$/.test(target))throw new Error('invalid_cleanup_scope');
            await pool.query(`DROP SCHEMA "${target}" CASCADE`);
        }
    });
});
