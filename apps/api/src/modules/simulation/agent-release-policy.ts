import { buildDomainContractDraft, composeSubtypeEvalPack, CONVERSATIONAL_CHANNELS, EVAL_LANGUAGES,
    listCanonicalSubtypeExperienceProfileIds, type AddressForm } from '@parallext/shared';
import { revisionHash } from '../evaluation-revision/evaluation-revision';
import { buildTaskCompetenceMatrix } from './task-competence-matrix';

/** Captured by the server with the configuration, never supplied by a release request. */
export interface AgentReleaseScope {
    profileId: string | null;
    intentKeys: string[];
    missionConfigured: boolean;
    channels: string[];
    languages: string[];
}
export interface AgentReleaseRunEvidence {
    version: 1;
    agentId: string;
    dependencyRevision: string;
    configHash: string;
    channelType: string;
    status: string;
    k: number;
    passPolicy: string;
    threshold: number;
    /** Every model that answered during this run. Certification is per model:
     *  a run that cannot name one proves nothing about any of them. */
    models?: string[];
    scenarios: any[];
    results: any[];
    evidenceHash: string;
}
export function sealReleaseRun(input: Omit<AgentReleaseRunEvidence,'version'|'evidenceHash'>): AgentReleaseRunEvidence {
    const {version:_version,evidenceHash:_priorHash,...body}=input as AgentReleaseRunEvidence;
    const evidence = JSON.parse(JSON.stringify({version:1,...body}));
    return {...evidence,evidenceHash:revisionHash(evidence)};
}
export function releaseRunContext(row:Pick<AgentReleaseRunEvidence,'agentId'|'dependencyRevision'|'configHash'|'channelType'|'k'|'passPolicy'|'threshold'>):string {
    return revisionHash({agentId:row.agentId,dependencyRevision:row.dependencyRevision,configHash:row.configHash,
        channelType:row.channelType,k:row.k,passPolicy:row.passPolicy,threshold:row.threshold});
}
/** Shared with the certification report: two definitions of "this run counts"
 *  would eventually disagree, and the disagreement would look like a pass. */
export function evidenceIsValid(row: AgentReleaseRunEvidence): boolean {
    if (!row || row.version !== 1 || !row.evidenceHash) return false;
    const {evidenceHash,...body}=row;
    return revisionHash(body) === evidenceHash && row.status==='completed' && row.passPolicy==='all'
        && Number.isInteger(row.k) && row.k>=1 && row.k<=5 && Number.isFinite(row.threshold) && row.threshold>=7 && row.threshold<=10
        && Array.isArray(row.scenarios) && Array.isArray(row.results);
}
export const releaseScenarioDefinition = (scenario:any) => revisionHash({messages:scenario.messages,criteria:scenario.criteria||'',expectedActions:scenario.expectedActions||[]});
/** Only an intact managed task case may be omitted for a deliberately narrower mission.
 * Custom or edited regressions and universal safety cases always remain applicable. */
export function scenarioAppliesToMission(scenario:any,scope?:AgentReleaseScope):boolean {
    if(!scope?.missionConfigured || !scope.profileId || !listCanonicalSubtypeExperienceProfileIds().includes(scope.profileId)
        || scenario.profileId!==scope.profileId || !scenario.managedSeedKey
        || !['universal','no_pitch','avoid_terms','declared_limit'].includes(scenario.seedOrigin))return true;
    const [industry,subtype]=scope.profileId.split('/');
    const intent=buildDomainContractDraft(industry,subtype).intents.find(item=>scenario.managedSeedKey.startsWith(`intent_${item.key}_`));
    if(!intent || scope.intentKeys.includes(intent.key))return true;
    const language=scenario.language;
    if(!(EVAL_LANGUAGES as readonly string[]).includes(language))return true;
    const variants=(language==='es'?[null,'tu','usted','vos']:[null]) as Array<AddressForm|null>;
    return !variants.some(addressForm=>composeSubtypeEvalPack({industry,subtype,language,addressForm})
        .some(expected=>expected.key===scenario.managedSeedKey && releaseScenarioDefinition(expected)===releaseScenarioDefinition(scenario)));
}
export function releaseScenarioPassed(scenario:any,row:AgentReleaseRunEvidence):boolean {
    const matches=row.results.filter(result=>result.key===scenario.key);
    if(matches.length!==1)return false;
    const result=matches[0];
    if(result.contextHash!==releaseRunContext(row)||result.scenarioHash!==revisionHash(scenario)||result.error||result.passed!==true||result.k!==row.k||result.passes!==row.k
        ||!Array.isArray(result.runs)||result.runs.length!==row.k)return false;
    return result.runs.every((attempt:any)=>attempt.passed===true && !attempt.error
        && Array.isArray(attempt.flags) && attempt.flags.length===0
        && Number.isFinite(attempt.score) && attempt.score>=row.threshold && attempt.score<=10
        && (!(scenario.expectedActions?.length) || (Array.isArray(attempt.actionChecks)
            && attempt.actionChecks.length===scenario.expectedActions.length && attempt.actionChecks.every((check:any)=>check.ok===true))));
}

