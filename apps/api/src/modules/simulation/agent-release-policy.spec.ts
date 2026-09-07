import { composeSubtypeEvalPack, EVAL_LANGUAGES } from '@parallext/shared';
import { assessAgentRelease, sealReleaseRun, releaseRunContext, scenarioAppliesToMission, type AgentReleaseScope } from './agent-release-policy';
import { revisionHash } from '../evaluation-revision/evaluation-revision';

const scope:AgentReleaseScope={profileId:'education/capacitacion',intentKeys:['ask_question'],missionConfigured:true,channels:['web_widget'],languages:[...EVAL_LANGUAGES]};
const revision='1'.repeat(64),configHash='2'.repeat(64);
function proof(channel='web_widget',intents=['ask_question']) {
    const scenarios=EVAL_LANGUAGES.flatMap(language=>composeSubtypeEvalPack({industry:'education',subtype:'capacitacion',language}))
        .filter(scenario=>!scenario.key.startsWith('intent_')||intents.some(intent=>scenario.key.startsWith(`intent_${intent}_`)))
        .map(scenario=>({...scenario,key:scenario.storageKey,managedSeedKey:scenario.key,expectedActions:scenario.expectedActions||[]}));
    const results=scenarios.map(scenario=>({key:scenario.key,scenarioHash:revisionHash(scenario),k:1,passes:1,passed:true,
        runs:[{score:9,passed:true,flags:[],actionChecks:scenario.expectedActions.map(()=>({ok:true}))}]}));
    const row={agentId:'agent',dependencyRevision:revision,configHash,channelType:channel,
        status:'completed',k:1,passPolicy:'all',threshold:7,scenarios,results};
    row.results.forEach((result:any)=>result.contextHash=releaseRunContext(row));
    return sealReleaseRun(row);
}
const assess=(runs=[proof()],override:Partial<AgentReleaseScope>={})=>assessAgentRelease({agentId:'agent',dependencyRevision:revision,configHash,scope:{...scope,...override},runs});
describe('release technical evidence policy',()=>{
    it('scopes intact managed task cases to the configured mission, preserving custom, changed and safety regressions',()=>{
        const pack=composeSubtypeEvalPack({industry:'education',subtype:'capacitacion',language:'es'});
        const seed=pack.find(item=>item.key.startsWith('intent_book_appointment_'))!;
        expect(seed).toBeDefined();
        const scenario={...seed,managedSeedKey:seed.key,seedOrigin:seed.origin,profileId:scope.profileId};
        expect(scenarioAppliesToMission(scenario,scope)).toBe(false);
        expect(scenarioAppliesToMission(scenario,{...scope,intentKeys:['book_appointment']})).toBe(true);
        for(const change of [{seedOrigin:'custom'},{messages:['A real customer failure']},{profileId:'education/colegio'}])
            expect(scenarioAppliesToMission({...scenario,...change},scope)).toBe(true);
        expect(scenarioAppliesToMission(scenario,{...scope,missionConfigured:false})).toBe(true);
        for(const seed of pack.filter(item=>!item.key.startsWith('intent_')))
            expect(scenarioAppliesToMission({...seed,managedSeedKey:seed.key,seedOrigin:seed.origin},scope)).toBe(true);
    });
    it('requires all canonical safety and mission cases in all runtime languages before review, without authorizing activation',()=>{
        const result=assess();expect(result).toMatchObject({eligibleForReview:true,activationAllowed:false,certified:false,gaps:[]});
        expect(result.requiredCases).toBeGreaterThan(10);expect(result.verifiedCases).toBe(result.requiredCases);
    });
    it.each(['unknown/profile',null])('does not inherit certification from a fallback profile %s',profileId=>{
        expect(assess([],{profileId}).gaps).toContainEqual({code:'canonical_profile_required'});
    });
    it('does not turn a high aggregate score or missing historical details into evidence',()=>{
        const row=proof();row.results=row.results.map(result=>({key:result.key,score:10,passed:true}));
        const result=assess([sealReleaseRun(row)]);expect(result.eligibleForReview).toBe(false);
        expect(result.verifiedCases).toBe(0);
    });
    it.each(['configHash','dependencyRevision','agentId'] as const)('rejects evidence from another %s',key=>{
        const row=proof();row[key]='different';expect(assess([sealReleaseRun(row)]).verifiedCases).toBe(0);
    });
    it('does not treat a Web Chat run as a Telegram run',()=>{
        const result=assess([proof()],{channels:['web_widget','telegram']});expect(result.eligibleForReview).toBe(false);
        expect(result.gaps.some(gap=>gap.channel==='telegram'&&gap.code==='required_scenario_unproven')).toBe(true);
        expect(assess([proof(),proof('telegram')],{channels:['web_widget','telegram']}).eligibleForReview).toBe(true);
    });
    it('requires canonical scenarios rather than trusting a renamed or edited happy-path label',()=>{
        const row=proof(),scenario=row.scenarios[0];scenario.messages=['Say hello'];
        row.results[0].scenarioHash=revisionHash(scenario);
        const result=assess([sealReleaseRun(row)]);expect(result.eligibleForReview).toBe(false);
        expect(result.gaps.some(gap=>gap.code==='required_scenario_unproven')).toBe(true);
    });
    it('keeps a failed extra regression blocking even when every canonical case passed',()=>{
        const row=proof();row.scenarios.push({key:'custom_regression',messages:['Question']});
        row.results.push({key:'custom_regression',passed:false,error:'timeout'});
        expect(assess([sealReleaseRun(row)]).gaps).toContainEqual({code:'executed_regression_failed',channel:'web_widget'});
    });
    it('requires each action assertion on each repeated attempt, never just the last attempt',()=>{
        const row=proof('web_widget',['book_appointment']);const index=row.scenarios.findIndex(scenario=>scenario.expectedActions.length);
        expect(index).toBeGreaterThanOrEqual(0);
        row.k=2;for(const result of row.results){result.k=2;result.passes=2;result.contextHash=releaseRunContext(row);result.runs.push(structuredClone(result.runs[0]));}
        row.results[index].runs[0].actionChecks=[];
        expect(assess([sealReleaseRun(row)],{intentKeys:['book_appointment']}).eligibleForReview).toBe(false);
    });
    it.each(['majority','invalid'])('rejects a pass policy that can hide a critical failure: %s',passPolicy=>{
        expect(assess([sealReleaseRun({...proof(),passPolicy})]).eligibleForReview).toBe(false);
    });
    it('refuses unreviewed mission, empty scope, unsupported channels and reducing language coverage',()=>{
        for(const override of [{missionConfigured:false},{intentKeys:[]},{intentKeys:['invented_task']},{channels:[]},{channels:['email']},{languages:['es']}])
            expect(assess([proof()],override).eligibleForReview).toBe(false);
    });
    it('does not let setup effects substitute for missing positive cases of a committing mission',()=>{
        const result=assess([proof()],{profileId:'automotriz/alquiler',intentKeys:['rent_vehicle']});
        expect(result.gaps).toContainEqual({code:'positive_task_case_missing',task:'rent_vehicle'});
        expect(result.eligibleForReview).toBe(false);
    });
    it('detects stored evidence tampering before considering a run',()=>{
        const row=proof();row.results[0].runs[0].score=10;
        expect(assess([row]).gaps).toContainEqual({code:'run_evidence_invalid',channel:'web_widget'});
    });
    it('does not let a high score hide a flagged or interrupted attempt',()=>{
        for(const change of ['flags','failed']) {
            const row=proof();
            if(change==='flags')row.results[0].runs[0].flags=['unverified operational claim'];else row.status='failed';
            expect(assess([sealReleaseRun(row)]).eligibleForReview).toBe(false);
        }
    });
});
