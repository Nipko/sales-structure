/**
 * "A person already answered this handoff", as SQL.
 *
 * A human reply leaves different evidence depending on the channel:
 *   · web widget: a `messages` row with `metadata.source = 'agent'`;
 *   · WhatsApp / Instagram / Messenger / Telegram: the console sends through the
 *     durable outbox, and the only trace of the person is
 *     `agent_dispatch_outbox.operational_scope.kind = 'human_operator'`.
 * Reading only the first made every conversation a human was working outside the
 * widget look abandoned after the unattended window.
 *
 * `hasOutbox` comes from `to_regclass`, so a tenant schema that predates the
 * table is not referenced (a missing table is a planning error, not an empty set).
 */
export function noHumanReplySql(alias: string, hasOutbox: boolean): string {
    const startedAt = `(${alias}.metadata->'handoff'->>'startedAt')::timestamptz`;
    const widget = `AND NOT EXISTS (
                    SELECT 1 FROM messages m
                     WHERE m.conversation_id = ${alias}.id
                       AND m.direction = 'outbound'
                       AND m.metadata->>'source' = 'agent'
                       AND m.created_at > ${startedAt}
                )`;
    const outbox = hasOutbox ? `AND NOT EXISTS (
                    SELECT 1 FROM agent_dispatch_outbox o
                     WHERE o.conversation_id = ${alias}.id
                       AND o.operational_scope->>'kind' = 'human_operator'
                       AND o.created_at > ${startedAt}
                )` : '';
    return `${widget}\n                ${outbox}`;
}

/** True when the tenant schema has the durable outbox table. */
export async function hasDispatchOutbox(
    run: (sql: string, params: any[]) => Promise<any[]>, schemaName: string,
): Promise<boolean> {
    const rows = await run('SELECT to_regclass($1)::text AS t', [`${schemaName}.agent_dispatch_outbox`]).catch(() => []);
    return !!rows?.[0]?.t;
}
