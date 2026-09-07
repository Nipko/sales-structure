import type { RegressionQuery } from './quality-regression-source';

/** Called under the shared privacy fence for retirement, or its exclusive form for erasure. */
export async function invalidateRegressionArtifacts(query:RegressionQuery,caseIds:string[]):Promise<void>{
    if(!caseIds.length)return;
    const tables=await query<any[]>(`SELECT to_regclass('eval_runs')::text AS runs,to_regclass('eval_autorun_requests')::text AS autoruns`);
    if(tables[0]?.runs){
        // The JSON predicate also removes older checkpoints made before the lineage column existed.
        await query(`DELETE FROM eval_runs r WHERE EXISTS(SELECT 1 FROM unnest($1::uuid[]) id
            WHERE (to_jsonb(r)->'regression_case_ids') ? id::text
                OR POSITION('quality_regression:'||id::text||':' IN COALESCE(to_jsonb(r)::text,''))>0)`,[caseIds]);
    }
    if(tables[0]?.autoruns)await query(`DELETE FROM eval_autorun_requests r WHERE EXISTS(SELECT 1 FROM unnest($1::uuid[]) id
        WHERE (to_jsonb(r)->'regression_case_ids') ? id::text
            OR POSITION('quality_regression:'||id::text||':' IN COALESCE(to_jsonb(r)::text,''))>0)`,[caseIds]);
}

export async function eraseContactRegressionArtifacts(query:RegressionQuery,contactIds:string[]):Promise<number>{
    if(!(await query<any[]>(`SELECT to_regclass('quality_regression_cases')::text AS name`))[0]?.name)return 0;
    const rows=await query<any[]>(`SELECT id FROM quality_regression_cases WHERE source_contact_id=ANY($1::uuid[]) FOR UPDATE`,[contactIds]);
    await invalidateRegressionArtifacts(query,rows.map(row=>row.id));
    await query(`DELETE FROM quality_regression_cases WHERE source_contact_id=ANY($1::uuid[])`,[contactIds]);
    return rows.length;
}
