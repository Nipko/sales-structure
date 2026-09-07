import { buildDomainContractDraft, CONVERSATIONAL_CHANNELS, EVAL_LANGUAGES,
    listCanonicalSubtypeExperienceProfileIds, VERTICAL_DOMAIN_CONTRACT_VERSION } from '@parallext/shared';
import { BadRequestException } from '@nestjs/common';
import { revisionHash as qualityHash } from '../../evaluation-revision/evaluation-revision';
import { sanitizeLearningText } from '../../learning/learning-contracts';
import { TOOL_POLICY_REGISTRY } from '../../conversations/tool-policy-registry';
import { EVAL_WRITER_SANDBOX_FAMILIES } from '../../conversations/agent-test-tool-policy';
import type { ExpectedAction } from '../../simulation/eval.service';

export const REGRESSION_PREFIX='quality_regression:';
export const REGRESSION_DIFFICULTIES=['standard','multi_step','recovery','unknown'] as const;
export type RegressionDifficulty=typeof REGRESSION_DIFFICULTIES[number];
export interface RegressionScope {
    profileId: string | null; mission: string | null; language: string | null; channel: string;
    difficulty: RegressionDifficulty;
    provenance: 'runtime_observation' | 'contract_tool_projection' | 'human_review' | 'unknown';
    contractVersion: number | null;
}
export interface RegressionProposal {
    title: string; messages: string[]; observedReplies: string[]; criteria: string;
    expectedActions: ExpectedAction[];
    coverage: {sourceMessages:number;selectedMessages:number;omittedMessages:number;truncatedMessages:number};
    privacyState: 'redacted_requires_review';
}
export interface RegressionReview {
    expectedRevision: number; decision: 'approved'|'rejected'|'retired'; note: string;
    checks: {privacy:boolean;correctness:boolean;reproduction:boolean};
}

const IDENTIFIER=/^[a-z_][a-z0-9_]*$/;
const PROFILES=new Set(listCanonicalSubtypeExperienceProfileIds());
export function regressionScope(input:unknown, requireKnown=false):RegressionScope {
    if(!input||typeof input!=='object')throw new BadRequestException({error:'regression_scope_required'});
    const value=input as RegressionScope;
    if(!CONVERSATIONAL_CHANNELS.includes(value.channel as any)||!REGRESSION_DIFFICULTIES.includes(value.difficulty)
        || (value.language!==null&&!EVAL_LANGUAGES.includes(value.language as any))
        || (value.profileId!==null&&!PROFILES.has(value.profileId))
        || !['runtime_observation','contract_tool_projection','human_review','unknown'].includes(value.provenance))
        throw new BadRequestException({error:'invalid_regression_scope'});
    if(value.mission!==null){
        if(!value.profileId)throw new BadRequestException({error:'regression_profile_required'});
        const [industry,subtype]=value.profileId.split('/');
        if(!buildDomainContractDraft(industry,subtype).intents.some(intent=>intent.key===value.mission))
            throw new BadRequestException({error:'regression_mission_not_in_contract'});
    }
    if(requireKnown&&(!value.mission||!value.profileId||!value.language||value.difficulty==='unknown'))
        throw new BadRequestException({error:'regression_review_scope_incomplete'});
    return {profileId:value.profileId,mission:value.mission,language:value.language,channel:value.channel,
        difficulty:value.difficulty,provenance:value.provenance,contractVersion:value.profileId?VERTICAL_DOMAIN_CONTRACT_VERSION:null};
}

/** Drafts are redacted, never claimed anonymous. Human review must remove residual identifiers. */
export function regressionRedact(text:string, terms:string[]=[]):string {
    return sanitizeLearningText(redactRegressionSecrets(text),terms);
}

function redactRegressionSecrets(text:string):string {
    return text.replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi,'[authorization]')
        .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,'[token]')
        .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|pk_live_[A-Za-z0-9_-]{12,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/g,'[secret]')
        .replace(/\b(?:password|contraseña|senha|mot de passe|api[_ -]?key|secret)\s*[:=]\s*\S+/gi,'[secret]');
}

/** Preserve reviewed synthetic dates/amounts and fixture placeholders, but never retain known contacts or credentials. */
export function sanitizeRegressionRevision(input:RegressionProposal, coverage:RegressionProposal['coverage'], terms:string[]):RegressionProposal {
    if(!input||typeof input.title!=='string'||typeof input.criteria!=='string'||input.title.length>160||input.criteria.length>2000
        ||!Array.isArray(input.messages)||input.messages.length<1||input.messages.length>8
        ||input.messages.some(text=>typeof text!=='string'||!text.trim()||text.length>2000))
        throw new BadRequestException({error:'invalid_regression_proposal'});
    const redact=(text:string)=>{
        let value=redactRegressionSecrets(text).replace(/https?:\/\/\S+/gi,'[link]')
            .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi,'[contact]')
            .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi,'[reference]')
            .replace(/\+\d[\d\s().-]{7,}\d/g,'[phone]');
        for(const term of terms.filter(term=>term.trim().length>=2).sort((a,b)=>b.length-a.length))
            value=value.replace(new RegExp(`(?<![\\p{L}\\p{N}])${term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?![\\p{L}\\p{N}])`,'giu'),'[person]');
        return value.replace(/[\u0000-\u0008\u000b-\u001f]/g,' ').trim();
    };
    const actions=validateRegressionAssertions(input.expectedActions);
    // Assertions must use fixture values or non-identifying literals; review does not authorize retaining production identifiers.
    const encoded=JSON.stringify(actions);
    if(redact(encoded)!==encoded)throw new BadRequestException({error:'regression_assertion_identifier_forbidden'});
    return {title:redact(input.title),criteria:redact(input.criteria),messages:input.messages.map(redact),
        observedReplies:[],expectedActions:actions,coverage,privacyState:'redacted_requires_review'};
}

