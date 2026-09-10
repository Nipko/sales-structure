import { ConflictException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import { revisionHash as qualityHash } from '../../evaluation-revision/evaluation-revision';
import { REGRESSION_PREFIX } from './quality-regression-contracts';
import { assertRegressionCaseSource, type RegressionQuery } from './quality-regression-source';
import { withAgentSourceFence } from '../../../common/utils/agent-source-fence';

const CASE_KEY=/^quality_regression:([a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}):([1-9]\d*)$/i;
export function regressionCaseIds(scenarios:any[]):string[] {
    const ids=new Set<string>();
    for(const scenario of scenarios||[]){
        const reserved=String(scenario?.key||'').startsWith(REGRESSION_PREFIX)||scenario?.seedOrigin==='quality_regression'||scenario?.regressionCaseId;
        if(!reserved)continue;
        const match=CASE_KEY.exec(scenario?.key||'');
        if(!match||scenario.regressionCaseId!==match[1]||Number(scenario.regressionRevision)!==Number(match[2]))
            throw new ConflictException({error:'regression_provenance_required'});
        ids.add(match[1]);
    }
    return [...ids].sort();
}

/** A caller-controlled origin/key is never authority to execute a reviewed case. */
export async function assertReviewedRegressionScenarios(query:RegressionQuery,scenarios:any[],agentId:string,channelType?:string,
    options?:{lockRows?:boolean}):Promise<void>{
    const ids=regressionCaseIds(scenarios);
    if(!ids.length)return;
    if(!(await query<any[]>(`SELECT to_regclass('quality_regression_cases')::text AS name`))[0]?.name)
        throw new ConflictException({error:'regression_review_unavailable'});
    const rows=await query<any[]>(`SELECT * FROM quality_regression_cases WHERE id=ANY($1::uuid[]) AND agent_id=$2::uuid${options?.lockRows===false?'':' FOR SHARE'}`,[ids,agentId]);
    for(const scenario of scenarios.filter(item=>ids.includes(item.regressionCaseId))){
        const row=rows.find(item=>item.id===scenario.regressionCaseId);
        const {id:_displayId,regressionApprovedHash,...definition}=scenario;
        // `invalidated_at` is read off the row rather than filtered in SQL: this
        // runs on tenants whose table may predate the column, and an absent
        // column must read as "not invalidated", not abort the transaction.
        if(row?.invalidated_at)throw new ConflictException({error:'regression_release_retired'});
        if(!row||row.state!=='approved'||Number(row.revision)!==Number(scenario.regressionRevision)
            ||!row.source_hash||!row.approved_hash||!row.approved_scenario||row.approved_hash!==qualityHash(row.approved_scenario)
            ||row.approved_hash!==qualityHash(definition)||row.approved_hash!==regressionApprovedHash
            ||scenario.regressionAgentId!==agentId||scenario.regressionSourceHash!==row.source_hash
            ||String(scenario.regressionSourceRevision)!==String(row.source_revision)
            ||(channelType&&row.scope?.channel!==channelType))
            throw new ConflictException({error:'regression_review_changed'});
        await assertRegressionCaseSource(query,row);
    }
}

/** Keep erasure and review retirement outside each bounded use of derived text. */
export async function withReviewedRegressionScenarios<T>(prisma:PrismaService,schema:string,scenarios:any[],agentId:string,
    channelType:string,work:()=>Promise<T>):Promise<T>{
    if(!regressionCaseIds(scenarios).length)return work();
    return withAgentSourceFence(prisma,schema,async query=>{
        await assertReviewedRegressionScenarios(query,scenarios,agentId,channelType);
        const result=await work();
        await assertReviewedRegressionScenarios(query,scenarios,agentId,channelType);
        return result;
    });
}

export async function fetchReviewedRegressionScenarios(query:RegressionQuery):Promise<any[]>{
    if(!(await query<any[]>(`SELECT to_regclass('quality_regression_cases')::text AS name`))[0]?.name)return [];
    const rows=await query<any[]>(`SELECT * FROM quality_regression_cases r WHERE state='approved'
        AND NOT EXISTS(SELECT 1 FROM customer_memory_erasure e WHERE e.contact_id=r.source_contact_id) ORDER BY created_at,id`);
    const scenarios=[];
    for(const row of rows){
        // Stale approvals remain visible as blocked cases; they cannot silently certify a changed source.
        let current=true;
        try{await assertRegressionCaseSource(query,row);}catch{current=false;}
        // A case whose learning release was withdrawn is blocked the same way a
        // changed source is: visible, with the reason on it. Dropping it from
        // the list would quietly shrink the gate and nobody would know why.
        const blocked=row.invalidated_at?'release_retired':(current?null:'source_changed');
        scenarios.push({...row.approved_scenario,id:row.id,regressionApprovedHash:row.approved_hash,
            ...(blocked?{seedState:'review_required',regressionBlocked:blocked}:{})});
    }
    return scenarios;
}

export function regressionAppliesToSnapshot(scenario:any,snapshot:{agentId?:string;releaseScope?:{profileId?:string|null;intentKeys?:string[]}},channel:string):boolean{
    if(!regressionCaseIds([scenario]).length)return true;
    return scenario.regressionAgentId===snapshot.agentId&&scenario.regressionScope?.channel===channel
        &&scenario.profileId===snapshot.releaseScope?.profileId
        &&!!snapshot.releaseScope?.intentKeys?.includes(scenario.regressionScope?.mission);
}
