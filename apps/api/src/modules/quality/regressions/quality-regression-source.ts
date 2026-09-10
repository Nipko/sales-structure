import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { QUALITY_RUBRIC_HASH } from '../quality-rubric';
import { revisionHash as qualityHash } from '../../evaluation-revision/evaluation-revision';

export type RegressionQuery=<T=any[]>(sql:string,params?:any[])=>Promise<T>;
export type RegressionSourceKind='quality_score'|'tool_ledger';

export async function readRegressionSource(query:RegressionQuery,kind:RegressionSourceKind,evidenceId:string,agentId:string,lock=false){
    const table=kind==='quality_score'?'conversation_quality_scores':'tool_execution_ledger';
    if(!(await query<any[]>(`SELECT to_regclass($1)::text AS name`,[table]))[0]?.name)throw new NotFoundException({error:'regression_source_unavailable'});
    const rows=await query<any[]>(kind==='quality_score'?`SELECT q.id,c.id AS conversation_id,c.contact_id,c.channel_type,c.qa_revision,
        c.agent_persona_id,c.agent_config_version,c.agent_attribution_conflicted,c.was_handed_off,
        q.source_revision,q.source_message_ids,q.rubric_hash,q.transcript_hash,q.overall_score,q.flags,q.configuration_snapshot,
        NULL::text AS tool_name,NULL::text AS status,NULL::timestamptz AS updated_at
        FROM conversation_quality_scores q JOIN conversations c ON c.id=q.conversation_id
        WHERE q.id=$1::uuid AND c.agent_persona_id=$2::uuid AND q.agent_id=$2::uuid
            AND q.agent_config_version=c.agent_config_version ${lock?'FOR SHARE OF q':''}`:
        `SELECT l.id,c.id AS conversation_id,c.contact_id,c.channel_type,c.qa_revision,
        c.agent_persona_id,c.agent_config_version,c.agent_attribution_conflicted,c.was_handed_off,
        l.tool_name,l.status,l.updated_at::text,l.args_hash,
        ARRAY[COALESCE(l.confirmed_by_message_id,l.confirmation_source_message_id,l.request_source_message_id)]::uuid[] AS source_message_ids
        FROM tool_execution_ledger l JOIN conversations c ON c.id=l.conversation_id
        WHERE l.id=$1::uuid AND c.agent_persona_id=$2::uuid AND l.contact_id=c.contact_id ${lock?'FOR SHARE OF l':''}`,[evidenceId,agentId]);
    const source=rows[0];
    if(!source?.contact_id)throw new NotFoundException({error:'regression_source_unavailable'});
    if(lock){
        // Do not wait in the inverse order of a concurrent conversation/ledger writer.
        // The caller retries this short publication transaction on a busy source.
        const current=await query<any[]>(`SELECT qa_revision FROM conversations WHERE id=$1::uuid FOR SHARE NOWAIT`,[source.conversation_id]);
        if(String(current[0]?.qa_revision)!==String(source.qa_revision))throw new ConflictException({error:'regression_source_changed'});
    }
    if((await query<any[]>(`SELECT contact_id FROM customer_memory_erasure WHERE contact_id=$1::uuid`,[source.contact_id])).length)
        throw new ForbiddenException({error:'regression_source_erased'});
    if(source.agent_attribution_conflicted||source.agent_config_version==null)
        throw new ConflictException({error:'regression_source_attribution_unknown'});
    if(kind==='quality_score'&&(String(source.source_revision)!==String(source.qa_revision)||source.rubric_hash!==QUALITY_RUBRIC_HASH))
        throw new ConflictException({error:'regression_source_changed'});
    if(kind==='quality_score'&&!((source.overall_score!=null&&Number(source.overall_score)<6)||(Array.isArray(source.flags)&&source.flags.length)))
        throw new ConflictException({error:'regression_failure_evidence_required'});
    if(kind==='tool_ledger'&&!['failed','reconciliation_required'].includes(source.status))
        throw new ConflictException({error:'regression_failure_evidence_required'});
    const messageIds=(source.source_message_ids||[]).filter((id:unknown)=>typeof id==='string');
    if(!messageIds.length)throw new ConflictException({error:'regression_source_message_unknown'});
    const anchors=await query<any[]>(`SELECT id,created_at::text FROM messages WHERE conversation_id=$1::uuid
        AND id=ANY($2::uuid[]) AND direction IN ('inbound','outbound') ORDER BY created_at DESC,id DESC`,[source.conversation_id,messageIds]);
    if(anchors.length!==messageIds.length)throw new ConflictException({error:'regression_source_changed'});
    const fingerprint=qualityHash({kind,id:source.id,conversation:source.conversation_id,revision:String(source.qa_revision),
        agentId,agentVersion:Number(source.agent_config_version),messageIds,sourceRevision:source.source_revision==null?null:String(source.source_revision),
        rubricHash:source.rubric_hash??null,transcriptHash:source.transcript_hash??null,overall:source.overall_score??null,flags:source.flags??null,
        configurationHash:source.configuration_snapshot?.hash??null,configurationState:source.configuration_snapshot?.state??null,
        tool:source.tool_name??null,status:source.status??null,updatedAt:source.updated_at??null,argsHash:source.args_hash??null});
    return {...source,messageIds,anchor:anchors[0],fingerprint};
}

export async function assertRegressionCaseSource(query:RegressionQuery,row:any,lock=false){
    const source=await readRegressionSource(query,row.source_kind,row.source_evidence_id,row.agent_id,lock);
    if(source.fingerprint!==row.source_hash||String(source.qa_revision)!==String(row.source_revision))
        throw new ConflictException({error:'regression_source_changed'});
    return source;
}
