import type { PrismaService } from '../prisma/prisma.service';
import { OPERATIONAL_NOTICE_DDL, type NoticeQuery, type OperationalNoticeKind } from './operational-notice.contracts';

const prepared = new WeakMap<object, Set<string>>();
export async function operationalContactWasErased(query: NoticeQuery, contactId?: string | null): Promise<boolean> {
    if (!contactId) return false;
    const [table] = await query<any[]>("SELECT to_regclass('customer_memory_erasure')::text AS name");
    return !!table?.name && (await query<any[]>('SELECT contact_id FROM customer_memory_erasure WHERE contact_id=$1::uuid',[contactId])).length>0;
}
export function operationalNoticesAllowed(schema: string): boolean {
    if (!/^tenant_[a-z0-9_]+$/.test(schema)) throw new Error('operational_notice_invalid_schema');
    return !schema.startsWith('tenant_eval_');
}

/** Prepare before the domain transaction acquires business rows; failures must not silently lose the intent. */
export async function ensureOperationalNoticeOutbox(prisma: PrismaService, schema: string): Promise<void> {
    if (!operationalNoticesAllowed(schema) || prepared.get(prisma)?.has(schema)) return;
    await prisma.transactionInTenantSchema(schema, async query => {
        await query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text', [`${schema}:operational-notice-schema`]);
        await query(OPERATIONAL_NOTICE_DDL);
        await query("CREATE INDEX IF NOT EXISTS idx_operational_notice_due ON operational_notice_outbox(state,next_attempt_at) WHERE state IN ('pending','queued','failed')");
    });
    const schemas = prepared.get(prisma) || new Set<string>(); schemas.add(schema); prepared.set(prisma, schemas);
}

/** Called inside the same transaction that confirms a payment or promotes a waitlist entry. */
export async function enqueueOperationalNotice(query: NoticeQuery, schema: string, input: {
    kind: OperationalNoticeKind; entityId: string; contactId?: string | null; conversationId?: string | null;
    revision?: string; historical?: boolean;
}): Promise<string | null> {
    if (!operationalNoticesAllowed(schema)) return null;
    const eventKey = `${input.kind}:${input.entityId}:${input.revision || '1'}`;
    const rows = await query<any[]>(`INSERT INTO operational_notice_outbox(event_key,kind,entity_id,contact_id,conversation_id,state,error_code)
        VALUES($1,$2,$3::uuid,$4::uuid,$5::uuid,$6,$7)
        ON CONFLICT(event_key) DO NOTHING RETURNING id`, [eventKey, input.kind, input.entityId, input.contactId || null,
        input.conversationId || null, input.historical ? 'reconciliation_required' : 'pending', input.historical ? 'historical_delivery_unverified' : null]);
    return rows[0]?.id || null;
}