export function buildRegressionProposal(rows:Array<{direction:string;content_text:string}>,total:number,terms:string[]):RegressionProposal {
    const messages=rows.filter(row=>row.direction==='inbound').slice(-8).map(row=>regressionRedact(row.content_text,terms).slice(0,2000));
    const observedReplies=rows.filter(row=>row.direction==='outbound').slice(-8).map(row=>regressionRedact(row.content_text,terms).slice(0,2000));
    return {title:'',messages,observedReplies,criteria:'',expectedActions:[],
        coverage:{sourceMessages:total,selectedMessages:rows.length,omittedMessages:Math.max(0,total-rows.length),
            truncatedMessages:rows.filter(row=>regressionRedact(row.content_text,terms).length>2000).length},privacyState:'redacted_requires_review'};
}

/** An allowlisted declaration, never arbitrary SQL or a caller-supplied verifier. */
export function validateRegressionAssertions(input:unknown):ExpectedAction[] {
    if(!Array.isArray(input)||input.length>30)throw new BadRequestException({error:'invalid_regression_assertions'});
    const actions=input as ExpectedAction[];
    for(const action of actions){
        if(!action||typeof action!=='object'||Array.isArray(action)||JSON.stringify(action).length>4000
            ||(action.description!==undefined&&(typeof action.description!=='string'||action.description.length>300)))
            throw new BadRequestException({error:'invalid_regression_assertion'});
        const allowed=action.kind==='tool_call'?['kind','type','tool','description']:['kind','type','family','table','where','count','description'];
        if(Object.keys(action).some(key=>!allowed.includes(key)))throw new BadRequestException({error:'invalid_regression_assertion'});
        if(action?.kind==='tool_call'){
            if(!['called','not_called'].includes(action.type)||!TOOL_POLICY_REGISTRY[action.tool])throw new BadRequestException({error:'unknown_regression_tool'});
            continue;
        }
        if(!action||('kind'in action&&action.kind&&action.kind!=='db_effect')||!['row_exists','row_count','no_row'].includes(action.type))throw new BadRequestException({error:'invalid_regression_assertion'});
        const entry=action.family?EVAL_WRITER_SANDBOX_FAMILIES[action.family]:undefined;
        if(!entry||!(entry.status==='audited'||entry.verifierAudited)||!entry.contactColumn||entry.table!==action.table)
            throw new BadRequestException({error:'regression_verifier_unavailable'});
        if(action.type==='row_count'&&(!Number.isSafeInteger(action.count)||Number(action.count)<0))throw new BadRequestException({error:'invalid_regression_count'});
        if(action.where!==undefined&&(!action.where||typeof action.where!=='object'||Array.isArray(action.where)||Object.keys(action.where).length>15))throw new BadRequestException({error:'invalid_regression_filter'});
        for(const [column,raw] of Object.entries(action.where||{})){
            const filter=raw&&typeof raw==='object'?raw:{op:'eq',value:raw};
            if(!IDENTIFIER.test(column)||!filter||Array.isArray(filter)||Object.keys(filter).some(key=>!['op','value'].includes(key))
                ||!['eq','ilike','date_eq','time_eq'].includes(filter.op)||!Object.hasOwn(filter,'value')
                ||!(filter.value===null||typeof filter.value==='string'||typeof filter.value==='boolean'||(typeof filter.value==='number'&&Number.isFinite(filter.value)))
                ||(filter.op!=='eq'&&typeof filter.value!=='string'))
                throw new BadRequestException({error:'invalid_regression_filter'});
        }
    }
    return JSON.parse(JSON.stringify(actions));
}

export function reviewedRegressionScenario(caseId:string,revision:number,scope:RegressionScope,proposal:RegressionProposal,
    source:{agentId:string;hash:string;revision:string;agentVersion:number}){
    scope=regressionScope(scope,true);
    if(!proposal.title?.trim()||proposal.title.length>160||!proposal.criteria?.trim()||proposal.criteria.length>2000
        ||!Array.isArray(proposal.messages)||proposal.messages.length<1||proposal.messages.length>8
        ||proposal.messages.some(text=>typeof text!=='string'||!text.trim()||text.length>2000))
        throw new BadRequestException({error:'regression_reproduction_required'});
    const expectedActions=validateRegressionAssertions(proposal.expectedActions);
    const [industry,subtype]=scope.profileId!.split('/');
    const intent=buildDomainContractDraft(industry,subtype).intents.find(item=>item.key===scope.mission)!;
    if(intent.commits&&!expectedActions.some(action=>action.kind!=='tool_call'))throw new BadRequestException({error:'regression_effect_assertion_required'});
    if(intent.commits&&!expectedActions.some(action=>action.kind==='tool_call'&&intent.toolPlan.includes(action.tool)
        &&TOOL_POLICY_REGISTRY[action.tool]?.commitsBusiness))throw new BadRequestException({error:'regression_mission_tool_assertion_required'});
    const scenario={key:`${REGRESSION_PREFIX}${caseId}:${revision}`,title:proposal.title,
        vertical:industry,profileId:scope.profileId,language:scope.language,locale:scope.language,
        contractVersion:scope.contractVersion,seedOrigin:'quality_regression',seedState:'active',
        messages:proposal.messages,criteria:proposal.criteria,expectedActions,
        regressionCaseId:caseId,regressionRevision:revision,regressionScope:scope,
        regressionAgentId:source.agentId,regressionSourceHash:source.hash,regressionSourceRevision:source.revision,
        regressionAgentVersion:source.agentVersion};
    return {scenario,hash:qualityHash(scenario)};
}
