export interface KnowledgeConflictSource {
    kind: 'document' | 'faq' | 'policy' | 'business'; id: string; title: string; revision: string; hash: string;
    authority: string | null; jurisdiction: string | null; regulated: boolean; validFrom: string | null; validTo: string | null;
    audience: 'customer' | 'internal'; agentIds: string[];
}
export type KnowledgeConflictDecision = 'prefer_a' | 'prefer_b' | 'different_scope' | 'defer';
export interface KnowledgeConflictReview {
    revision: number; decision: KnowledgeConflictDecision; reason: string; sourceAHash: string; sourceBHash: string;
    scope: {audience:'customer'|'internal';agentId:string|null;jurisdiction:string|null};
}
export interface KnowledgeConflictCase {
    id:string; revision:number; status:'open'|'reviewed'|'stale'; sourceA:KnowledgeConflictSource; sourceB:KnowledgeConflictSource;
    quoteA:string; quoteB:string; detail:string; suggestion:string; createdAt:string;
    review:null|{decision:KnowledgeConflictDecision;reason:string;scope:KnowledgeConflictReview['scope'];actorId:string;createdAt:string};
}
export interface KnowledgeConflictOverview {
    version:1; correctness:'not_verified'; cases:KnowledgeConflictCase[];
    lastScan:null|{id:string;status:'completed_sample'|'partial'|'unavailable';sourceCounts:Record<KnowledgeConflictSource['kind'],number|null>;
        sampledSources:number;candidatePairs:number;checkedPairs:number;unknownPairs:number;newIssues:number;errors:string[];exhaustive:false;correctness:'not_verified';createdAt:string};
}

export function conflictAgentScope(a:KnowledgeConflictSource,b:KnowledgeConflictSource): Array<string|null> {
    if(!a.agentIds.length&&!b.agentIds.length)return[null];
    if(!a.agentIds.length)return b.agentIds;
    if(!b.agentIds.length)return a.agentIds;
    return a.agentIds.filter(id=>b.agentIds.includes(id));
}

export function allowedConflictDecisions(item:KnowledgeConflictCase):KnowledgeConflictDecision[] {
    if(item.status==='stale')return[];
    return (['prefer_a','prefer_b','different_scope','defer'] as const).filter(decision=>{
        const selected=decision==='prefer_a'?item.sourceA:decision==='prefer_b'?item.sourceB:null;
        const other=selected===item.sourceA?item.sourceB:item.sourceA;
        return !selected||!['policy','business'].includes(other.kind)||selected.kind===other.kind;
    });
}

type ConflictRead = () => Promise<{success:boolean;data?:KnowledgeConflictOverview}>;
export async function readKnowledgeConflicts(read:ConflictRead):Promise<KnowledgeConflictOverview> {
    const response=await read();
    if(!response.success||!response.data||!Array.isArray(response.data.cases))throw new Error('requestFailed');
    return response.data;
}

/** A lost POST response never becomes an automatic retry or an optimistic decision. */
export async function actAndReloadKnowledgeConflicts(read:ConflictRead,action?:()=>Promise<{success:boolean;errorCode?:string}>) {
    let errorCode='';
    if(action){
        try{const result=await action();if(!result.success)errorCode=result.errorCode||'mutationUncertain';}
        catch{errorCode='mutationUncertain';}
    }
    return {data:await readKnowledgeConflicts(read),errorCode};
}
