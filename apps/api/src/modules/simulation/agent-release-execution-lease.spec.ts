import { randomUUID } from 'crypto';
import { AgentReleaseStore } from './agent-release-store';
import { evaluationSnapshot, sealEvaluationSnapshot } from '../conversations/agent-evaluation-snapshot';
import { evaluationKnowledgeFixture } from '../conversations/__fixtures__/evaluation-knowledge.fixture';
import { RegionalProfileService } from '../tenants/regional-profile.service';
import { revisionHash, sealRevision } from '../evaluation-revision/evaluation-revision';
import { sealStructuredKnowledgeCapture } from '../evaluation-revision/evaluation-structured-knowledge';
import { assertReviewedRegressionScenarios } from '../quality/regressions/quality-regression-runtime';

describe('release execution lease checks inside an existing source fence',()=>{
    function fixture(){
        const input={tenantId:randomUUID(),agentId:randomUUID(),candidateId:randomUUID(),evaluationId:randomUUID(),leaseToken:randomUUID()};
        const schema='tenant_release_readonly';
        const snapshot=evaluationSnapshot(input.tenantId,input.agentId,{version:1,config_json:{language:'es'}});
        snapshot.releaseScope={profileId:null,intentKeys:[],missionConfigured:false,channels:['telegram'],languages:['es']};
        snapshot.mcpTools=[];snapshot.mcpToolsHash=revisionHash([]);snapshot.procedures=[];snapshot.proceduresHash=revisionHash([]);
        snapshot.runtimeInputs={providerHealth:{},planFeatures:{},llmSpendUsdCents:0,mcpDiscoveredCount:0,mcpApprovedCount:0};
        snapshot.runtimeInputsHash=revisionHash(snapshot.runtimeInputs);
        snapshot.contextInputs={version:1,tenantId:input.tenantId,businessHours:null,business:null,activeObjectPolicy:{},
            regional:new RegionalProfileService({} as any,{} as any).compose(input.tenantId,{}),vertical:{es:null,en:null,pt:null,fr:null}};
        snapshot.structuredKnowledgeInputs=sealStructuredKnowledgeCapture({version:1,tenantId:input.tenantId,sourceSchema:schema,
            capturedAt:snapshot.capturedAt,faqs:{state:'present',rows:[]},policies:{state:'present',rows:[]}});
        snapshot.knowledgeInputs=evaluationKnowledgeFixture(input.tenantId,input.agentId,schema);
        snapshot.manifest=sealRevision(input.tenantId,[{key:'fixture',state:'present',hash:revisionHash('fixture')}],[]);
        sealEvaluationSnapshot(snapshot);
        const candidate:any={id:input.candidateId,agent_id:input.agentId,status:'evaluating',agent_snapshot:snapshot,
            channels:['telegram'],scenarios:[],scenario_hash:revisionHash([])};
        const evaluation:any={id:input.evaluationId,candidate_id:input.candidateId,channel_type:'telegram',status:'running',lease_token:input.leaseToken,lease_valid:true};
        const state={tenant:true,candidate:true,evaluation:true};
        const query=jest.fn(async(sql:string)=>{
            if(/FROM public.tenants/.test(sql))return state.tenant?[{id:input.tenantId}]:[];
            if(/to_regclass/.test(sql))return [{name:'synthetic_relation'}];
            if(/FROM agent_release_candidates/.test(sql))return state.candidate?[candidate]:[];
            if(/FROM agent_release_evaluations/.test(sql))return state.evaluation?[evaluation]:[];
            if(/FROM quality_regression_cases/.test(sql))return [];
            throw new Error(`Unexpected I/O boundary ${sql}`);
        });
        const check=()=>new AgentReleaseStore({} as any).assertExecutionLease(query as any,input);
        return {input,snapshot,candidate,evaluation,state,query,check};
    }
    it('verifies a sealed candidate and current lease using only reads and the database wall clock',async()=>{
        const f=fixture();await expect(f.check()).resolves.toBeUndefined();
        expect(f.query.mock.calls.every(([sql])=>/^SELECT\b/.test(sql)&&!/(FOR (UPDATE|SHARE)|pg_advisory)/.test(sql))).toBe(true);
        expect(f.query.mock.calls.some(([sql])=>sql.includes('lease_until>clock_timestamp()'))).toBe(true);
        expect(f.evaluation).toMatchObject({status:'running',lease_token:f.input.leaseToken});
    });
    it.each(['tenant','candidate','evaluation'] as const)('fails closed when the %s is missing',async field=>{
        const f=fixture();f.state[field]=false;await expect(f.check()).rejects.toThrow();
    });
    it.each(['expired','replacement','evaluation_completed','candidate_evaluated'])('refuses %s without changing ownership',async kind=>{
        const f=fixture();
        if(kind==='expired')f.evaluation.lease_valid=false;
        if(kind==='replacement')f.evaluation.lease_token=randomUUID();
        if(kind==='evaluation_completed')f.evaluation.status='completed';
        if(kind==='candidate_evaluated')f.candidate.status='evaluated';
        await expect(f.check()).rejects.toMatchObject({response:{error:'agent_release_lease_lost'}});
        expect(f.query.mock.calls.every(([sql])=>!/^\s*(UPDATE|INSERT|DELETE)/.test(sql))).toBe(true);
    });
    it.each(['scope','config','scenario_hash','channels'])('rejects changed %s before authorizing another use',async kind=>{
        const f=fixture();
        if(kind==='scope')f.snapshot.tenantId=randomUUID();
        if(kind==='config')f.snapshot.config.language='fr';
        if(kind==='scenario_hash')f.candidate.scenarios=[{key:'injected'}];
        if(kind==='channels')f.candidate.channels=['web_widget'];
        await expect(f.check()).rejects.toThrow();
    });
    it('checks retired regression provenance without locking an additional case inside the outer source use',async()=>{
        const f=fixture(),caseId=randomUUID();
        f.candidate.scenarios=[{key:`quality_regression:${caseId}:1`,regressionCaseId:caseId,regressionRevision:1}];
        f.candidate.scenario_hash=revisionHash(f.candidate.scenarios);
        await expect(f.check()).rejects.toMatchObject({response:{error:'regression_review_changed'}});
        expect(f.query.mock.calls.find(([sql])=>sql.includes('FROM quality_regression_cases'))?.[0]).not.toContain('FOR SHARE');
    });
    it('preserves row protection for ordinary regression users unless readonly checking is explicitly requested',async()=>{
        const f=fixture(),caseId=randomUUID(),scenarios=[{key:`quality_regression:${caseId}:1`,regressionCaseId:caseId,regressionRevision:1}];
        await expect(assertReviewedRegressionScenarios(f.query as any,scenarios,f.input.agentId)).rejects.toThrow();
        expect(f.query.mock.calls.find(([sql])=>sql.includes('FROM quality_regression_cases'))?.[0]).toContain('FOR SHARE');
    });
});