/** Technical review eligibility, not permission to deploy or a certification of real-world competence. */
export function assessAgentRelease(input:{agentId:string;dependencyRevision:string;configHash:string;scope?:AgentReleaseScope;runs:AgentReleaseRunEvidence[]}) {
    const gaps:Array<{code:string;channel?:string;language?:string;task?:string;scenario?:string}>=[];
    const add=(code:string,extra:Omit<(typeof gaps)[number],'code'>={})=>gaps.push({code,...extra});
    if(!/^[a-f0-9]{64}$/.test(input.dependencyRevision)||!/^[a-f0-9]{64}$/.test(input.configHash))add('complete_revision_required');
    const scope=input.scope;
    if(!scope || !scope.profileId || !listCanonicalSubtypeExperienceProfileIds().includes(scope.profileId)) {
        add('canonical_profile_required');
        return {version:1,eligibleForReview:false,activationAllowed:false,certified:false,requiredCases:0,verifiedCases:0,gaps};
    }
    const [industry,subtype]=scope.profileId.split('/');
    const domain=buildDomainContractDraft(industry,subtype);
    if(!scope.missionConfigured)add('mission_configuration_required');
    const mission=Array.isArray(scope.intentKeys)?scope.intentKeys:[];
    if(!mission.length||new Set(mission).size!==mission.length||mission.some(key=>!domain.intents.some(intent=>intent.key===key)))add('mission_scope_invalid');
    const channels=Array.isArray(scope.channels)?scope.channels:[];
    if(!channels.length||new Set(channels).size!==channels.length||channels.some(channel=>!(CONVERSATIONAL_CHANNELS as readonly string[]).includes(channel)))add('operational_channel_scope_required');
    // The runtime can switch between all supported customer languages. One language cannot certify the others.
    if(!Array.isArray(scope.languages)||scope.languages.length!==EVAL_LANGUAGES.length||EVAL_LANGUAGES.some(language=>!scope.languages.includes(language)))add('language_scope_incomplete');
    const matrix=buildTaskCompetenceMatrix(scope.profileId).profiles[0];
    for(const task of matrix.tasks.filter(task=>mission.includes(task.key))) {
        for(const gap of task.gaps.filter(gap=>gap!=='profile_execution_evidence_missing'))add(gap,{task:task.key});
    }
    const current=input.runs.filter(row=>row?.agentId===input.agentId&&row.dependencyRevision===input.dependencyRevision&&row.configHash===input.configHash);
    for(const row of current) {
        if(!evidenceIsValid(row)) {add('run_evidence_invalid',{channel:row.channelType});continue;}
        if(row.scenarios.some(scenario=>!releaseScenarioPassed(scenario,row)))add('executed_regression_failed',{channel:row.channelType});
    }
    const valid=current.filter(evidenceIsValid);
    let requiredCases=0,verifiedCases=0;
    for(const language of EVAL_LANGUAGES) {
        const variants=new Map<string,{definitions:Set<string>;actions:any[]}>();
        for(const addressForm of (language==='es'?[null,'tu','usted','vos']:[null]) as Array<AddressForm|null>) {
            for(const scenario of composeSubtypeEvalPack({industry,subtype,language,addressForm})) {
                const task=domain.intents.find(intent=>scenario.key.startsWith(`intent_${intent.key}_`));
                if(task&&!mission.includes(task.key))continue;
                const existing=variants.get(scenario.key)||{definitions:new Set<string>(),actions:[...(scenario.expectedActions||[])]};
                existing.definitions.add(releaseScenarioDefinition(scenario));variants.set(scenario.key,existing);
            }
        }
        for(const channel of [...new Set(channels)].filter(channel=>(CONVERSATIONAL_CHANNELS as readonly string[]).includes(channel))) {
            for(const [key,expected] of variants) {
                requiredCases++;
                const proven=valid.filter(row=>row.channelType===channel).some(row=>row.scenarios.some(scenario=>
                    scenario.profileId===scope.profileId && scenario.language===language && scenario.managedSeedKey===key
                    && expected.definitions.has(releaseScenarioDefinition(scenario)) && releaseScenarioPassed(scenario,row)));
                if(proven)verifiedCases++;else add('required_scenario_unproven',{channel,language,scenario:key});
            }
        }
    }
    return {version:1,eligibleForReview:gaps.length===0&&requiredCases>0,activationAllowed:false,certified:false,
        requiredCases,verifiedCases,gaps};
}
