import type { NoticeQuery } from './operational-notice.contracts';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

/** Caller holds the exclusive agent-privacy fence for the tenant transaction. */
export async function eraseOperationalContactNotices(query:NoticeQuery,schemaName:string,contactIds:string[]):Promise<number>{
    if(!/^tenant_[a-z0-9_]+$/.test(schemaName)||contactIds.some(id=>!UUID.test(id)))throw new Error('notice_erasure_invalid_scope');
    if(!contactIds.length)return 0;
    const [table]=await query<any[]>('SELECT to_regclass($1)::text AS name',[`${schemaName}.operational_notice_outbox`]);
    if(!table?.name)return 0;
    const rows=await query<any[]>(`UPDATE "${schemaName}".operational_notice_outbox
        SET contact_id=NULL,conversation_id=NULL,provider_reference=NULL,
            state=CASE WHEN state IN ('sent','stored') THEN state ELSE 'suppressed' END,
            lease_token=NULL,lease_expires_at=NULL,error_code='notice_contact_erased',updated_at=NOW()
        WHERE contact_id=ANY($1::uuid[]) RETURNING id`,[contactIds]);
    const [reviews]=await query<any[]>('SELECT to_regclass($1)::text AS name',[`${schemaName}.operational_notice_reviews`]);
    if(rows.length&&reviews?.name)await query(`UPDATE "${schemaName}".operational_notice_reviews
        SET reason='notice_contact_erased',human_reference=NULL,evidence='{}'::jsonb,
            request_hash=repeat('0',64),expected_revision=repeat('0',32)
        WHERE notice_id=ANY($1::uuid[])`,[rows.map(row=>row.id)]);
    return rows.length;
}
