type ErasureQuery = <T = any[]>(sql: string, params?: any[]) => Promise<T>;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

/** Use the caller's tenant transaction; deleting a session revokes its token and removes its pre-chat PII. */
export async function eraseWidgetContactSessions(query: ErasureQuery, schema: string, contactIds: string[]): Promise<number> {
    if (!/^tenant_[a-z0-9_]+$/.test(schema) || contactIds.some(id => !UUID.test(id))) throw new Error('widget_erasure_invalid_scope');
    if (!contactIds.length) return 0;
    await query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text', [`agent-privacy:${schema}`]);
    const exists = await query<any[]>("SELECT to_regclass('public.widget_sessions')::text AS name");
    if (!exists[0]?.name) return 0;
    const deleted = await query<any[]>(`DELETE FROM public.widget_sessions ws USING public.tenants t
        WHERE ws.tenant_id=t.id AND t.schema_name=$1
          AND (ws.contact_id=ANY($2::uuid[]) OR ws.conversation_id IN (
            SELECT id FROM conversations WHERE contact_id=ANY($2::uuid[]))) RETURNING ws.id`, [schema, [...new Set(contactIds)]]);
    return deleted.length;
}
