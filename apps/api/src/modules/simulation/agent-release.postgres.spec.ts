import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PrismaClient } from '@prisma/client';
import { composeSubtypeEvalPack, EVAL_LANGUAGES } from '@parallext/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AgentConfigurationRevisionStore, operationalConfigurationBody, type RevisionQuery } from '../persona/agent-configuration-revision';
import { evaluationSnapshot, sealEvaluationSnapshot } from '../conversations/agent-evaluation-snapshot';
import { revisionHash, sealRevision } from '../evaluation-revision/evaluation-revision';
import { AgentReleaseStore } from './agent-release-store';
import { releaseReviewEvidence } from './agent-release-contract';
import { releaseRunContext, sealReleaseRun } from './agent-release-policy';
import { invalidateRegressionArtifacts } from '../quality/regressions/quality-regression-retention';

const url=process.env.AGENT_RELEASE_TEST_DATABASE_URL;
(url?describe:describe.skip)('Release request, lease and human review transactions on disposable PostgreSQL',()=>{
    const schema=`tenant_releasetest_${randomUUID().replace(/-/g,'')}`;
    const tenantId=randomUUID(),agentId=randomUUID(),actor={id:randomUUID(),role:'tenant_admin'};
    let client:PrismaClient,prisma:PrismaService,store:AgentReleaseStore;
    const query=(sql:string,params:any[]=[])=>prisma.executeInTenantSchema<any[]>(schema,sql,params);
    const tx=<T>(work:(q:RevisionQuery)=>Promise<T>)=>prisma.transactionInTenantSchema(schema,work);
    const sourceScenarios=EVAL_LANGUAGES.flatMap(language=>composeSubtypeEvalPack({industry:'education',subtype:'capacitacion',language}))
        .filter(row=>!row.key.startsWith('intent_')||row.key.startsWith('intent_ask_question_'))
        .map(row=>({...row,key:row.storageKey,managedSeedKey:row.key,seedOrigin:row.origin,expectedActions:row.expectedActions||[]}));
    const request=async(channels=['web_widget','telegram'])=>{
        const operational=(await query('SELECT * FROM agent_personas WHERE id=$1::uuid',[agentId]))[0];
        const baseBody=structuredClone(operationalConfigurationBody(operational));
        const body=operationalConfigurationBody(operational);body.configJson.behavior.rules=['Candidate rule'];body.channels=channels;body.channelBindings=channels.map(channel=>`${channel}:owned`);
        const draft=await tx(q=>new AgentConfigurationRevisionStore(prisma).saveWithQuery(q,{tenantId,agentId,actor,requestKey:randomUUID(),expectedOperationalVersion:7,expectedDraftRevision:null,body}));
        const snapshot=evaluationSnapshot(tenantId,agentId,{version:7,config_json:body.configJson});
        snapshot.configurationRevisionId=draft.id;snapshot.configurationRevisionHash=draft.body_hash;
        snapshot.configurationBaseOperationalHash=draft.base_operational_hash;snapshot.configurationBaseOperationalBody=baseBody;
        snapshot.releaseScope={profileId:'education/capacitacion',intentKeys:['ask_question'],missionConfigured:true,channels,languages:[...EVAL_LANGUAGES]};
        snapshot.mcpTools=[];snapshot.mcpToolsHash=revisionHash([]);snapshot.procedures=[];snapshot.proceduresHash=revisionHash([]);
        snapshot.runtimeInputs={providerHealth:{},planFeatures:{},llmSpendUsdCents:0,mcpDiscoveredCount:0,mcpApprovedCount:0};snapshot.runtimeInputsHash=revisionHash(snapshot.runtimeInputs);
        snapshot.manifest=sealRevision(tenantId,[{key:'fixture.transaction_test',state:'present',hash:revisionHash('synthetic')}],[]);sealEvaluationSnapshot(snapshot);
        return {tenantId,agentId,actor,requestKey:randomUUID(),snapshot,scenarios:structuredClone(sourceScenarios)};
    };
    const create=(input:any)=>tx(q=>store.create(q,schema,input));
    const read=(id:string)=>tx(q=>store.read(q,agentId,id));
    const claim=async(id:string,channel='web_widget')=>{
        const data=(await read(id))!;const evaluation=data.evaluations.find(row=>row.channel_type===channel);
        return tx(q=>store.claim(q,schema,tenantId,agentId,id,evaluation.id));
    };
    const authority=(work:any)=>({tenantId,agentId,candidateId:work.candidate.id,evaluationId:work.evaluation.id,leaseToken:work.leaseToken});
    const checkpoint=(work:any,extra:any={})=>tx(q=>store.checkpoint(q,schema,{...authority(work),...extra}));
    // Synthetic scores exercise storage/approval policy only; they do not certify model performance.
    const completed=(work:any)=>{
        const snapshot=work.candidate.agent_snapshot;
        const evidence:any={agentId,dependencyRevision:snapshot.manifest.revision,configHash:snapshot.configHash,
            channelType:work.evaluation.channel_type,status:'completed',k:3,passPolicy:'all',threshold:8,scenarios:work.candidate.scenarios};
        const results=evidence.scenarios.map((row:any)=>({key:row.key,scenarioHash:revisionHash(row),contextHash:releaseRunContext(evidence),k:3,passes:3,passed:true,score:9,
            runs:Array.from({length:3},()=>({score:9,passed:true,flags:[],actionChecks:row.expectedActions.map(()=>({ok:true})),
                transcript:[{role:'user',content:'Synthetic question'},{role:'assistant',content:`Synthetic reply ${row.language}`}],transcriptTruncated:false}))}));
        return {status:'completed',results,evidence:sealReleaseRun({...evidence,results}),runId:randomUUID()};
    };
    const evaluate=async(id:string)=>{for(const channel of (await read(id))!.candidate.channels){const work=await claim(id,channel);await checkpoint(work,completed(work));}return (await read(id))!;};
    const reviewBody=(data:any)=>{const evidence=releaseReviewEvidence(data.candidate,data.evaluations);return {expectedVersion:data.candidate.version,evidenceHash:evidence.evidenceHash,
        requestKey:randomUUID(),decision:'approve' as const,checks:{objective:true,instructions:true,facts:true,tools:true,style:true,limits:true},sampleHashes:evidence.sampleHashes};};
    const review=(id:string,body:any,current=async()=>{})=>tx(q=>store.review(q,schema,{tenantId,agentId,candidateId:id,actor,body},current));
    beforeAll(async()=>{
        const parsed=new URL(url!);if(!['127.0.0.1','localhost','[::1]'].includes(parsed.hostname)||!parsed.pathname.endsWith('_eval_isolation'))throw new Error('disposable_loopback_database_required');
        client=new PrismaClient({datasourceUrl:url});
        await client.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS public.tenants(id UUID PRIMARY KEY,schema_name TEXT)');
        await client.$executeRawUnsafe('INSERT INTO public.tenants(id,schema_name) VALUES($1::uuid,$2)',tenantId,schema);
        await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
        prisma=Object.create(PrismaService.prototype);prisma.$transaction=client.$transaction.bind(client);prisma.$queryRawUnsafe=client.$queryRawUnsafe.bind(client);
        await query(`CREATE TABLE agent_personas(id UUID PRIMARY KEY,name TEXT,config_json JSONB,channels TEXT[],channel_bindings TEXT[],schedule_mode TEXT,is_active BOOLEAN,is_default BOOLEAN,version INTEGER)`);
        const ddl=readFileSync(resolve(__dirname,'../../../prisma/tenant-schema.sql'),'utf8');
        for(const marker of ['AGENT CONFIGURATION REVISIONS','AGENT RELEASE CANDIDATES']){
            const start=ddl.indexOf(`-- BEGIN ${marker}`),end=ddl.indexOf(`-- END ${marker}`,start);if(start<0||end<0)throw new Error('release_ddl_missing');
            for(const statement of ddl.slice(start,end).replaceAll('{{SCHEMA_NAME}}',schema).split(';').filter(row=>row.trim()))await client.$executeRawUnsafe(statement);
        }
        store=new AgentReleaseStore(prisma);
    });
    beforeEach(async()=>{
        await query('TRUNCATE agent_release_candidates,agent_configuration_commands,agent_configuration_drafts,agent_configuration_revisions,agent_personas CASCADE');
        await query(`INSERT INTO agent_personas VALUES($1::uuid,'Alex',$2::jsonb,ARRAY['web_widget'],ARRAY['web_widget:owned'],'24_7',true,true,7)`,[agentId,JSON.stringify({persona:{name:'Alex'},behavior:{rules:['Serving rule']}})]);
    });
    afterAll(async()=>{if(client)try{
        if(!/^tenant_releasetest_[a-f0-9]{32}$/.test(schema))throw new Error('invalid_cleanup_scope');
        await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await client.$executeRawUnsafe('DELETE FROM public.tenants WHERE id=$1::uuid AND schema_name=$2',tenantId,schema);
    }finally{await client.$disconnect();}});
    it('persists one shared draft snapshot for every assigned channel and leaves the serving agent untouched',async()=>{
        const before=await query('SELECT * FROM agent_personas'),input=await request(),candidate=await create(input),data=(await read(candidate.id))!;
        expect(data.evaluations.map(row=>row.channel_type)).toEqual(['telegram','web_widget']);
        expect(data.candidate.agent_snapshot).toEqual(input.snapshot);expect(await query('SELECT * FROM agent_personas')).toEqual(before);
    });
    it('deduplicates concurrent same-key requests and preserves the original snapshot',async()=>{
        const input=await request();const rows=await Promise.all(Array.from({length:5},()=>create(input)));
        expect(new Set(rows.map(row=>row.id)).size).toBe(1);expect(await query('SELECT * FROM agent_release_evaluations')).toHaveLength(2);
    });
    it('rejects another tenant, non-admin, or changed draft body without durable evaluations',async()=>{
        const input=await request();await expect(create({...input,actor:{...actor,role:'tenant_agent'}})).rejects.toMatchObject({response:{error:'agent_release_role_required'}});
        await expect(create({...input,tenantId:randomUUID()})).rejects.toThrow('agent_snapshot_scope_mismatch');
        input.snapshot.configurationRevisionHash='f'.repeat(64);sealEvaluationSnapshot(input.snapshot);
        await expect(create(input)).rejects.toMatchObject({response:{error:'agent_release_draft_mismatch'}});expect(await query('SELECT * FROM agent_release_candidates')).toHaveLength(0);
    });
    it('rolls a candidate back when one of its channel requests cannot be stored',async()=>{
        const input=await request();await expect(tx(q=>store.create(async(sql,params)=>{
            if(sql.startsWith('INSERT INTO agent_release_evaluations')&&params?.[1]==='web_widget')throw new Error('synthetic_failure');return q(sql,params);
        },schema,input))).rejects.toThrow('synthetic_failure');expect(await query('SELECT * FROM agent_release_candidates')).toHaveLength(0);
    });
    it('grants only one concurrent worker the lease',async()=>{
        const candidate=await create(await request());const rows=await Promise.all(Array.from({length:5},()=>claim(candidate.id)));
        expect(rows.filter(Boolean)).toHaveLength(1);
    });
    it('resumes saved progress after expiration and refuses the previous worker even after restart',async()=>{
        const candidate=await create(await request()),first=await claim(candidate.id);const partial=completed(first).results.slice(0,1);
        await checkpoint(first,{results:partial});await query("UPDATE agent_release_evaluations SET lease_until=NOW()-INTERVAL '1 second' WHERE id=$1::uuid",[first.evaluation.id]);
        store=new AgentReleaseStore(prisma);const second=await claim(candidate.id);expect(second.leaseToken).not.toBe(first.leaseToken);expect(second.evaluation.results).toEqual(partial);
        await expect(checkpoint(first,completed(first))).rejects.toMatchObject({response:{error:'agent_release_lease_lost'}});
        await checkpoint(second,completed(second));
    });
    it('keeps a budget-deferred request and checkpoint until the next budget day',async()=>{
        const candidate=await create(await request()),work=await claim(candidate.id);const partial=completed(work).results.slice(0,1);
        await checkpoint(work,{status:'budget_deferred',results:partial,error:'eval_autorun_budget_exhausted'});
        expect(await claim(candidate.id)).toBeNull();const row=(await read(candidate.id))!.evaluations.find(item=>item.id===work.evaluation.id);
        expect(row.status).toBe('budget_deferred');expect(row.results).toEqual(partial);
    });
    it.each(['channel','revision','scenario','policy'])('rejects a completed run with a mismatched %s',async kind=>{
        const candidate=await create(await request()),work=await claim(candidate.id),result=completed(work);
        if(kind==='channel')result.evidence.channelType='whatsapp';if(kind==='revision')result.evidence.dependencyRevision='e'.repeat(64);
        if(kind==='scenario')result.evidence.scenarios=result.evidence.scenarios.slice(1);if(kind==='policy')result.evidence.k=1;
        result.evidence=sealReleaseRun(result.evidence);
        await expect(checkpoint(work,result)).rejects.toThrow();expect((await read(candidate.id))!.evaluations.find(row=>row.id===work.evaluation.id).status).toBe('running');
    });
    it('does not approve one channel when another assigned channel lacks results',async()=>{
        const candidate=await create(await request()),work=await claim(candidate.id);await checkpoint(work,completed(work));
        const data=(await read(candidate.id))!;expect(releaseReviewEvidence(data.candidate,data.evaluations).eligibleForReview).toBe(false);
        await expect(review(candidate.id,reviewBody(data))).rejects.toMatchObject({response:{error:'agent_release_version_changed'}});
    });
    it('requires concrete untruncated response samples as well as technical passing evidence',async()=>{
        const candidate=await create(await request(['web_widget'])),work=await claim(candidate.id),result=completed(work);
        for(const row of result.evidence.results)for(const attempt of row.runs)delete attempt.transcript;
        result.evidence=sealReleaseRun(result.evidence);result.results=result.evidence.results;await checkpoint(work,result);
        const data=(await read(candidate.id))!;expect(releaseReviewEvidence(data.candidate,data.evaluations).eligibleForReview).toBe(false);
        await expect(review(candidate.id,reviewBody(data))).rejects.toMatchObject({response:{error:'agent_release_review_incomplete'}});
    });
    it('records a fully scoped human review once without changing the serving version or allowing activation',async()=>{
        const before=await query('SELECT * FROM agent_personas'),candidate=await create(await request()),data=await evaluate(candidate.id),body=reviewBody(data);
        const evidence=releaseReviewEvidence(data.candidate,data.evaluations);expect(evidence.eligibleForReview).toBe(true);expect(evidence.samples).toHaveLength(8);
        const first=await review(candidate.id,body),replay=await review(candidate.id,body);expect(replay.id).toBe(first.id);
        expect((await read(candidate.id))!.candidate.status).toBe('approved');expect(await query('SELECT * FROM agent_personas')).toEqual(before);
        expect(evidence.activationAllowed).toBe(false);expect(evidence.certified).toBe(false);
    });
    it('does not accept an outdated review, missing declarations, missing samples or a changed dependency',async()=>{
        const candidate=await create(await request()),data=await evaluate(candidate.id),body=reviewBody(data);
        await expect(review(candidate.id,{...body,expectedVersion:body.expectedVersion-1})).rejects.toMatchObject({response:{error:'agent_release_version_changed'}});
        await expect(review(candidate.id,{...body,checks:{...body.checks,facts:false}})).rejects.toMatchObject({response:{error:'agent_release_review_incomplete'}});
        await expect(review(candidate.id,{...body,sampleHashes:body.sampleHashes.slice(1)})).rejects.toMatchObject({response:{error:'agent_release_review_incomplete'}});
        await expect(review(candidate.id,body,async()=>{throw new Error('evaluation_dependencies_changed');})).rejects.toThrow('evaluation_dependencies_changed');
        expect(await query('SELECT * FROM agent_release_reviews')).toHaveLength(0);
    });
    it('uses CAS when two reviewers make competing decisions',async()=>{
        const candidate=await create(await request()),data=await evaluate(candidate.id),body=reviewBody(data);
        const results=await Promise.allSettled([review(candidate.id,body),review(candidate.id,{...body,decision:'reject',requestKey:randomUUID()})]);
        expect(results.filter(row=>row.status==='fulfilled')).toHaveLength(1);expect(await query('SELECT * FROM agent_release_reviews')).toHaveLength(1);
    });
    it('replays simultaneous identical reviews as one durable decision',async()=>{
        const candidate=await create(await request()),data=await evaluate(candidate.id),body=reviewBody(data);
        const results=await Promise.all(Array.from({length:5},()=>review(candidate.id,body)));
        expect(new Set(results.map(row=>row.id)).size).toBe(1);expect(await query('SELECT * FROM agent_release_reviews')).toHaveLength(1);
    });
    it('scrubs derived transcripts on source retirement and never allows a late leased writer to restore them',async()=>{
        const candidate=await create(await request()),work=await claim(candidate.id),caseId=randomUUID();
        await checkpoint(work,{results:completed(work).results.slice(0,1)});
        await query('UPDATE agent_release_candidates SET regression_case_ids=ARRAY[$1::uuid] WHERE id=$2::uuid',[caseId,candidate.id]);
        await tx(q=>invalidateRegressionArtifacts(q,[caseId]));
        const data=(await read(candidate.id))!;expect(data.candidate).toMatchObject({status:'invalidated',agent_snapshot:null,scenarios:[]});
        expect(data.evaluations.every(row=>row.status==='invalidated'&&row.results.length===0&&!row.evidence)).toBe(true);
        await expect(checkpoint(work,completed(work))).rejects.toMatchObject({response:{error:'agent_release_invalidated'}});
    });
});
