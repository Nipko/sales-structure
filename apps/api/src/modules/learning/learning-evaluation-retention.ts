import { disposeOwnedEvalNamespace, type EvalNamespaceLease } from '../simulation/isolated-eval-namespace';
import type { LearningSourceQuery } from './learning-inbox-source';

export interface LearningEvaluationNamespace extends EvalNamespaceLease { attemptId:string;workerToken?:string; }

/** The caller holds the exclusive privacy fence. A finishing worker supplies
 * only its own namespace names; recovery may remove only expired/absent copies.
 * Never clear an index entry before proving that its owned copy is gone.
 */
export async function cleanLearningEvaluationNamespaces(query:LearningSourceQuery,input:{tenantId:string;agentId:string;
    releaseId:string;attemptId?:string;schemaNames?:string[];expiredOnly?:boolean}):Promise<number>{
    if(!input.expiredOnly&&(!input.attemptId||!input.schemaNames?.length))return 0;
    const [row]=await query<any[]>(`SELECT evaluation_namespaces FROM learning_releases
        WHERE id=$1::uuid AND agent_id=$2::uuid FOR UPDATE`,[input.releaseId,input.agentId]);
    if(!row?.evaluation_namespaces?.length)return 0;
    const [{schema}]=await query<any[]>('SELECT current_schema() AS schema');
    const retained:LearningEvaluationNamespace[]=[];
    let removed=0;
    for(const lease of row.evaluation_namespaces as LearningEvaluationNamespace[]){
        if(!input.expiredOnly&&(lease.attemptId!==input.attemptId||!input.schemaNames!.includes(lease.schemaName))){retained.push(lease);continue;}
        if(!/^tenant_eval_[a-f\d]{8}_[a-f\d]{24}$/.test(lease.schemaName)||lease.sourceSchema!==schema||lease.tenantId!==input.tenantId)
            throw new Error('learning_evaluation_namespace_scope_mismatch');
        if(input.expiredOnly){
            await query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text',[`eval-namespace:${lease.schemaName}`]);
            const exists=await query<any[]>('SELECT 1 FROM pg_namespace WHERE nspname=$1',[lease.schemaName]);
            if(exists.length){
                const [owner]=await query<any[]>(`SELECT expires_at<=clock_timestamp() AS expired FROM "${lease.schemaName}".__eval_namespace
                    WHERE tenant_id=$1::uuid AND owner_token=$2::uuid AND source_schema=$3`,[input.tenantId,lease.token,schema]);
                if(!owner)throw new Error('eval_namespace_owner_mismatch');
                if(!owner.expired){retained.push(lease);continue;}
            }
        }
        await disposeOwnedEvalNamespace(query,lease);
        removed++;
    }
    if(removed)await query('UPDATE learning_releases SET evaluation_namespaces=$2::jsonb WHERE id=$1::uuid',
        [input.releaseId,retained.length?JSON.stringify(retained):null]);
    return removed;
}

/** Caller holds the exclusive agent-privacy fence. Keep the registry until every
 * owned copy is gone; a failed teardown rolls back retirement rather than hiding
 * an orphan. Baseline descendants contain derived comparison evidence too.
 */
export async function retireLearningReleases(query:LearningSourceQuery,input:{releaseIds?:string[];sourceIds?:string[]}):Promise<number>{
    const columns=await query<any[]>(`SELECT column_name FROM information_schema.columns
        WHERE table_schema=current_schema() AND table_name='learning_releases'`);
    const names=new Set(columns.map(c=>c.column_name));
    if(!names.has('snapshot'))return 0;
    const rows=await query<any[]>(`WITH RECURSIVE affected(id) AS (
        SELECT r.id FROM learning_releases r WHERE r.id=ANY($1::uuid[])
            OR EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(r.snapshot->'examples','[]'::jsonb)
                ||COALESCE(r.snapshot->'heldout','[]'::jsonb)) s WHERE s->>'source_id'=ANY($2::text[]))
        UNION SELECT r.id FROM learning_releases r JOIN affected a ON r.baseline_release_id=a.id
    ) SELECT id,${names.has('evaluation_namespaces')?'evaluation_namespaces':'NULL AS evaluation_namespaces'}
        FROM learning_releases WHERE id IN(SELECT id FROM affected) FOR UPDATE`,[input.releaseIds||[],input.sourceIds||[]]);
    if(!rows.length)return 0;
    const [{schema}]=await query<any[]>('SELECT current_schema() AS schema');
    for(const row of rows)for(const lease of (row.evaluation_namespaces||[]) as LearningEvaluationNamespace[]){
        if(lease.sourceSchema!==schema)throw new Error('learning_evaluation_namespace_scope_mismatch');
        await disposeOwnedEvalNamespace(query,lease);
    }
    await query(`UPDATE learning_releases SET status='retired',snapshot='{}'::jsonb,evaluation=NULL,evaluation_status='failed'
        ${names.has('evaluation_namespaces')?',evaluation_namespaces=NULL':''} WHERE id=ANY($1::uuid[])`,[rows.map(r=>r.id)]);
    return rows.length;
}
